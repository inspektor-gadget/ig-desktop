// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	jsonformatter "github.com/inspektor-gadget/ig-desktop/pkg/json"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
)

// outputFile is the partial capture file (*os.File in production). Sync is
// required so a published capture is durable, not just handed to the OS.
type outputFile interface {
	io.WriteCloser
	Sync() error
}

// flushInterval bounds how much buffered output a crash can lose.
const flushInterval = time.Second

type Sink struct {
	mu          sync.Mutex
	file        outputFile
	out         *bufio.Writer // buffers encoder output in front of file
	stopFlush   chan struct{}
	destination *destination
	partial     string
	manager     *Manager
	status      Status
	err         error
	closed      bool
	initialized bool
	cancel      func()
	flush       func() error
}

func newSink(file outputFile) *Sink {
	s := &Sink{file: file, stopFlush: make(chan struct{})}
	s.out = bufio.NewWriterSize(fileWriter{s}, 64*1024)
	go s.flushPeriodically()
	return s
}

// Write buffers encoder output (JSONL lines, PCAP-NG blocks). It is called
// only under mu. Output reaches the file when the buffer fills, on the
// periodic flush and at Finalize, so a crash loses at most ~flushInterval.
func (s *Sink) Write(p []byte) (int, error) {
	return s.out.Write(p)
}

// fileWriter is the buffer's sink; Bytes counts what the OS accepted.
type fileWriter struct{ s *Sink }

func (w fileWriter) Write(p []byte) (int, error) {
	n, err := w.s.file.Write(p)
	w.s.status.Bytes += uint64(n)
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	return n, err
}

// flushLocked pushes encoder and sink buffers to the file. Caller holds mu.
func (s *Sink) flushLocked() error {
	var err error
	if s.flush != nil {
		err = s.flush()
	}
	return errors.Join(err, s.out.Flush())
}

func (s *Sink) flushPeriodically() {
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopFlush:
			return
		case <-ticker.C:
			s.mu.Lock()
			if !s.closed && s.err == nil {
				s.fail(s.flushLocked())
			}
			s.mu.Unlock()
		}
	}
}

func (s *Sink) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshot()
}

func (s *Sink) snapshot() Status {
	status := s.status
	status.DatasourceIDs = append([]string(nil), status.DatasourceIDs...)
	return status
}

func (s *Sink) fail(err error) error {
	if err != nil && s.err == nil {
		s.err = err
		s.status.Error = boundedError(err)
		s.status.State = "stopping"
		if s.cancel != nil {
			s.cancel()
		}
	}
	return err
}

func (s *Sink) Stopping() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.status.State = "stopping"
	}
}

func (s *Sink) line(value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.Write(append(b, '\n'))
	return err
}

