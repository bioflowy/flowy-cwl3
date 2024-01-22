package main

import (
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestRevmapFile(t *testing.T) {
	// Test [78/378] json_output_location_relative:
	// Test support for reading cwl.output.json where 'location' is relative reference to output dir.
	f := NewFile("foo", nil)
	RevmapFile("/CONTOUT", "file://tmp/abcd-efg-hij", f)
	expected := NewFile("file://tmp/abcd-efg-hij/foo", nil)
	if diff := cmp.Diff(f, expected); diff != "" {
		t.Errorf("User value is mismatch (-actual +expected):\n%s", diff)
	}
}
