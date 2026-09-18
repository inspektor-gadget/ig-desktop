// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"golang.org/x/sys/unix"
	"os"
)

// renameNoReplace fails with ENOTSUP (errors.ErrUnsupported) on volumes that
// do not support RENAME_EXCL.
func renameNoReplace(root *os.Root, from, to string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return unix.RenameatxNp(int(dir.Fd()), from, int(dir.Fd()), to, unix.RENAME_EXCL)
}