// Subscribe validates every selected source before registering callbacks. The
// lock also fences late callbacks: finalization can never race a file write.
func (s *Sink) Subscribe(sources map[string]datasource.DataSource, provenance any, cancel func()) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("output is already closed")
	}
	s.cancel = cancel
	explicitSelection := len(s.status.DatasourceIDs) > 0
	ids := append([]string(nil), s.status.DatasourceIDs...)
	if len(ids) == 0 {
		for id := range sources {
			ids = append(ids, id)
		}
		sort.Strings(ids)
	}
	seen := make(map[string]bool)
	for _, id := range ids {
		ds := sources[id]
		if ds == nil || seen[id] {
			return s.fail(fmt.Errorf("unknown or duplicate datasource %q", id))
		}
		if ds.Type() != datasource.TypeSingle && ds.Type() != datasource.TypeArray {
			return s.fail(fmt.Errorf("unsupported datasource %q type", id))
		}
		seen[id] = true
	}
	if len(ids) == 0 {
		return s.fail(errors.New("no supported datasources"))
	}
	s.status.DatasourceIDs = ids
	if s.status.Format == "pcap-ng" {
		if err := s.subscribePCAP(sources, ids, explicitSelection, provenance); err != nil {
			return s.fail(err)
		}
	} else {
		formatters := make(map[string]*jsonformatter.Formatter)
		for _, id := range ids {
			f, err := jsonformatter.New(sources[id], jsonformatter.WithFlatten(true), jsonformatter.WithShowAll(true), jsonformatter.WithExactIntegers())
			if err != nil {
				return s.fail(err)
			}
			formatters[id] = f
		}
		if err := s.line(map[string]any{"type": "capture", "version": 1, "format": "ig-jsonl", "provenance": provenance, "integerEncoding": "int64-uint64-and-integer-arrays-decimal-strings"}); err != nil {
			return s.fail(err)
		}
		for _, id := range ids {
			ds := sources[id]
			if err := s.line(map[string]any{"type": "schema", "datasourceId": id, "datasourceType": ds.Type(), "fields": ds.Fields(), "annotations": ds.Annotations()}); err != nil {
				return s.fail(err)
			}
		}
		for _, id := range ids {
			ds, f := sources[id], formatters[id]
			var err error
			if ds.Type() == datasource.TypeArray {
				err = ds.SubscribeArray(func(_ datasource.DataSource, data datasource.DataArray) error {
					return s.consume(func() error {
						return s.line(map[string]any{"type": "snapshot", "datasourceId": id, "data": json.RawMessage(f.MarshalArray(data))})
					})
				}, 1000)
			} else {
				err = ds.Subscribe(func(_ datasource.DataSource, data datasource.Data) error {
					return s.consume(func() error {
						return s.line(map[string]any{"type": "data", "datasourceId": id, "data": json.RawMessage(f.Marshal(data))})
					})
				}, 1000)
			}
			if err != nil {
				return s.fail(err)
			}
		}
	}
	s.initialized = true
	s.status.State = "running"
	return nil
}

func (s *Sink) consume(write func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("output is finalized")
	}
	if s.err != nil {
		return s.err
	}
	if err := write(); err != nil {
		return s.fail(err)
	}
	s.status.Records++
	return nil
}

// Finalize must follow runtime receiver/operator shutdown. Success is published
// only after encoder flush, fsync and file close; failures retain the sibling
// partial if it holds any records.
func (s *Sink) Finalize(runErr error) Status {
	s.mu.Lock()
	if s.closed {
		defer s.mu.Unlock()
		return s.snapshot()
	}
	s.closed = true
	close(s.stopFlush)
	s.status.State = "stopping"
	if !s.initialized && runErr == nil {
		runErr = errors.New("capture ended before datasource initialization")
	}
	err := errors.Join(s.err, runErr, s.flushLocked())
	if err == nil {
		// Without fsync a crash shortly after publication can leave the
		// final name pointing at a truncated or empty file.
		err = s.file.Sync()
	}
	err = errors.Join(err, s.file.Close())
	if err == nil {
		// closed fences every writer, so publication (which digests the
		// displaced file) runs without blocking Status readers.
		paths := s.status
		s.mu.Unlock()
		err = publishOutput(s.destination, s.partial, &paths, s.manager.ops)
		s.mu.Lock()
		s.status.PartialPath, s.status.RecoveryPath = paths.PartialPath, paths.RecoveryPath
	}
	defer s.mu.Unlock()
	if err != nil {
		s.status.State = "failed"
		s.status.Error = boundedError(err)
		// A failed or never-started run without records leaves at most
		// headers; do not strand a hidden, useless partial beside the target.
		if s.status.Records == 0 && s.status.PartialPath != "" && s.destination.root.Remove(s.partial) == nil {
			s.status.PartialPath = ""
		}
	} else {
		s.status.State = "completed"
	}
	s.destination.root.Close()
	s.manager.mu.Lock()
	delete(s.manager.active, destinationKey(s.status.Path))
	s.manager.mu.Unlock()
	return s.snapshot()
}

// syncDir fsyncs the held destination directory so a rename/link survives a
// crash. Windows cannot flush a directory handle opened by os (it needs write
// access) and NTFS journals metadata, so it is skipped there; filesystems that
// do not support directory fsync (EINVAL/ENOTSUP) are tolerated.
func syncDir(root *os.Root) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil && !errors.Is(err, syscall.EINVAL) && !errors.Is(err, errors.ErrUnsupported) {
		return err
	}
	return nil
}

func boundedError(err error) string {
	message := err.Error()
	if len(message) > 4096 {
		return message[:4096] + " (truncated)"
	}
	return message
}

