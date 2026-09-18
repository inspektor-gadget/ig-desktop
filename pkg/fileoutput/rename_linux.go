// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func renameNoReplace(root *os.Root, from, to string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	err = unix.Renameat2(int(dir.Fd()), from, int(dir.Fd()), to, unix.RENAME_NOREPLACE)
	if errors.Is(err, unix.EINVAL) {
		// Filesystems that do not implement RENAME_NOREPLACE (some FUSE,
		// older NFS) reject the flag with EINVAL.
		return fmt.Errorf("%w: %w", errors.ErrUnsupported, err)
	}
	return err
}
