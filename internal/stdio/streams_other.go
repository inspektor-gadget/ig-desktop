// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

//go:build !unix

package stdio

import "os"

// StdStreams returns the protocol stdin and stdout and points os.Stdout at
// stderr so stray Go writers cannot corrupt protocol frames. Windows pipes
// cannot be made pollable; the transport bounds writes with a timer and stops
// waiting for the reader on shutdown instead.
func StdStreams() (input, output *os.File, err error) {
	input, output = os.Stdin, os.Stdout
	os.Stdout = os.Stderr
	return input, output, nil
}
