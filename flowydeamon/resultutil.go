package main

import (
	"path/filepath"
	"reflect"
)

type FileOrDirectory interface {
	GetClass() string
	IsFile() bool
	IsDirectory() bool
	HasLocation() bool
	GetLocation() string
	SetLocation(string)
	ClearPath()
	HasPath() bool
	GetPath() string
	SetPath(string)
	HasBasename() bool
	GetBasename() string
	SetBasename(string)
}
type Directory interface {
	GetClass() string
	IsFile() bool
	IsDirectory() bool
	HasLocation() bool
	GetLocation() string
	SetLocation(string)
	ClearPath()
	HasPath() bool
	GetPath() string
	SetPath(string)
	GetListing() []FileOrDirectory
	SetListing([]FileOrDirectory)
	HasBasename() bool
	GetBasename() string
	SetBasename(string)
}

func NewDirectory(location string, path *string) Directory {
	dir := DataMap{
		"class":    "Directory",
		"location": location,
		"basename": filepath.Base(location),
	}
	if path != nil {
		dir["path"] = *path
	}
	return dir
}
func (o DataMap) SetListing(listing []FileOrDirectory) {
	o["listing"] = listing
}
func (o DataMap) GetListing() []FileOrDirectory {
	l, exists := o["listing"]
	if !exists {
		return []FileOrDirectory{}
	}
	class, ok := l.([]FileOrDirectory)
	if ok {
		return class
	} else {
		return []FileOrDirectory{}
	}
}

type File interface {
	GetClass() string
	IsFile() bool
	IsDirectory() bool
	HasLocation() bool
	GetLocation() string
	SetLocation(string)
	HasPath() bool
	GetPath() string
	SetPath(string)
	ClearPath()
	HasBasename() bool
	GetBasename() string
	SetBasename(string)
	GetDirname() string
	SetDirname(string)
	GetNameroot() string
	SetNameroot(string)
	HasChecksum() bool
	GetChecksum() string
	SetChecksum(string)
	GetSize() int64
	SetSize(int64)
	GetContent() string
	SetContent(string)
	GetWritable() bool
	SetWritable(bool)
	GetSecondaryFiles() []FileOrDirectory
	SetSecondaryFiles([]FileOrDirectory)
}

func NewFile(location string, path *string) File {
	decodedBasename := filepath.Base(location)
	nameroot, nameext := splitext(decodedBasename)
	var file File = DataMap{
		"class":    "File",
		"location": location,
		"basename": decodedBasename,
		"nameroot": nameroot,
		"nameext":  nameext,
	}
	if path != nil {
		file.SetPath(*path)
	}
	return file
}

func (o DataMap) GetClass() string {
	l, exists := o["class"]
	if !exists {
		return ""
	}
	class, ok := l.(string)
	if ok {
		return class
	} else {
		return ""
	}
}
func (o DataMap) SetClass(className string) {
	o["class"] = className
}
func (o DataMap) IsFile() bool {
	return o.GetClass() == "File"
}
func (o DataMap) IsDirectory() bool {
	return o.GetClass() == "Directory"
}

// GetLocation returns the Location field value if set, zero value otherwise.
func (o DataMap) HasLocation() bool {
	_, exists := o["location"]
	return exists
}
func (o DataMap) GetLocation() string {
	l, exists := o["location"]
	if !exists {
		return ""
	}
	location, ok := l.(string)
	if ok {
		return location
	} else {
		return ""
	}
}
func (o DataMap) SetLocation(location string) {
	o["location"] = location
}

// GetLocation returns the Location field value if set, zero value otherwise.
func (o DataMap) HasPath() bool {
	_, exists := o["path"]
	return exists
}
func (o DataMap) GetPath() string {
	p, exists := o["path"]
	if !exists {
		return ""
	}
	value, ok := p.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) ClearPath() {
	delete(o, "path")
}
func (o DataMap) ClearDirName() {
	delete(o, "dirname")
}
func (o DataMap) SetPath(path string) {
	o["path"] = path
}
func (o DataMap) HasBasename() bool {
	_, exists := o["basename"]
	return exists
}
func (o DataMap) GetBasename() string {
	v, exists := o["basename"]
	if !exists {
		return ""
	}
	value, ok := v.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) SetBasename(path string) {
	o["basename"] = path
}
func (o DataMap) GetDirname() string {
	v, exists := o["dirname"]
	if !exists {
		return ""
	}
	value, ok := v.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) SetDirname(path string) {
	o["dirname"] = path
}
func (o DataMap) GetNameroot() string {
	v, exists := o["nameroot"]
	if !exists {
		return ""
	}
	value, ok := v.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) SetNameroot(path string) {
	o["nameroot"] = path
}
func (o DataMap) GetNameext() string {
	v, exists := o["nameext"]
	if !exists {
		return ""
	}
	value, ok := v.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) SetNameext(path string) {
	o["nameext"] = path
}
func (o DataMap) HasChecksum() bool {
	_, exists := o["checksum"]
	return exists
}

