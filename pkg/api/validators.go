// Copyright 2025 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package api

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

type ParamValidator func(value string) error

func ValidateInt(bitsize int) func(string) error {
	return func(value string) error {
		_, err := strconv.ParseInt(value, 10, bitsize)
		if err != nil {
			return fmt.Errorf("expected numeric value: %w", err)
		}
		return nil
	}
}

func ValidateUint(bitsize int) func(string) error {
	return func(value string) error {
		_, err := strconv.ParseUint(value, 10, bitsize)
		if err != nil {
			return fmt.Errorf("expected numeric value: %w", err)
		}
		return nil
	}
}

func ValidateFloat(bitsize int) func(string) error {
	return func(value string) error {
		_, err := strconv.ParseFloat(value, bitsize)
		if err != nil {
			return fmt.Errorf("expected numeric value: %w", err)
		}
		return nil
	}
}

func ValidateBool(value string) error {
	value = strings.ToLower(value)
	if value != "true" && value != "false" {
		return fmt.Errorf("expected 'true' or 'false', got: %q", value)
	}
	return nil
}

func ValidateIntRange(min, max int64) func(value string) error {
	return func(value string) error {
		number, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return fmt.Errorf("expected numeric value")
		}
		if number < min || number > max {
			return fmt.Errorf("number out of range: got %d, expected min %d, max %d", number, min, max)
		}
		return nil
	}
}

func ValidateUintRange(min, max uint64) func(value string) error {
	return func(value string) error {
		number, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return fmt.Errorf("expected numeric value: %w", err)
		}
		if number < min || number > max {
			return fmt.Errorf("number out of range: got %d, expected min %d, max %d", number, min, max)
		}
		return nil
	}
}

func ValidateSlice(validator ParamValidator) func(value string) error {
	return func(value string) error {
		// No value to validate
		if len(value) == 0 {
			return nil
		}
		for i, val := range strings.Split(value, ",") {
			if err := validator(val); err != nil {
				return fmt.Errorf("entry #%d (%q): %w", i+1, val, err)
			}
		}
		return nil
	}
}

func ValidateDuration(value string) error {
	_, err := time.ParseDuration(value)
	return err
}

func ValidateIP(value string) error {
	if value != "" && net.ParseIP(value) == nil {
		return fmt.Errorf("%q is not a valid IP address", value)
	}
	return nil
}
