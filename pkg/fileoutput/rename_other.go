//go:build !linux && !darwin && !windows

// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"errors"
	"fmt"
	"os"
)

func renameNoReplace(*os.Root, string, string) error {
	return fmt.Errorf("%w: no-replace rename on this platform", errors.ErrUnsupported)
}