// fileOps are the no-replace primitives publication uses; tests inject races
// and missing filesystem support through them.
type fileOps struct {
	move func(root *os.Root, from, to string) error // renameNoReplace
	link func(root *os.Root, from, to string) error // (*os.Root).Link
}

var nativeFileOps = fileOps{move: renameNoReplace, link: (*os.Root).Link}

// probeMove checks that the directory supports no-replace rename, which
// replacing an existing destination requires, using a throwaway file.
func (o fileOps) probeMove(root *os.Root, name string) error {
	probe := "." + name + "." + uuid.NewString() + ".probe"
	f, err := root.OpenFile(probe, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("checking destination directory: %w", err)
	}
	f.Close()
	err = o.move(root, probe, probe+"-renamed")
	root.Remove(probe)
	root.Remove(probe + "-renamed")
	if errors.Is(err, errors.ErrUnsupported) {
		return fmt.Errorf("replacing an existing file is not supported on this platform or filesystem; choose a new file name: %w", err)
	}
	if err != nil {
		return fmt.Errorf("checking destination directory: %w", err)
	}
	return nil
}

// place gives the object at from the name to without ever replacing an
// existing to. No-replace rename is preferred: it is one atomic step and works
// on filesystems without hard links (FAT32/exFAT, many SMB shares and FUSE
// mounts). Only where the platform or filesystem lacks no-replace rename does
// it fall back to an exclusive hard link plus removal of from; moved reports
// whether from is gone afterwards.
func (o fileOps) place(root *os.Root, from, to string) (moved bool, err error) {
	err = o.move(root, from, to)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, errors.ErrUnsupported) {
		return false, err
	}
	if linkErr := o.link(root, from, to); linkErr != nil {
		return false, errors.Join(err, linkErr)
	}
	return root.Remove(from) == nil, nil
}

func publishOutput(d *destination, partial string, status *Status, ops fileOps) error {
	// Cheap identity check first; the content digest is taken only once,
	// below, on the object that was actually displaced.
	if err := d.unchanged(); err != nil {
		return err
	}
	name := filepath.Base(d.Path)
	recovery := ""
	restore := func(cause error) error {
		if recovery == "" {
			return cause
		}
		moved, err := ops.place(d.root, recovery, name)
		if err != nil {
			return errors.Join(cause, fmt.Errorf("displaced destination retained at %s; no-replace restore failed: %w", status.RecoveryPath, err))
		}
		if moved {
			status.RecoveryPath = ""
		}
		return cause
	}
	if d.before != nil {
		// Displacing the approved file needs a real no-replace rename: a link
		// plus unlink of the final name could remove a raced-in file.
		recovery = "." + name + "." + uuid.NewString() + ".recovery"
		if err := ops.move(d.root, name, recovery); err != nil {
			return fmt.Errorf("moving approved destination to recovery without replacement: %w", err)
		}
		status.RecoveryPath = filepath.Join(filepath.Dir(d.Path), recovery)
		// Validate the object actually moved, not just the name checked before
		// the move: this is the one digest that closes the check-then-act gap,
		// because the displaced object can no longer be swapped by name. A
		// raced-in object is restored only if the final name is free.
		if err := d.matches(recovery); err != nil {
			return restore(err)
		}
	}
	// Publication never replaces a name. A competing creation wins and both
	// the new partial and (if restore is blocked) recovery remain available.
	moved, err := ops.place(d.root, partial, name)
	if err != nil {
		return restore(fmt.Errorf("publishing output without replacement: %w", err))
	}
	if moved {
		status.PartialPath = ""
	}
	// The replacement succeeded, so the displaced file is no longer needed.
	// Unlinking it does not affect processes that still hold it open: POSIX
	// keeps an unlinked inode alive until its last handle closes, and Windows
	// handles opened with FILE_SHARE_DELETE behave the same way.
	if recovery != "" && d.root.Remove(recovery) == nil {
		status.RecoveryPath = ""
	}
	// Persist the directory entries (publication and removals).
	if err := syncDir(d.root); err != nil {
		return fmt.Errorf("syncing destination directory: %w", err)
	}
	return nil
}
