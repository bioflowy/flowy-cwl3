package main

import (
	"testing"

	"github.com/google/go-cmp/cmp"
)

type Map1 map[string]interface{}

func SetLocation(file FileOrDirectory) error {
	if file.HasPath() {
		file.SetLocation("s3://flowy/test/" + file.GetPath())
		file.ClearPath()
	}
	return nil
}
func SetLocationFile(file File) error {
	if file.HasPath() {
		file.SetLocation("s3://flowy/test_file/" + file.GetPath())
		file.ClearPath()
	}
	return nil
}

func TestVisitFileOrDirectory(t *testing.T) {
	var map1 = map[string]interface{}{
		"class": "File",
		"path":  "test.txt",
	}
	expected := map[string]interface{}{
		"class":    "File",
		"location": "s3://flowy/test/test.txt",
	}
	VisitFileOrDirectory(map1, SetLocation)
	if diff := cmp.Diff(map1, expected); diff != "" {
		t.Errorf("User value is mismatch (-actual +expected):\n%s", diff)
	}
}
func TestVisitFile(t *testing.T) {
	var map1 = map[string]interface{}{
		"class": "File",
		"path":  "test.txt",
	}
	expected := map[string]interface{}{
		"class":    "File",
		"location": "s3://flowy/test_file/test.txt",
	}
	VisitFile(map1, SetLocationFile)
	if diff := cmp.Diff(map1, expected); diff != "" {
		t.Errorf("User value is mismatch (-actual +expected):\n%s", diff)
	}
}
