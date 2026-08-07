// Copyright 2026 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package virtual

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	gadgetcontext "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-context"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"
)

func TestVirtualFields(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	var ds datasource.DataSource
	var input datasource.FieldAccessor

	producer := simple.New("producer",
		simple.WithPriority(Priority-1),
		simple.OnInit(func(gadgetCtx operators.GadgetContext) error {
			if err := gadgetCtx.SetMetadata([]byte(`
datasources:
  events:
    annotations:
      virtual.fields: static, computed
    fields:
      static:
        type: string
        virtual.content: fixed
      computed:
        type: string
        virtual.content-expr: input + "-computed"
`)); err != nil {
				t.Fatal(err)
			}
			var err error
			ds, err = gadgetCtx.RegisterDataSource(datasource.TypeSingle, "events")
			if err != nil {
				return err
			}
			input, err = ds.AddField("input", api.Kind_String)
			return err
		}),
		simple.OnStart(func(operators.GadgetContext) error {
			packet, err := ds.NewPacketSingle()
			if err != nil {
				return err
			}
			if err := input.PutString(packet, "value"); err != nil {
				return err
			}
			return ds.EmitAndRelease(packet)
		}),
	)

	consumer := simple.New("consumer",
		simple.WithPriority(Priority+1),
		simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
			static := ds.GetField("static")
			computed := ds.GetField("computed")
			if static == nil || computed == nil {
				t.Fatal("virtual fields were not added")
			}
			return ds.Subscribe(func(_ datasource.DataSource, data datasource.Data) error {
				staticValue, err := static.String(data)
				if err != nil {
					return err
				}
				computedValue, err := computed.String(data)
				if err != nil {
					return err
				}
				if staticValue != "fixed" || computedValue != "value-computed" {
					t.Fatalf("unexpected virtual values: %q, %q", staticValue, computedValue)
				}
				cancel()
				return nil
			}, 1000)
		}),
	)

	err := gadgetcontext.New(ctx, "", gadgetcontext.WithDataOperators(producer, New(), consumer)).Run(nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestVirtualFieldExpressionIsCompiledDuringInitialization(t *testing.T) {
	producer := simple.New("producer",
		simple.WithPriority(Priority-1),
		simple.OnInit(func(gadgetCtx operators.GadgetContext) error {
			if err := gadgetCtx.SetMetadata([]byte(`
datasources:
  events:
    annotations:
      virtual.fields: broken
    fields:
      broken:
        type: string
        virtual.content-expr: input +
`)); err != nil {
				t.Fatal(err)
			}
			ds, err := gadgetCtx.RegisterDataSource(datasource.TypeSingle, "events")
			if err != nil {
				return err
			}
			_, err = ds.AddField("input", api.Kind_String)
			return err
		}),
	)

	err := gadgetcontext.New(t.Context(), "", gadgetcontext.WithDataOperators(producer, New())).Run(nil)
	if err == nil || !strings.Contains(err.Error(), "compiling virtual field") {
		t.Fatalf("expected expression compilation error, got %v", err)
	}
}

func TestVirtualFieldExpressionRejectsNonStringResult(t *testing.T) {
	var ds datasource.DataSource
	var input datasource.FieldAccessor

	producer := simple.New("producer",
		simple.WithPriority(Priority-1),
		simple.OnInit(func(gadgetCtx operators.GadgetContext) error {
			if err := gadgetCtx.SetMetadata([]byte(`
datasources:
  events:
    annotations:
      virtual.fields: computed
    fields:
      computed:
        type: string
        virtual.content-expr: 'input == "nope" ? input : 0'
`)); err != nil {
				t.Fatal(err)
			}
			var err error
			ds, err = gadgetCtx.RegisterDataSource(datasource.TypeSingle, "events")
			if err != nil {
				return err
			}
			input, err = ds.AddField("input", api.Kind_String)
			return err
		}),
		simple.OnStart(func(operators.GadgetContext) error {
			packet, err := ds.NewPacketSingle()
			if err != nil {
				return err
			}
			if err := input.PutString(packet, "value"); err != nil {
				return err
			}
			return ds.EmitAndRelease(packet)
		}),
	)

	err := gadgetcontext.New(t.Context(), "", gadgetcontext.WithDataOperators(producer, New())).Run(nil)
	if err == nil || !strings.Contains(err.Error(), "returned int, expected string") {
		t.Fatalf("expected expression result type error, got %v", err)
	}
}
