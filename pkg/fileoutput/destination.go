// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

// Package fileoutput implements explicitly authorized, foreground file captures.
package fileoutput

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Request struct {
	Token         string   `json:"token"`
	Format        string   `json:"format"`
	DatasourceIDs []string `json:"datasourceIds,omitempty"`
}

type Selection struct {
	Token     string `json:"token"`
	Format    string `json:"format"`
	Path      string `json:"path"`
	Host      string `json:"host"`
	Overwrite bool   `json:"overwrite"`
}

type Capabilities struct {
	Formats []string `json:"formats"`
	Host    string   `json:"host"`
}

// Target contains display metadata only, never environment connection options.
type Target struct {
	Name             string `json:"name"`
	Runtime          string `json:"runtime"`
	Context          string `json:"context,omitempty"`
	DefaultNamespace string `json:"defaultNamespace,omitempty"`
	Transient        bool   `json:"transient"`
}

type Status struct {
	Format        string   `json:"format"`
	Path          string   `json:"path"`
	PartialPath   string   `json:"partialPath,omitempty"`
	RecoveryPath  string   `json:"recoveryPath,omitempty"`
	Host          string   `json:"host"`
	State         string   `json:"state"`
	Records       uint64   `json:"records"`
	Bytes         uint64   `json:"bytes"`
	Error         string   `json:"error,omitempty"`
	DatasourceIDs []string `json:"datasourceIds,omitempty"`
}

type destination struct {
	Selection
	root    *os.Root
	parent  os.FileInfo
	before  os.FileInfo
	digest  [sha256.Size]byte
	expires time.Time
}

type Manager struct {
	mu      sync.Mutex
	host    string
	pending map[string]*destination
	active  map[string]bool
	closed  bool
	ops     fileOps
}

func NewManager(host string) *Manager {
	if host == "" {
		host = "local host"
	}
	return &Manager{host: host, pending: make(map[string]*destination), active: make(map[string]bool), ops: nativeFileOps}
}

func (m *Manager) Capabilities() Capabilities {
	return Capabilities{Formats: []string{"jsonl", "pcap-ng"}, Host: m.host}
}

func ValidateFormat(format string) error {
	if format != "jsonl" && format != "pcap-ng" {
		return errors.New("unsupported file output format")
	}
	return nil
}

func (m *Manager) Prepare(path, format string, overwrite bool) (*Selection, error) {
	if err := ValidateFormat(format); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return nil, errors.New("destination must be an absolute host filesystem path")
	}
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" && strings.Contains(filepath.Base(path), ":") {
		return nil, errors.New("alternate data streams are not output destinations")
	}
	parentPath, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return nil, fmt.Errorf("destination directory: %w", err)
	}
	path = filepath.Join(parentPath, filepath.Base(path))
	root, err := os.OpenRoot(parentPath)
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			root.Close()
		}
	}()
	parent, err := root.Stat(".")
	if err != nil {
		return nil, err
	}
	before, err := root.Lstat(filepath.Base(path))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	var digest [sha256.Size]byte
	if before != nil {
		if !before.Mode().IsRegular() {
			return nil, errors.New("destination is not a regular file")
		}
		if !overwrite {
			return nil, errors.New("destination exists; explicit replacement confirmation required")
		}
		// Replacement needs no-replace rename, which some platforms and
		// filesystems lack; say so now rather than when the capture ends.
		if err := m.ops.probeMove(root, filepath.Base(path)); err != nil {
			return nil, err
		}
		before, digest, err = fingerprint(root, filepath.Base(path))
		if err != nil {
			return nil, fmt.Errorf("fingerprinting destination: %w", err)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("file output host is shutting down")
	}
	for token, d := range m.pending {
		if time.Now().After(d.expires) {
			d.root.Close()
			delete(m.pending, token)
		}
	}
	if len(m.pending) >= 128 {
		return nil, errors.New("too many unused output selections")
	}
	if m.active[destinationKey(path)] {
		return nil, errors.New("destination is already reserved")
	}
	for _, d := range m.pending {
		if destinationKey(d.Path) == destinationKey(path) {
			return nil, errors.New("destination is already reserved")
		}
	}
	d := &destination{Selection: Selection{Token: uuid.NewString(), Format: format, Path: path, Host: m.host, Overwrite: overwrite && before != nil}, root: root, parent: parent, before: before, digest: digest, expires: time.Now().Add(30 * time.Minute)}
	m.pending[d.Token] = d
	keep = true
	selection := d.Selection
	return &selection, nil
}