func (o DataMap) GetChecksum() string {
	v, exists := o["checksum"]
	if !exists {
		return ""
	}
	value, ok := v.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) SetChecksum(path string) {
	o["checksum"] = path
}
func (o DataMap) SetContent(path string) {
	o["contents"] = path
}
func (o DataMap) GetContent() string {
	v, exists := o["contents"]
	if !exists {
		return ""
	}
	value, ok := v.(string)
	if ok {
		return value
	} else {
		return ""
	}
}
func (o DataMap) SetSize(path int64) {
	o["size"] = path
}
func (o DataMap) GetSize() int64 {
	v, exists := o["size"]
	if !exists {
		return -1
	}
	value, ok := v.(int64)
	if ok {
		return value
	} else {
		return -1
	}
}
func (o DataMap) SetWritable(path bool) {
	o["writable"] = path
}
func (o DataMap) GetWritable() bool {
	v, exists := o["writable"]
	if !exists {
		return false
	}
	value, ok := v.(bool)
	if ok {
		return value
	} else {
		return false
	}
}
func (o DataMap) SetSecondaryFiles(secondaryFiles []FileOrDirectory) {
	o["secondaryFiles"] = secondaryFiles
}
func (o DataMap) GetSecondaryFiles() []FileOrDirectory {
	v, exists := o["secondaryFiles"]
	if !exists {
		return nil
	}
	value, ok := v.([]FileOrDirectory)
	if ok {
		return value
	} else {
		return nil
	}
}

func VisitFileOrDirectory(arg interface{}, visitFunc func(FileOrDirectory) error) error {
	if arg == nil {
		return nil
	}
	callVisitFunc := func(dm DataMap) error {
		if dm.GetClass() == "File" || dm.GetClass() == "Directory" {
			return visitFunc(dm)
		} else {
			for _, value := range dm {
				err := VisitFileOrDirectory(value, visitFunc)
				if err != nil {
					return err
				}
			}
		}
		return nil
	}
	switch v := arg.(type) {
	case map[string]interface{}:
		err := callVisitFunc(DataMap(v))
		return err
	case DataMap:
		err := callVisitFunc(v)
		if v.IsFile() {
			secondaryFiles := v.GetSecondaryFiles()
			for _, secondary := range secondaryFiles {
				err := callVisitFunc(secondary.(DataMap))
				if err != nil {
					return err
				}
			}
		} else if v.IsDirectory() {
			lists := v.GetListing()
			for _, list := range lists {
				err := callVisitFunc(list.(DataMap))
				if err != nil {
					return err
				}
			}
		}
		return err
	case []interface{}:
		for _, val := range v {
			err := VisitFileOrDirectory(val, visitFunc)
			if err != nil {
				return err
			}
		}
	case []FileOrDirectory:
		for _, val := range v {
			err := VisitFileOrDirectory(val, visitFunc)
			if err != nil {
				return err
			}
		}
	case []File:
		for _, val := range v {
			err := VisitFileOrDirectory(val, visitFunc)
			if err != nil {
				return err
			}
		}
	default:
	}
	valueType := reflect.TypeOf(arg)
	value := reflect.ValueOf(arg)
	if valueType.Kind() == reflect.Array || valueType.Kind() == reflect.Slice {
		for i := 0; i < value.Len(); i++ {
			err := VisitFileOrDirectory(value.Index(i), visitFunc)
			if err != nil {
				return err
			}
		}
	}
	return nil
}
func VisitFile(arg interface{}, visitFunc func(File) error) error {
	return VisitFileOrDirectory(arg, func(val FileOrDirectory) error {
		if val.IsFile() {
			return visitFunc(val.(File))
		}
		return nil
	})
}
