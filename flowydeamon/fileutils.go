package main

import (
	"os"
	"path/filepath"
	"strings"
)

func WalkWithSymlink(directoryPath string, walkFunc filepath.WalkFunc) error {
	return walk(directoryPath, walkFunc, nil)
}

func walk(directoryPath string, walkFunc filepath.WalkFunc, prefix *string) error {
	if strings.HasSuffix(directoryPath, "/") {
		directoryPath = directoryPath + "/"
	}
	err := filepath.Walk(directoryPath, func(path string, info os.FileInfo, err error) error {
		orgPath := path
		if prefix != nil {
			orgPath = filepath.Join(*prefix, strings.TrimPrefix(path, directoryPath))
		}
		if info.Mode()&os.ModeSymlink != 0 {
			realpath, err := filepath.EvalSymlinks(path)
			if err != nil {
				return err
			}
			walk(realpath, walkFunc, &orgPath)
		} else {
			err := walkFunc(orgPath, info, err)
			if err != nil {
				return err
			}
		}
		return nil
	})
	return err
}
