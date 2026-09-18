// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package grpcruntime

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	gadgetcontext "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-context"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type schemaServer struct {
	api.UnimplementedGadgetManagerServer
	kind api.Kind
}

func (s *schemaServer) RunGadget(stream api.GadgetManager_RunGadgetServer) error {
	if _, err := stream.Recv(); err != nil {
		return err
	}
	ds, _ := datasource.New(datasource.TypeSingle, "events")
	field, _ := ds.AddField("value", s.kind)
	info, _ := proto.Marshal(&api.GadgetInfo{DataSources: []*api.DataSource{{Id: 1, Name: "events", Type: uint32(ds.Type()), Fields: ds.Fields()}}})
	if err := stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetInfo, Payload: info}); err != nil {
		return err
	}
	p, _ := ds.NewPacketSingle()
	if s.kind == api.Kind_Uint64 {
		field.PutUint64(p, 1)
	} else {
		field.PutString(p, "value")
	}
	data, _ := proto.Marshal(p.Raw())
	ds.Release(p)
	return stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetPayload, DataSourceID: 1, Seq: 1, Payload: data})
}

func TestTargetMetadataInitializationFencesCallbacks(t *testing.T) {
	for _, mismatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "matching", true: "different"}[mismatch], func(t *testing.T) {
			targets := make([]target, 2)
			for i := 0; i < 2; i++ {
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				server := grpc.NewServer()
				kind := api.Kind_Uint64
				if mismatch && i == 1 {
					kind = api.Kind_String
				}
				api.RegisterGadgetManagerServer(server, &schemaServer{kind: kind})
				go server.Serve(listener)
				defer server.Stop()
				targets[i] = target{addressOrPod: listener.Addr().String(), node: string(rune('a' + i))}
			}
			r := New()
			if err := r.Init(r.GlobalParamDescs().ToParams()); err != nil {
				t.Fatal(err)
			}
			var count atomic.Int64
			entered, release := make(chan struct{}), make(chan struct{})
			op := simple.New("test-sink", simple.OnPreStart(func(ctx operators.GadgetContext) error {
				close(entered)
				<-release
				return ctx.GetDataSources()["events"].Subscribe(func(datasource.DataSource, datasource.Data) error { count.Add(1); return nil }, 1000)
			}))
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			gctx := gadgetcontext.New(ctx, "test", gadgetcontext.WithDataOperators(op))
			defer gctx.StopLocalOperators()
			done := make(chan error, 1)
			go func() { _, err := r.runGadgetOnTargets(gctx, nil, targets); done <- err }()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("initialization never started")
			}
			time.Sleep(30 * time.Millisecond)
			if count.Load() != 0 {
				t.Fatal("callback before initialization completed")
			}
			close(release)
			err := <-done
			if mismatch {
				if err == nil || !strings.Contains(err.Error(), "metadata differs") {
					t.Fatalf("schema mismatch not rejected: %v", err)
				}
			} else if err != nil || count.Load() != 2 {
				t.Fatalf("lost callbacks: count=%d err=%v", count.Load(), err)
			}
		})
	}
}

// policyServer sends metadata, then optionally a corrupt payload, then (after
// delay) one valid payload. With fail set it errors before sending anything.
type policyServer struct {
	api.UnimplementedGadgetManagerServer
	corrupt bool
	fail    bool
	delay   time.Duration
}

func (s *policyServer) RunGadget(stream api.GadgetManager_RunGadgetServer) error {
	if _, err := stream.Recv(); err != nil {
		return err
	}
	if s.fail {
		return errors.New("node failure")
	}
	ds, _ := datasource.New(datasource.TypeSingle, "events")
	field, _ := ds.AddField("value", api.Kind_Uint64)
	info, _ := proto.Marshal(&api.GadgetInfo{DataSources: []*api.DataSource{{Id: 1, Name: "events", Type: uint32(ds.Type()), Fields: ds.Fields()}}})
	if err := stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetInfo, Payload: info}); err != nil {
		return err
	}
	seq := uint32(1)
	if s.corrupt {
		if err := stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetPayload, DataSourceID: 1, Seq: seq, Payload: []byte{0xff, 0xff, 0xff}}); err != nil {
			return err
		}
		seq++
	}
	stopped := make(chan struct{})
	go func() { stream.Recv(); close(stopped) }() // stop request or EOF
	select {
	case <-time.After(s.delay):
	case <-stopped:
		return nil
	}
	p, _ := ds.NewPacketSingle()
	field.PutUint64(p, 1)
	data, _ := proto.Marshal(p.Raw())
	ds.Release(p)
	return stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetPayload, DataSourceID: 1, Seq: seq, Payload: data})
}

func runPolicyTargets(t *testing.T, strict bool, servers ...*policyServer) (count int64, cancelled bool, err error) {
	t.Helper()
	targets := make([]target, len(servers))
	for i, srv := range servers {
		listener, lerr := net.Listen("tcp", "127.0.0.1:0")
		if lerr != nil {
			t.Fatal(lerr)
		}
		server := grpc.NewServer()
		api.RegisterGadgetManagerServer(server, srv)
		go server.Serve(listener)
		t.Cleanup(server.Stop)
		targets[i] = target{addressOrPod: listener.Addr().String(), node: string(rune('a' + i))}
	}
	r := New()
	if err := r.Init(r.GlobalParamDescs().ToParams()); err != nil {
		t.Fatal(err)
	}
	var n atomic.Int64
	op := simple.New("test-sink", simple.OnPreStart(func(ctx operators.GadgetContext) error {
		return ctx.GetDataSources()["events"].Subscribe(func(datasource.DataSource, datasource.Data) error { n.Add(1); return nil }, 1000)
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	gctx := gadgetcontext.New(ctx, "test", gadgetcontext.WithDataOperators(op))
	defer gctx.StopLocalOperators()
	if strict {
		SetFailFast(gctx)
	}
	_, err = r.runGadgetOnTargets(gctx, nil, targets)
	return n.Load(), gctx.Context().Err() != nil, err
}

func TestTolerantRunSkipsCorruptPayloads(t *testing.T) {
	count, _, err := runPolicyTargets(t, false, &policyServer{corrupt: true})
	if err != nil || count != 1 {
		t.Fatalf("tolerant run: count=%d err=%v", count, err)
	}
}

func TestFailFastRunAbortsOnCorruptPayload(t *testing.T) {
	_, _, err := runPolicyTargets(t, true, &policyServer{corrupt: true})
	if err == nil || !strings.Contains(err.Error(), "decoding datasource packet") {
		t.Fatalf("corrupt payload not rejected: %v", err)
	}
}

func TestTolerantRunKeepsOtherNodesRunning(t *testing.T) {
	count, cancelled, err := runPolicyTargets(t, false, &policyServer{fail: true}, &policyServer{delay: 200 * time.Millisecond})
	if err == nil {
		t.Fatal("failing node error not reported")
	}
	if cancelled || count != 1 {
		t.Fatalf("healthy node affected: count=%d cancelled=%v", count, cancelled)
	}
}

func TestFailFastRunCancelsOtherNodes(t *testing.T) {
	count, cancelled, err := runPolicyTargets(t, true, &policyServer{fail: true}, &policyServer{delay: 2 * time.Second})
	if err == nil || !cancelled || count != 0 {
		t.Fatalf("fail-fast run not cancelled: count=%d cancelled=%v err=%v", count, cancelled, err)
	}
}
