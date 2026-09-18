// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package json

import (
	"math"
	"strings"
	"testing"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
)

func TestExactIntegersAreOptIn(t *testing.T) {
	ds, err := datasource.New(datasource.TypeSingle, "events")
	if err != nil {
		t.Fatal(err)
	}
	field, err := ds.AddField("value", api.Kind_Uint64)
	if err != nil {
		t.Fatal(err)
	}
	packet, _ := ds.NewPacketSingle()
	defer ds.Release(packet)
	field.PutUint64(packet, math.MaxUint64)
	ordinary, err := New(ds, WithShowAll(true))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(ordinary.Marshal(packet)); !strings.Contains(got, `"value":18446744073709551615`) {
		t.Fatalf("ordinary output changed: %s", got)
	}
	exact, err := New(ds, WithShowAll(true), WithExactIntegers())
	if err != nil {
		t.Fatal(err)
	}
	owned := exact.Marshal(packet)
	if !strings.Contains(string(owned), `"value":"18446744073709551615"`) {
		t.Fatalf("exact output: %s", owned)
	}
	field.PutUint64(packet, 1)
	for i := 0; i < 100; i++ {
		ordinary.Marshal(packet)
		exact.Marshal(packet)
	}
	if !strings.Contains(string(owned), `"18446744073709551615"`) {
		t.Fatal("file formatter returned a recycled buffer")
	}
}

func TestMarshalReturnsOwnedBytes(t *testing.T) {
	ds, err := datasource.New(datasource.TypeSingle, "events")
	if err != nil {
		t.Fatal(err)
	}
	field, err := ds.AddField("value", api.Kind_Uint64)
	if err != nil {
		t.Fatal(err)
	}
	packet, _ := ds.NewPacketSingle()
	defer ds.Release(packet)
	formatter, err := New(ds, WithShowAll(true))
	if err != nil {
		t.Fatal(err)
	}
	field.PutUint64(packet, 12345)
	first := formatter.Marshal(packet)
	field.PutUint64(packet, 99999)
	for i := 0; i < 100; i++ {
		formatter.Marshal(packet)
	}
	if !strings.Contains(string(first), `"value":12345`) {
		t.Fatalf("ordinary formatter returned a recycled buffer: %s", first)
	}
}

func TestUnsignedArraysDoNotWrap(t *testing.T) {
	ds, err := datasource.New(datasource.TypeSingle, "events")
	if err != nil {
		t.Fatal(err)
	}
	field, err := ds.AddField("values", api.ArrayOf(api.Kind_Uint64))
	if err != nil {
		t.Fatal(err)
	}
	packet, _ := ds.NewPacketSingle()
	defer ds.Release(packet)
	if err := field.Set(packet, []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		options []Option
		want    string
	}{
		{nil, `"values":[18446744073709551615]`},
		{[]Option{WithExactIntegers()}, `"values":["18446744073709551615"]`},
	} {
		formatter, err := New(ds, append(test.options, WithShowAll(true))...)
		if err != nil {
			t.Fatal(err)
		}
		if got := string(formatter.Marshal(packet)); !strings.Contains(got, test.want) {
			t.Fatalf("got %s, want %s", got, test.want)
		}
	}
}
