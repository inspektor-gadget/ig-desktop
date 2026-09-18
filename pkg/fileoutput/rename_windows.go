// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"errors"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func renameNoReplace(root *os.Root, from, to string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	name, err := windows.NewNTUnicodeString(from)
	if err != nil {
		return err
	}
	attrs := windows.OBJECT_ATTRIBUTES{RootDirectory: windows.Handle(dir.Fd()), ObjectName: name, Attributes: windows.OBJ_DONT_REPARSE}
	attrs.Length = uint32(unsafe.Sizeof(attrs))
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	err = windows.NtCreateFile(&handle, windows.DELETE|windows.SYNCHRONIZE, &attrs, &status, nil, 0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		windows.FILE_OPEN, windows.FILE_NON_DIRECTORY_FILE|windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	target, err := windows.UTF16FromString(to)
	if err != nil {
		return err
	}
	type renameInformation struct {
		ReplaceIfExists uint32
		RootDirectory   windows.Handle
		FileNameLength  uint32
		FileName        [1]uint16
	}
	var info renameInformation
	size := int(unsafe.Offsetof(info.FileName)) + (len(target)-1)*2
	buffer := make([]byte, size)
	p := (*renameInformation)(unsafe.Pointer(&buffer[0]))
	// ReplaceIfExists remains zero: never replace either publication or
	// recovery names, including during rollback after a competing creation.
	p.RootDirectory = windows.Handle(dir.Fd())
	p.FileNameLength = uint32((len(target) - 1) * 2)
	copy(unsafe.Slice(&p.FileName[0], len(target)-1), target[:len(target)-1])
	err = windows.NtSetInformationFile(handle, &status, &buffer[0], uint32(size), windows.FileRenameInformation)
	if errors.Is(err, windows.STATUS_NOT_SUPPORTED) || errors.Is(err, windows.STATUS_INVALID_DEVICE_REQUEST) {
		return fmt.Errorf("%w: %w", errors.ErrUnsupported, err)
	}
	return err
}