func (m *Manager) Release(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if d := m.pending[token]; d != nil {
		d.root.Close()
		delete(m.pending, token)
	}
}

// unchanged cheaply re-checks the approved destination's identity (directory,
// inode, size, mode, mtime). Content is digested only at Prepare and once more
// on the displaced object during publication, where it closes the TOCTOU gap;
// re-hashing at Start and again before the move added cost (multi-GB files,
// under the sink lock) without closing any race.
func (d *destination) unchanged() error {
	parent, err := os.Stat(filepath.Dir(d.Path))
	if err != nil || !os.SameFile(d.parent, parent) {
		return errors.New("destination directory changed since approval")
	}
	current, err := d.root.Lstat(filepath.Base(d.Path))
	if d.before == nil && errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if d.before == nil || !sameFingerprintInfo(d.before, current) {
		return errors.New("destination changed since approval")
	}
	return nil
}

func sameFingerprintInfo(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Size() == b.Size() && a.Mode() == b.Mode() && a.ModTime().Equal(b.ModTime())
}

func fingerprint(root *os.Root, name string) (os.FileInfo, [sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	before, err := root.Lstat(name)
	if err != nil {
		return nil, digest, err
	}
	if !before.Mode().IsRegular() {
		return nil, digest, errors.New("destination is not a regular file")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, digest, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !sameFingerprintInfo(before, opened) {
		return nil, digest, errors.New("destination changed while opening it")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return nil, digest, err
	}
	after, err := file.Stat()
	if err != nil || !sameFingerprintInfo(opened, after) {
		return nil, digest, errors.New("destination changed while fingerprinting it")
	}
	copy(digest[:], hash.Sum(nil))
	return after, digest, nil
}

func (d *destination) matches(name string) error {
	info, digest, err := fingerprint(d.root, name)
	if err != nil {
		return err
	}
	if !sameFingerprintInfo(d.before, info) || d.digest != digest {
		return errors.New("destination changed since approval")
	}
	return nil
}

func (m *Manager) Open(req Request) (*Sink, error) {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, errors.New("file output host is shutting down")
	}
	d := m.pending[req.Token]
	if d == nil {
		m.mu.Unlock()
		return nil, errors.New("invalid or consumed output selection")
	}
	delete(m.pending, req.Token)
	if req.Format != d.Format || time.Now().After(d.expires) {
		m.mu.Unlock()
		d.root.Close()
		return nil, errors.New("stale or mismatched output selection")
	}
	key := destinationKey(d.Path)
	if m.active[key] {
		m.mu.Unlock()
		d.root.Close()
		return nil, errors.New("destination already in use")
	}
	m.active[key] = true
	m.mu.Unlock()
	ok := false
	defer func() {
		if !ok {
			d.root.Close()
			m.mu.Lock()
			delete(m.active, key)
			m.mu.Unlock()
		}
	}()
	// Identity check only (no content hash); runs outside m.mu regardless.
	if err := d.unchanged(); err != nil {
		return nil, err
	}
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return nil, errors.New("file output host is shutting down")
	}
	partial := "." + filepath.Base(d.Path) + "." + uuid.NewString() + ".partial"
	f, err := d.root.OpenFile(partial, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	ok = true
	s := newSink(f)
	s.destination, s.partial, s.manager = d, partial, m
	s.status = Status{Format: d.Format, Path: d.Path, PartialPath: filepath.Join(filepath.Dir(d.Path), partial), Host: d.Host, State: "starting", DatasourceIDs: append([]string(nil), req.DatasourceIDs...)}
	return s, nil
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	for token, d := range m.pending {
		d.root.Close()
		delete(m.pending, token)
	}
}

func destinationKey(path string) string {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.ToLower(path)
	}
	return path
}
