// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcapgo"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
)

func packetCapable(ds datasource.DataSource) bool {
	for _, mode := range strings.Split(ds.Annotations()["cli.supported-output-modes"], ",") {
		if strings.TrimSpace(mode) == "pcap-ng" {
			return true
		}
	}
	return false
}

func (s *Sink) subscribePCAP(sources map[string]datasource.DataSource, ids []string, explicit bool, provenance any) error {
	var packetID string
	for id, ds := range sources {
		if !packetCapable(ds) {
			continue
		}
		if packetID != "" {
			return errors.New("multiple packet-capable datasources are not supported")
		}
		packetID = id
	}
	if packetID == "" {
		return errors.New("no datasource advertises pcap-ng")
	}
	if explicit && (len(ids) != 1 || ids[0] != packetID) {
		return errors.New("PCAP-NG selection must contain only its packet datasource")
	}
	ds := sources[packetID]
	if ds.Type() != datasource.TypeSingle {
		return errors.New("PCAP-NG requires a single-event packet datasource")
	}
	field := func(annotation string) datasource.FieldAccessor { return ds.GetField(ds.Annotations()[annotation]) }
	payload, timestamp, length := field("pcap.payload"), field("pcap.timestamp"), field("pcap.packet-length")
	if payload == nil || timestamp == nil || length == nil {
		return errors.New("missing annotated packet payload, timestamp or original length field")
	}
	if payload.Type() != api.Kind_Bytes && payload.Type() != api.ArrayOf(api.Kind_Uint8) {
		return errors.New("packet payload must be bytes")
	}
	if timestamp.Type() != api.Kind_String && timestamp.Type() != api.Kind_CString && timestamp.Type() != api.Kind_Uint64 {
		return errors.New("packet timestamp must be RFC3339Nano string or Unix nanoseconds uint64")
	}
	// IG's timestamp formatter renders "<name>_raw" (wall-clock Unix ns after
	// formatting) into a string "<name>" whose layout a gadget may override via
	// formatters.timestamp.format; tcpdump annotates the string. Prefer the
	// exact raw value when present instead of parsing a possibly custom layout.
	if timestamp.Type() != api.Kind_Uint64 {
		if raw := ds.GetField(timestamp.FullName() + "_raw"); raw != nil && raw.Type() == api.Kind_Uint64 {
			timestamp = raw
		}
	}
	if length.Type() != api.Kind_Uint32 {
		return errors.New("packet original length must be uint32")
	}
	comm := ds.GetField("proc.comm")
	if comm != nil && comm.Type() != api.Kind_String && comm.Type() != api.Kind_CString {
		return errors.New("proc.comm must be a string")
	}
	var keys []datasource.FieldAccessor
	type variable struct {
		name  string
		field datasource.FieldAccessor
	}
	var variables []variable
	for _, f := range ds.Fields() {
		acc := ds.GetField(f.FullName)
		if f.Annotations["pcap.interface-key"] == "true" {
			if acc == nil {
				return errors.New("missing packet interface key")
			}
			keys = append(keys, acc)
		}
		if name, ok := f.Annotations["pcap.interface-var"]; ok {
			if acc == nil || (acc.Type() != api.Kind_String && acc.Type() != api.Kind_CString) {
				return errors.New("packet interface variable must be a string")
			}
			keys = append(keys, acc)
			variables = append(variables, variable{name, acc})
		}
	}
	section, err := json.Marshal(map[string]any{"version": 1, "datasourceId": packetID, "provenance": provenance})
	if err != nil || len(section) > 60000 {
		return errors.New("PCAP-NG provenance exceeds section metadata limit")
	}
	// pcapgo writes the section header together with a first interface block
	// and has no API for a section without one. Packets always use the
	// per-identity interfaces added below, so interface 0 is a placeholder;
	// it also keeps a zero-packet capture a complete, readable file.
	writer, err := pcapgo.NewNgWriterInterface(s, pcapgo.NgInterface{
		Name: "capture", Description: "placeholder; packets use the per-identity interfaces", LinkType: layers.LinkTypeEthernet, TimestampResolution: 9,
	}, pcapgo.NgWriterOptions{SectionInfo: pcapgo.NgSectionInfo{Application: "Inspektor Gadget Desktop", Comment: string(section)}})
	if err != nil {
		return err
	}
	s.flush = writer.Flush
	if err := writer.Flush(); err != nil {
		return err
	}
	s.status.DatasourceIDs = []string{packetID}
	interfaces := make(map[string]int)
	interfaceBytes := 0
	return ds.Subscribe(func(_ datasource.DataSource, data datasource.Data) error {
		return s.consume(func() error {
			var ts time.Time
			if timestamp.Type() == api.Kind_Uint64 {
				raw, err := timestamp.Uint64(data)
				if err != nil || raw > math.MaxInt64 {
					return errors.New("invalid packet timestamp")
				}
				ts = time.Unix(0, int64(raw))
			} else {
				raw, err := timestamp.String(data)
				if err != nil {
					return errors.New("invalid packet timestamp")
				}
				ts, err = time.Parse(time.RFC3339Nano, raw)
				if err != nil {
					return errors.New("packet timestamp is not RFC3339Nano")
				}
				if ts.Before(time.Unix(0, 0)) || ts.After(time.Unix(0, math.MaxInt64)) {
					return errors.New("packet timestamp is outside supported nanosecond range")
				}
			}
			body, err := payload.Bytes(data)
			if err != nil {
				return errors.New("invalid packet payload")
			}
			size, err := length.Uint32(data)
			if err != nil || uint64(size) < uint64(len(body)) {
				return errors.New("invalid packet original length")
			}
			var key []byte
			for _, f := range keys {
				value := f.Get(data)
				key = binary.LittleEndian.AppendUint32(key, uint32(len(value)))
				key = append(key, value...)
				if len(key) > 65536 {
					return errors.New("PCAP-NG interface identity is too large")
				}
			}
			index, exists := interfaces[string(key)]
			if !exists {
				// Bound interface identity memory rather than accumulating an
				// unbounded capture-sized metadata cache.
				if len(interfaces) >= 65536 {
					return errors.New("PCAP-NG interface limit reached (65536)")
				}
				if interfaceBytes+len(key) > 8*1024*1024 {
					return errors.New("PCAP-NG interface identity memory limit reached (8 MiB)")
				}
				var description []string
				for _, v := range variables {
					value, err := v.field.String(data)
					if err != nil {
						return errors.New("invalid packet interface variable")
					}
					description = append(description, v.name+"="+url.QueryEscape(value))
				}
				if len(strings.Join(description, ";")) > 60000 {
					return errors.New("PCAP-NG interface metadata is too large")
				}
				index, err = writer.AddInterface(pcapgo.NgInterface{Name: fmt.Sprintf("%s/%d", packetID, len(interfaces)), Description: strings.Join(description, ";"), LinkType: layers.LinkTypeEthernet, TimestampResolution: 9})
				if err != nil {
					return err
				}
				interfaces[string(key)] = index
				interfaceBytes += len(key)
			}
			options := pcapgo.NgPacketOptions{}
			if comm != nil {
				value, err := comm.String(data)
				if err != nil {
					return errors.New("invalid process comment")
				}
				options.Comments = []string{"proc.comm=" + value}
				if len(options.Comments[0]) > 60000 {
					return errors.New("PCAP-NG process comment is too large")
				}
			}
			// The writer copies body into its buffer, so the payload may be
			// released on return; the sink flushes periodically and at Finalize.
			return writer.WritePacketWithOptions(gopacket.CaptureInfo{Timestamp: ts, InterfaceIndex: index, CaptureLength: len(body), Length: int(size)}, body, options)
		})
	}, 1000)
}
