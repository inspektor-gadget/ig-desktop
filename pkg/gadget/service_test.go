// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package gadget

import (
	"context"
	"encoding/json"
	"math"
	"net"
	"testing"
	"time"

	apiTypes "github.com/inspektor-gadget/ig-desktop/pkg/api"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"google.golang.org/grpc"
)

type testGadgetServer struct {
	api.UnimplementedGadgetManagerServer
	requests chan *api.GadgetControlRequest
}

func (s *testGadgetServer) RunGadget(stream api.GadgetManager_RunGadgetServer) error {
	for {
		req, err := stream.Recv()
		if err != nil {
			return err
		}
		s.requests <- req
		if req.GetStopRequest() != nil {
			return nil
		}
	}
}

func TestDurationAndManualStop(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	fake := &testGadgetServer{requests: make(chan *api.GadgetControlRequest, 8)}
	api.RegisterGadgetManagerServer(server, fake)
	go server.Serve(listener)
	defer server.Stop()
	runtime := grpcruntime.New()
	params := runtime.GlobalParamDescs().ToParams()
	params.Set(grpcruntime.ParamRemoteAddress, "tcp://"+listener.Addr().String())
	if err := runtime.Init(params); err != nil {
		t.Fatal(err)
	}
	for i, seconds := range []int64{1, 0, 0} {
		manager := NewInstanceManager()
		service := NewService(manager)
		stopped := make(chan *apiTypes.GadgetEvent, 1)
		service.SetSendFunc(func(message any) {
			if ev, ok := message.(*apiTypes.GadgetEvent); ok && ev.Type == apiTypes.TypeGadgetStop {
				stopped <- ev
			}
		})
		ctx, cancel := context.WithCancel(context.Background())
		start := time.Now()
		id, err := service.Run(ctx, runtime, RunRequest{Image: "example/arbitrary:tag", DurationSeconds: seconds})
		if err != nil || id == "" || time.Since(start) > 500*time.Millisecond {
			t.Fatalf("start must return identity promptly: %s %v", id, err)
		}
		select {
		case req := <-fake.requests:
			if req.GetRunRequest() == nil || req.GetRunRequest().Timeout != seconds*int64(time.Second) {
				t.Fatalf("runtime timeout not propagated: %+v", req)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("no runtime run request")
		}
		if seconds == 0 {
			select {
			case <-stopped:
				t.Fatal("manual capture stopped itself")
			case <-time.After(30 * time.Millisecond):
			}
			if i == 2 {
				cancel() // EOF/shutdown cancels this same parent context.
			} else {
				if err := manager.Stop(id); err != nil {
					t.Fatal(err)
				}
			}
		}
		select {
		case req := <-fake.requests:
			if req.GetStopRequest() == nil {
				t.Fatal("expected runtime stop request")
			}
		case <-time.After(3 * time.Second):
			t.Fatal("duration/manual stop did not stop remote stream")
		}
		select {
		case event := <-stopped:
			var data struct{ Reason, Error string }
			if err := json.Unmarshal(event.Data, &data); err != nil {
				t.Fatal(err)
			}
			want := "duration"
			if seconds == 0 {
				want = "cancelled"
			}
			if event.InstanceID != id || data.Reason != want || data.Error != "" {
				t.Fatalf("unexpected terminal event: %+v %s", event, event.Data)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("no terminal event")
		}
		cancel()
		waitCtx, done := context.WithTimeout(context.Background(), time.Second)
		if err := manager.Wait(waitCtx); err != nil {
			t.Fatal(err)
		}
		done()
	}

	t.Run("attachment cancellation preserves remote identity", func(t *testing.T) {
		manager := NewInstanceManager()
		service := NewService(manager)
		stopped := make(chan struct{}, 1)
		service.SetSendFunc(func(message any) {
			if ev, ok := message.(*apiTypes.GadgetEvent); ok && ev.Type == apiTypes.TypeGadgetStop {
				stopped <- struct{}{}
			}
		})
		localID, err := service.Attach(context.Background(), runtime, AttachRequest{
			ID: "0123456789abcdef0123456789abcdef", Image: "example/image:tag",
		})
		if err != nil {
			t.Fatal(err)
		}
		select {
		case req := <-fake.requests:
			if req.GetAttachRequest() == nil || req.GetAttachRequest().Id != "0123456789abcdef0123456789abcdef" {
				t.Fatalf("wrong attachment identity: %+v", req)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("no attach request")
		}
		if err := manager.Stop(localID); err != nil {
			t.Fatal(err)
		}
		select {
		case <-stopped:
		case <-time.After(3 * time.Second):
			t.Fatal("attachment did not close")
		}
		select {
		case req := <-fake.requests:
			t.Fatalf("attachment cancellation sent a remote command: %+v", req)
		default:
		}
	})
}

func TestDurationValidation(t *testing.T) {
	for _, seconds := range []int64{-1, math.MaxInt64} {
		if err := ValidateDuration(seconds, false); err == nil {
			t.Fatalf("accepted duration %d", seconds)
		}
	}
	if err := ValidateDuration(1, true); err == nil {
		t.Fatal("accepted unsupported detached duration")
	}
	if err := ValidateDuration(0, true); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceManagerReplacementDrains(t *testing.T) {
	manager := NewInstanceManager()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager.Register("id", cancel)
	manager.Register("id", cancel)
	if err := manager.Stop("id"); err != nil || ctx.Err() != context.Canceled {
		t.Fatalf("stop failed: %v", err)
	}
	manager.Unregister("id")
	manager.Unregister("id")
	waitCtx, done := context.WithTimeout(context.Background(), time.Second)
	defer done()
	if err := manager.Wait(waitCtx); err != nil {
		t.Fatal(err)
	}
}
