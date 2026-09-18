// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package stdio

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// StdStreams returns private copies of the process's stdin and stdout for the
// protocol and then points fd 0 at /dev/null and fd 1 at stderr, so no other
// writer (fmt.Print, a library, a child process) can corrupt protocol frames.
//
// Hosts usually hand the child blocking pipe fds, which Go's os.File cannot
// poll: Close would not interrupt Read and write deadlines would be
// unsupported. Pipe and socket copies are therefore switched to non-blocking
// mode so the runtime poller manages them.
func StdStreams() (input, output *os.File, err error) {
	if input, err = pollableDup(0, "protocol-stdin"); err != nil {
		return nil, nil, err
	}
	if output, err = pollableDup(1, "protocol-stdout"); err != nil {
		input.Close()
		return nil, nil, err
	}
	fail := func(err error) (*os.File, *os.File, error) {
		input.Close()
		output.Close()
		return nil, nil, err
	}
	if err := unix.Dup2(2, 1); err != nil {
		return fail(fmt.Errorf("redirecting stdout to stderr: %w", err))
	}
	devNull, err := os.Open(os.DevNull)
	if err != nil {
		return fail(err)
	}
	defer devNull.Close()
	if err := unix.Dup2(int(devNull.Fd()), 0); err != nil {
		return fail(fmt.Errorf("detaching stdin: %w", err))
	}
	return input, output, nil
}

// pollableDup duplicates fd and, for pipes and sockets, makes the copy
// non-blocking so os.NewFile registers it with the runtime poller. O_NONBLOCK
// is shared with the original fd; StdStreams replaces the originals.
func pollableDup(fd int, name string) (*os.File, error) {
	syscall.ForkLock.RLock()
	dup, err := unix.Dup(fd)
	if err == nil {
		unix.CloseOnExec(dup)
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return nil, fmt.Errorf("duplicating fd %d: %w", fd, err)
	}
	if err := makePollable(dup); err != nil {
		unix.Close(dup)
		return nil, fmt.Errorf("fd %d: %w", fd, err)
	}
	return os.NewFile(uintptr(dup), name), nil
}

func makePollable(fd int) error {
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return err
	}
	switch st.Mode & unix.S_IFMT {
	case unix.S_IFIFO, unix.S_IFSOCK:
		return unix.SetNonblock(fd, true)
	}
	// Regular files and terminals stay blocking; the transport bounds writes
	// with a timer and does not depend on Read returning to exit.
	return nil
}
