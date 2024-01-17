package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestWorkWithoutSymlink(t *testing.T) {
	tempDirPath, err := os.MkdirTemp("", "flowydeamon_fileutil")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tempDirPath)
	file, err := os.Create(filepath.Join(tempDirPath, "test1.txt"))
	if err != nil {
		panic(err)
	}
	defer file.Close()

	dirPath := filepath.Join(tempDirPath, "test")
	os.Mkdir(dirPath, 0755)
	file, err = os.Create(filepath.Join(dirPath, "test2.txt"))
	if err != nil {
		panic(err)
	}
	defer file.Close()
	results := []string{}
	err = WalkWithSymlink(tempDirPath, func(path string, info os.FileInfo, err error) error {
		results = append(results, path)
		return nil
	})
	expected := []string{tempDirPath, filepath.Join(tempDirPath, "test1.txt"), dirPath, filepath.Join(dirPath, "test2.txt")}
	sort.Strings(expected)
	sort.Strings(results)
	if !reflect.DeepEqual(results, expected) {
		t.Errorf("unexpected results ,expected: %v, actual: %v", expected, results)
	}
}
func TestWorkWithSymlink(t *testing.T) {
	tempDirPath, err := os.MkdirTemp("", "flowydeamon_fileutil")
	if err != nil {
		panic(err)
	}
	os.Symlink(tempDirPath, "symlink_to_dir")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tempDirPath)
	defer os.RemoveAll("symlink_to_dir")
	file, err := os.Create(filepath.Join(tempDirPath, "test1.txt"))
	if err != nil {
		panic(err)
	}
	defer file.Close()

	dirPath := filepath.Join(tempDirPath, "test")
	os.Mkdir(dirPath, 0755)
	file, err = os.Create(filepath.Join(dirPath, "test2.txt"))
	if err != nil {
		panic(err)
	}
	defer file.Close()
	type Info struct {
		Path  string
		IsDir bool
	}
	results := []Info{}
	err = WalkWithSymlink("symlink_to_dir", func(path string, info os.FileInfo, err error) error {
		results = append(results, Info{path, info.IsDir()})
		return nil
	})
	expected := []Info{{"symlink_to_dir", true},
		{filepath.Join("symlink_to_dir", "test1.txt"), false},
		{filepath.Join("symlink_to_dir", "test"), true},
		{filepath.Join("symlink_to_dir", "test/test2.txt"), false}}
	sort.Slice(expected, func(i, j int) bool {
		return expected[i].Path < expected[j].Path
	})
	sort.Slice(results, func(i, j int) bool {
		return results[i].Path < results[j].Path
	})
	if !reflect.DeepEqual(results, expected) {
		t.Errorf("unexpected results ,expected: %v, actual: %v", expected, results)
	}
}
