package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/aws/aws-sdk-go/service/s3/s3manager"
)

type FileSystemEntity interface {
	GetLocation() string
	GetPath() string
	SetLocation(string)
	SetPath(string)
	GetBasename() string
	SetBasename(string)
}
type DataMap map[string]interface{}

// GetLocation returns the Location field value if set, zero value otherwise.
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
func (o DataMap) SetPath(path string) {
	o["path"] = path
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

type LoggingRoundTripper struct {
	Proxied http.RoundTripper
}

func (lrt *LoggingRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	log.Printf("Request URL: %s\n", r.URL.String())
	return lrt.Proxied.RoundTrip(r)
}
func collect_secondary_files(
	c *APIClient,
	config *SharedFileSystemConfig,
	id string,
	schema OutputBinding,
	results []ApiDoEvalPostRequestContext,
	outdir string,
	builderOutDir string,
) error {
	for _, primary2 := range results {
		if primary2.File == nil {
			// secondary files are only defined for files
			continue
		}
		primary := primary2.File
		fullPath := primary.GetPath()
		sepIndex := strings.LastIndex(fullPath, string(filepath.Separator))
		var pathprefix string
		if sepIndex != -1 {
			pathprefix = fullPath[:sepIndex+1]
		} else {
			pathprefix = fullPath
		}
		for _, sf := range schema.SecondaryFiles {
			var sf_required = false
			if sf.RequiredString != nil {
				sf_required_eval := do_eval(c, id, *sf.RequiredString, ApiDoEvalPostRequestContext{File: primary})
				required_bool, ok := sf_required_eval.(bool)
				if !ok {
					return errors.New(
						`Expressions in the field 'required' must evaluate to a Boolean (true or false) or None. Got ${str(
				  sf_required_eval,
				)} for ${sf.requiredString}.`,
					)
				}
				sf_required = required_bool
			} else if sf.RequiredBoolean != nil {
				sf_required = *sf.RequiredBoolean
			}
			var sfpath interface{}
			if strings.Contains(sf.Pattern, "$(") || strings.Contains(sf.Pattern, "${") {
				sfpath = do_eval(c, id, sf.Pattern, ApiDoEvalPostRequestContext{File: primary})
			} else {
				sfpath = substitute(primary.GetBasename(), sf.Pattern)
			}

			for _, sfitem := range aslist(sfpath) {
				if sfitem == nil {
					continue
				}
				var secondaryFile DataMap = map[string]interface{}{}
				switch sfitem2 := sfitem.(type) {
				case string:
					secondaryFile.SetPath(pathprefix + sfitem2)
				case map[string]interface{}:
					secondaryFile = sfitem2
				}
				if secondaryFile.GetPath() != "" && secondaryFile.GetLocation() == "" {
					RevmapFile(builderOutDir, outdir, secondaryFile)
				}
				if isFile(config, outdir, secondaryFile.GetLocation()) {
					primary.SecondaryFiles = append(primary.SecondaryFiles, FileAllOfSecondaryFilesInner{ChildFile: convertToFile(secondaryFile)})
				} else if isDir(config, outdir, secondaryFile.GetLocation()) {
					primary.SecondaryFiles = append(primary.SecondaryFiles, FileAllOfSecondaryFilesInner{ChildDirectory: convertToDirectory(secondaryFile)})
				}
			}
			if sf_required {
				if len(primary.SecondaryFiles) == 0 {
					return errors.New("Missing required secondary file for output " + primary.GetLocation())
				}
			}
		}
	}
	return nil
}
func abspath(src string, basedir string) (string, error) {
	var abpath string

	u, err := url.Parse(src)
	if err != nil {
		return "", err
	}

	if strings.HasPrefix(src, "file://") {
		// uri_file_path関数のGo言語での相当する処理を行う
		// この関数の具体的な実装は、このコードでは省略されています
		abpath, err = uriFilePath(src)
		if err != nil {
			return "", err
		}
	} else if u.Scheme == "http" || u.Scheme == "https" {
		return src, nil
	} else {
		if strings.HasPrefix(basedir, "file://") {
			if filepath.IsAbs(src) {
				abpath = src
			} else {
				abpath = basedir + "/" + src
			}
		} else {
			if filepath.IsAbs(src) {
				abpath = src
			} else {
				abpath = filepath.Join(basedir, src)
			}
		}
	}

	return abpath, nil
}
func reportFailed(c *APIClient, jobId string, err error) {
	ctx := context.Background()
	r := c.DefaultAPI.ApiJobFailedPost(ctx)
	r.apiJobFailedPostRequest = &ApiJobFailedPostRequest{
		Id:       jobId,
		ErrorMsg: err.Error(),
	}
	r.Execute()
}
func relinkInitialWorkDir(config *SharedFileSystemConfig, vols []MapperEnt, hostOutDir, containerOutDir string, inplaceUpdate bool) error {
	for _, vol := range vols {
		if !vol.Staged {
			continue
		}
		if contains([]string{"File", "Directory"}, vol.Type) ||
			(inplaceUpdate && contains([]string{"WritableFile", "WritableDirectory"}, vol.Type)) {
			if !strings.HasPrefix(vol.Target, containerOutDir) {
				continue
			}
			hostOutDirTgt := filepath.Join(hostOutDir, vol.Target[len(containerOutDir)+1:])
			stat, err := os.Lstat(hostOutDirTgt)

			if err == nil {
				if (stat.Mode()&os.ModeSymlink != 0) || !stat.IsDir() {
					if err := os.Remove(hostOutDirTgt); err != nil && !errors.Is(err, os.ErrPermission) && !errors.Is(err, os.ErrNotExist) {
						return err
					}
				} else if stat.IsDir() && !strings.HasPrefix(vol.Resolved, "_:") {
					if err := removeIgnorePermissionError(hostOutDirTgt); err != nil {
						return err
					}
				}
			}

			if !strings.HasPrefix(vol.Resolved, "_:") {
				filePath := vol.Resolved
				if strings.HasPrefix(filePath, "s3://") {
					// TODO Avoid downloading the same file twice
					filePath, err = downloadS3FileToTemp(config, filePath, nil)
					if err != nil {
						return err
					}
				}
				if err := os.Symlink(filePath, hostOutDirTgt); err != nil && !os.IsExist(err) {
					return err
				}
			}
		}
	}
	return nil
}
func GetAndExecuteJob(c *APIClient, config *SharedFileSystemConfig) {
	ctx := context.Background()
	res, httpres, err := c.DefaultAPI.ApiGetExectableJobPost(ctx).Execute()

	if err != nil {
		return
	}
	if httpres.StatusCode == 200 {
		for _, job := range res {
			err := prepareStagingDir(config, job.Staging)
			if err != nil {
				panic(err)
			}
			exitCode, err := executeJob(config, job.Commands, job.StdinPath, job.StdoutPath, job.StderrPath, job.Env, job.Cwd, job.Timelimit)
			if err != nil {
				panic(err)
			}
			relinkInitialWorkDir(config, job.Vols, job.Cwd, job.BuilderOutdir, job.InplaceUpdate)
			var glob1 = []string{"cwl.output.json"}
			files, err := globOutput(
				job.BuilderOutdir,
				OutputBinding{
					Name:           "cwl.output.json",
					Glob:           glob1,
					SecondaryFiles: []OutputBindingSecondaryFilesInner{},
					LoadContents:   PtrBool(true),
				},
				job.Cwd,
				true,
			)
			if err != nil {
				reportFailed(c, job.Id, err)
				return
			}
			results := map[string][]ApiDoEvalPostRequestContext{}
			if len(files) > 0 {
				results["cwl.output.json"] = files
			}
			for _, output := range job.OutputBindings {
				files2, err := globOutput(
					job.BuilderOutdir,
					output,
					job.Cwd,
					true,
				)
				if err != nil {
					reportFailed(c, job.Id, err)
					return
				}
				if len(files2) > 0 {
					results[output.Name] = files2
					for _, file := range files2 {
						collect_secondary_files(c, config, job.Id, output, []ApiDoEvalPostRequestContext{file}, job.Cwd, job.BuilderOutdir)
					}
				}
			}
			uploadOutputs(config, results)
			r := c.DefaultAPI.ApiJobFinishedPost(ctx)
			r.jobFinishedRequest = &JobFinishedRequest{
				Id:       job.Id,
				ExitCode: int32(exitCode),
				Results:  results,
			}

			r.Execute()
			fmt.Print(exitCode)
		}
	}
}
func uploadOutputs(config *SharedFileSystemConfig, results map[string][]ApiDoEvalPostRequestContext) error {
	for _, files := range results {
		for idx, file := range files {
			if file.File != nil {
				path, err := uploadToS3(config, *file.File.Location)
				if err != nil {
					return err
				}
				file.File.Location = &path
				files[idx] = file
				for _, secondaryFile := range file.File.SecondaryFiles {
					if secondaryFile.ChildFile != nil {
						path, err := uploadToS3(config, *secondaryFile.ChildFile.Location)
						if err != nil {
							return err
						}
						secondaryFile.ChildFile.Location = &path
					} else if secondaryFile.ChildDirectory != nil {
						path, err := uploadToS3(config, *secondaryFile.ChildDirectory.Location)
						if err != nil {
							return err
						}
						secondaryFile.ChildDirectory.Location = &path
					}
				}
			}

		}
	}
	return nil
}
func uploadToS3(config *SharedFileSystemConfig, filePath string) (string, error) {
	if config.Type != "s3" {
		return "file:/" + filePath, nil
	}
	filePath = strings.TrimPrefix(filePath, "file:/")
	sess, err := session.NewSession(&aws.Config{
		Credentials:      credentials.NewStaticCredentials(*config.AccessKey, *config.SecretKey, ""),
		Region:           aws.String("ap-northeast-1"), // Set your AWS region
		Endpoint:         config.Endpoint,
		S3ForcePathStyle: aws.Bool(true),
	})
	if err != nil {
		return "", err
	}

	uploader := s3manager.NewUploader(sess)
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return "", err
	}
	if fileInfo.IsDir() {
		return uploadDirectory(uploader, *config, filePath)
	} else {
		return uploadFile(uploader, *config, filePath)
	}
}
func uploadFile(uploader *s3manager.Uploader, config SharedFileSystemConfig, filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	u, err := url.Parse(config.RootUrl)
	if err != nil {
		return "", err
	}
	filePath = strings.TrimPrefix(filePath, "/")
	key := strings.TrimPrefix(filepath.Join(u.Path, filePath), "/")

	_, err = uploader.Upload(&s3manager.UploadInput{
		Bucket: aws.String(u.Host), // Set your bucket name
		Key:    aws.String(key),
		Body:   file,
	})
	if err != nil {
		return "", err
	}
	s3url := "s3://" + u.Host + "/" + key
	return s3url, nil
}
func uploadDirectory(uploader *s3manager.Uploader, config SharedFileSystemConfig, directoryPath string) (string, error) {
	u, err := url.Parse(config.RootUrl)
	if err != nil {
		return "", err
	}

	err = filepath.Walk(directoryPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			_, err := uploadFile(uploader, config, path)
			if err != nil {
				return err
			}
		} else {
			directoryPath = strings.TrimPrefix(directoryPath, "/")
			emptyBuffer := bytes.NewBuffer([]byte{})
			key := strings.TrimPrefix(filepath.Join(u.Path, directoryPath), "/")
			if !strings.HasSuffix(key, "/") {
				key += "/"
			}
			metadata := map[string]*string{
				"x-amz-meta-filetype": aws.String("directory"),
			}
			ui := s3manager.UploadInput{
				Bucket:   aws.String(u.Host), // Set your bucket name
				Key:      aws.String(key),
				Body:     emptyBuffer,
				Metadata: metadata,
			}
			_, err = uploader.Upload(&ui)
			if err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return "", err
	}
	directoryPath = strings.TrimPrefix(directoryPath, "/")
	key := strings.TrimPrefix(filepath.Join(u.Path, directoryPath), "/")

	// すべてのURLを結合して返す
	return "s3://" + u.Host + "/" + key, nil
}
func reportWorkerStarted(c *APIClient) (*SharedFileSystemConfig, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return nil, err
	}
	var sysinfo syscall.Sysinfo_t
	err = syscall.Sysinfo(&sysinfo)
	if err != nil {
		return nil, err
	}
	req := c.DefaultAPI.ApiWorkerStartedPost(context.Background())
	req.apiWorkerStartedPostRequest = &ApiWorkerStartedPostRequest{
		Hostname: hostname,
		Cpu:      int32(runtime.NumCPU()),
		Memory:   int32(sysinfo.Totalram / 1024 / 1024),
	}
	res, _, err := req.Execute()
	return res, err
}

func main() {
	cfg := NewConfiguration()
	cfg.Scheme = "http"
	cfg.Host = "localhost:3000"
	cfg.HTTPClient = &http.Client{
		Transport: &LoggingRoundTripper{Proxied: http.DefaultTransport},
	}
	cfg.Debug = true
	c := NewAPIClient(cfg)
	var err error = nil
	var config *SharedFileSystemConfig = nil
	for {
		config, err = reportWorkerStarted(c)
		if err != nil {
			time.Sleep(time.Second)
		} else {
			break
		}
	}
	for {
		GetAndExecuteJob(c, config)
		time.Sleep(10 * time.Second)
	}
}
func do_eval(c *APIClient, id string, expression string, primary ApiDoEvalPostRequestContext) interface{} {
	req := c.DefaultAPI.ApiDoEvalPost(context.Background())
	req.apiDoEvalPostRequest = &ApiDoEvalPostRequest{
		Id:      id,
		Ex:      expression,
		Context: &primary,
	}
	res, httpres, err := req.Execute()
	if httpres != nil && httpres.StatusCode != 200 {
		panic(httpres.Body)
	}
	if err != nil {
		panic(err)
	}
	res2, ok := res.(map[string]interface{})
	if !ok {
		panic("Unexpected response from do_eval")
	}
	return res2["result"]
}
func aslist(val interface{}) []interface{} {
	if val == nil {
		return []interface{}{}
	}
	if reflect.TypeOf(val).Kind() != reflect.Slice {
		return []interface{}{val}
	}
	return val.([]interface{})
}
func isFile(config *SharedFileSystemConfig, dir string, filepath string) bool {
	if config != nil && strings.HasPrefix(filepath, "s3://") {
		h, err := headS3Object(config, filepath)
		if err != nil {
			return false
		} else {
			return h == "file"
		}
	}
	path, err := abspath(filepath, dir)
	if err != nil {
		return false
	}
	fileInfo, err := os.Stat(path)
	return err == nil && !fileInfo.IsDir()
}
func isDir(config *SharedFileSystemConfig, dir string, filepath string) bool {
	if config != nil && strings.HasPrefix(filepath, "s3://") {
		h, err := headS3Object(config, filepath)
		if err != nil {
			return false
		} else {
			return h == "directory"
		}
	}
	path, err := abspath(filepath, dir)
	if err != nil {
		return false
	}
	fileInfo, err := os.Stat(path)
	return err == nil && fileInfo.IsDir()
}
func (d DataMap) GetStringPtr(key string) *string {
	val, ok := d[key]
	if !ok {
		return nil
	}
	str, ok := val.(string)
	if !ok {
		return nil
	}
	return &str
}
func (d DataMap) GetFloat32Ptr(key string) *float32 {
	val, ok := d[key]
	if !ok {
		return nil
	}
	str, ok := val.(float32)
	if !ok {
		return nil
	}
	return &str
}
func convertToFile(data DataMap) *ChildFile {
	file := ChildFile{
		Class:    "File",
		Location: data.GetStringPtr("location"),
		Dirname:  data.GetStringPtr("dirname"),
		Basename: data.GetStringPtr("basename"),
		Nameroot: data.GetStringPtr("nameroot"),
		Nameext:  data.GetStringPtr("nameext"),
		Checksum: data.GetStringPtr("checksum"),
		Path:     data.GetStringPtr("path"),
		Size:     data.GetFloat32Ptr("size"),
		Format:   data.GetStringPtr("format"),
		Contents: data.GetStringPtr("contents"),
	}
	return &file
}
func convertToDirectory(data DataMap) *ChildDirectory {
	file := ChildDirectory{
		Class:    "Directory",
		Location: data.GetStringPtr("location"),
		Dirname:  data.GetStringPtr("dirname"),
		Basename: data.GetStringPtr("basename"),
		Path:     data.GetStringPtr("path"),
	}
	return &file
}

// substitute -If string begins with one or more caret ^ characters, for each caret, remove the last file extension from the path
// (the last period . and all following characters). If there are no file extensions, the path is unchanged.
// Append the remainder of the string to the end of the file path.
func substitute(value string, replace string) string {
	if strings.HasPrefix(replace, "^") {
		lastDotIndex := strings.LastIndex(value, ".")
		if lastDotIndex != -1 {
			return substitute(value[:lastDotIndex], replace[1:])
		} else {
			return value + strings.TrimLeft(replace, "^")
		}
	}
	return value + replace
}
func ensureWritable(targetPath string, includeRoot bool) error {
	addWritableFlag := func(p string) error {
		stat, err := os.Stat(p)
		if err != nil {
			return err
		}
		mode := stat.Mode()
		newMode := mode | 0200 // Adding write permission for the owner
		return os.Chmod(p, newMode)
	}

	stat, err := os.Stat(targetPath)
	if err != nil {
		return err
	}

	if stat.IsDir() {
		if includeRoot {
			err := addWritableFlag(targetPath)
			if err != nil {
				return err
			}
		}

		items, err := os.ReadDir(targetPath)
		if err != nil {
			return err
		}

		for _, item := range items {
			itemPath := filepath.Join(targetPath, item.Name())
			if item.IsDir() {
				err := ensureWritable(itemPath, true) // Recursive call for directories
				if err != nil {
					return err
				}
			} else {
				err := addWritableFlag(itemPath) // Directly add flag for files
				if err != nil {
					return err
				}
			}
		}
	} else {
		err := addWritableFlag(targetPath)
		if err != nil {
			return err
		}
	}
	return nil
}

// CopyFile copies a single file from src to dst
func CopyFile(config *SharedFileSystemConfig, src, dst string) error {
	if strings.HasPrefix(src, "s3://") {
		_, err := downloadS3FileToTemp(config, src, &dst)
		return err
	}
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destination.Close()

	_, err = io.Copy(destination, source)
	if err != nil {
		return err
	}

	sourceInfo, err := source.Stat()
	if err != nil {
		return err
	}

	return os.Chmod(dst, sourceInfo.Mode())
}

// CopyDir recursively copies a directory tree, attempting to preserve permissions.
func CopyDir(config *SharedFileSystemConfig, src string, dst string) error {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)

	// Get properties of source dir
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	// Create the destination directory
	err = os.MkdirAll(dst, srcInfo.Mode())
	if err != nil {
		return err
	}

	// Copy each file/dir within the source directory
	err = filepath.Walk(src, func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Calculate proper destination path
		destPath := filepath.Join(dst, path[len(src):])

		// If it's a directory, create it
		if info.IsDir() {
			err = os.MkdirAll(destPath, info.Mode())
			if err != nil {
				return err
			}
		} else {
			// It's a file, copy it
			err = CopyFile(config, path, destPath)
			if err != nil {
				return err
			}
		}
		return nil
	})

	return err
}
func CopyFileOrDir(config *SharedFileSystemConfig, src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if srcInfo.IsDir() {
		// If source is a directory, call CopyDir
		return CopyDir(config, src, dst)
	} else {
		// If source is a file, call CopyFile
		return CopyFile(config, src, dst)
	}
}
func removeIgnorePermissionError(filePath string) error {
	err := os.RemoveAll(filePath)
	if err != nil {
		if os.IsPermission(err) {
			// Log the permission error
			// Replace with your logger if necessary
			log.Printf("Permission denied when trying to remove outdir %s\n", filePath)
		} else {
			return err
		}
	}
	return nil
}

func prepareStagingDir(config *SharedFileSystemConfig, commands []StagingCommand) error {
	for _, command := range commands {
		switch command.Command {
		case "writeFileContent":
			if _, err := os.Stat(*command.Target); os.IsNotExist(err) {
				err := os.WriteFile(*command.Target, []byte(*command.Content), fs.FileMode(*command.Mode))
				if err != nil {
					return err
				}
				if command.EnsureWritable != nil && *command.EnsureWritable {
					err = ensureWritable(*command.Target, false)
					if err != nil {
						return err
					}
				}
			}

		case "symlink":
			if _, err := os.Stat(*command.Target); os.IsNotExist(err) {
				sourcepath := *command.Resolved
				if strings.HasPrefix(sourcepath, "s3://") {
					downloadpath, err := downloadS3FileToTemp(config, sourcepath, nil)
					if err != nil {
						return err
					}
					sourcepath = downloadpath
				}
				if _, err := os.Stat(sourcepath); err == nil {
					err = os.Symlink(sourcepath, *command.Target)
					if err != nil {
						return err
					}
				}
			}

		case "mkdir":
			if _, err := os.Stat(*command.Resolved); os.IsNotExist(err) {
				err := os.MkdirAll(*command.Resolved, 0755) // Go's MkdirAll is always recursive
				if err != nil {
					return err
				}
			}

		case "copy":
			if _, err := os.Stat(*command.Target); os.IsNotExist(err) {
				if strings.HasPrefix(*command.Resolved, "s3://") {
					_, err = downloadS3FileToTemp(config, *command.Resolved, command.Target)
				} else {
					err = CopyFileOrDir(config, *command.Resolved, *command.Target) // copyFile needs to be implemented
				}
				if err != nil {
					return err
				}
				if command.EnsureWritable != nil && *command.EnsureWritable {
					err = ensureWritable(*command.Target, false) // ensureWritable needs to be implemented
					if err != nil {
						return err
					}
				}
			}

		case "relink":
			stat, err := os.Lstat(*command.Target)
			if err == nil && (stat.Mode()&os.ModeSymlink != 0 || !stat.IsDir()) { // isSymlink needs to be implemented
				err = os.Remove(*command.Target)
				if err != nil && !errors.Is(err, os.ErrPermission) && !errors.Is(err, os.ErrNotExist) {
					return err
				}
			} else if err == nil && stat.IsDir() && !filepath.HasPrefix(*command.Resolved, "_:") {
				err = removeIgnorePermissionError(*command.Target) // removeIgnorePermissionError needs to be implemented
				if err != nil {
					return err
				}
			}
			if !filepath.HasPrefix(*command.Resolved, "_:") {
				src := *command.Resolved
				if strings.HasPrefix(*command.Resolved, "s3://") {
					src, err = downloadS3FileToTemp(config, *command.Resolved, nil)
					if err != nil {
						return err
					}
				}
				err = os.Symlink(src, *command.Target)
				if err != nil && !errors.Is(err, os.ErrExist) {
					return err
				}
			}

		default:
			return errors.New("unknown staging command: ")
		}
	}
	return nil
}
func uriFilePath(inputUrl string) (string, error) {
	u, err := url.Parse(inputUrl)
	if err != nil {
		return "", err
	}
	if u.Scheme != "file" {
		return "", fmt.Errorf("not a file URI: %s", inputUrl)
	}
	return filepath.FromSlash(u.Path), nil
}
func pathToFileURL(inputPath string) (string, error) {
	absPath, err := filepath.Abs(inputPath)
	if err != nil {
		return "", err
	}
	u := url.URL{
		Scheme: "file",
		Path:   filepath.ToSlash(absPath),
	}
	return u.String(), nil
}
func fileUri(inputPath string, splitFrag bool) (string, error) {
	if strings.HasPrefix(inputPath, "file://") {
		return inputPath, nil
	}

	var frag string
	var pathWithoutFrag string

	if splitFrag {
		pathSplit := strings.SplitN(inputPath, "#", 2)
		pathWithoutFrag = pathSplit[0]
		if len(pathSplit) == 2 {
			frag = "#" + url.QueryEscape(pathSplit[1])
		}
	} else {
		pathWithoutFrag = inputPath
	}

	absPath, err := filepath.Abs(pathWithoutFrag)
	if err != nil {
		return "", err
	}

	urlPath := url.URL{
		Scheme: "file",
		Path:   filepath.ToSlash(absPath),
	}

	uri := urlPath.String()
	if strings.HasPrefix(uri, "/") {
		return "file:" + uri + frag, nil
	}
	return uri + frag, nil
}
func Join(paths ...string) string {
	count := len(paths) - 1
	for ; count > 0; count-- {
		if strings.HasPrefix(paths[count], "/") {
			break
		}
	}
	return strings.Join(paths[count:], "/")
}
func RevmapFile(builderOutdir, outdir string, f FileSystemEntity) error {
	if strings.HasPrefix(outdir, "/") {
		outdir, _ = fileUri(outdir, false)
	}
	if f.GetLocation() != "" && f.GetPath() == "" {
		location := f.GetLocation()
		if strings.HasPrefix(location, "file://") {
			path, err := uriFilePath(location)
			if err != nil {
				return err
			}
			f.SetPath(path)
		} else {
			f.SetPath(filepath.Join(outdir, location))
			return nil
		}
	}
	if f.GetPath() != "" {
		path1 := Join(builderOutdir, f.GetPath())
		uripath, _ := fileUri(path1, false)
		f.SetPath("")
		if f.GetBasename() == "" {
			f.SetBasename(filepath.Base(path1))
		}
		if uripath == outdir || strings.HasPrefix(uripath, outdir+string(filepath.Separator)) || strings.HasPrefix(uripath, outdir+"/") {
			f.SetLocation(uripath)
		} else if path1 == builderOutdir || strings.HasPrefix(path1, builderOutdir+string(filepath.Separator)) || strings.HasPrefix(path1, builderOutdir+"/") {
			path2 := strings.Join(strings.Split(path1[len(builderOutdir)+1:], string(filepath.Separator)), "/")
			f.SetLocation(Join(outdir, path2))
		} else {
			return errors.New("output file path must be within designated output directory or an input file pass through")
		}
		return nil
	}
	return errors.New("output File object is missing both 'location' and 'path' fields")
}
func ComputeChecksums(file *File) error {
	if file.Checksum == nil {
		hash := sha1.New()
		fileHandle, err := os.Open(*file.Location)
		if err != nil {
			return err
		}
		defer fileHandle.Close()

		_, err = io.Copy(hash, fileHandle)
		if err != nil {
			return err
		}
		checksum := fmt.Sprintf("sha1$%x", hash.Sum(nil))
		file.Checksum = &checksum

		fileInfo, err := fileHandle.Stat()
		if err != nil {
			return err
		}
		file.Size = PtrFloat32(float32(fileInfo.Size()))
	}

	return nil
}
func splitext(path string) (root, ext string) {
	ext = filepath.Ext(path)
	root = path[:len(path)-len(ext)]
	return
}

// convertToFileOrDirectory determines if the given path is a file or directory and returns the corresponding struct.
func convertToFileOrDirectory(builderOutdir, prefix, path1 string) (*File, *Directory, error) {
	decodedBasename := filepath.Base(path1)
	stat, err := os.Stat(path1)
	if err != nil {
		return nil, nil, err
	}

	relPath, err := filepath.Rel(prefix, path1)
	if err != nil {
		return nil, nil, err
	}

	if stat.Mode().IsRegular() {
		nameroot, nameext := splitext(decodedBasename)
		path2 := filepath.Join(builderOutdir, filepath.FromSlash(relPath))
		file := File{
			Class:    "File",
			Location: &path1,
			Path:     &path2,
			Basename: &decodedBasename,
			Nameroot: &nameroot,
			Nameext:  &nameext,
		}
		return &file, nil, nil
	} else {
		path2 := filepath.Join(builderOutdir, filepath.FromSlash(relPath))
		directory := Directory{
			Class:    "Directory",
			Location: &path1,
			Path:     &path2,
			Basename: &decodedBasename,
		}
		return nil, &directory, nil
	}
}

func listdir(dir, fn string) ([]string, error) {
	absPath, err := abspath(fn, dir)
	if err != nil {
		return nil, err
	}
	// ディレクトリ内のエントリを取得
	entries, err := ioutil.ReadDir(absPath)
	if err != nil {
		return nil, err
	}

	// 各エントリのURIを作成
	var uris []string
	for _, entry := range entries {
		entryPath := filepath.Join(absPath, entry.Name())
		uri := "file://" + entryPath
		if strings.HasPrefix(fn, "file://") {
			if strings.HasSuffix(fn, "/") {
				uri = fn + entry.Name()
			} else {
				uri = fn + "/" + entry.Name()
			}
		}
		uris = append(uris, uri)
	}

	return uris, nil
}
func basename(path string) string {
	if strings.HasPrefix(path, "file:/") {
		// 文字列が "file:/" で始まる場合、これを取り除く
		path = strings.TrimPrefix(path, "file:/")
	}
	return filepath.Base(path)
}
func get_listing(outdir string, dir *Directory, recursive bool) error {
	var listing = []FileAllOfSecondaryFilesInner{}
	ls, err := listdir(outdir, *dir.Location)
	if err != nil {
		return err
	}
	for _, ld := range ls {
		fileUri(ld, false)
		if isDir(nil, outdir, ld) {
			bn := basename(ld)
			ent := ChildDirectory{
				Class:    "Directory",
				Location: &ld,
				Basename: &bn,
			}
			// if (recursive) {
			// get_listing(fs_access, ent, recursive);
			// }
			listing = append(listing, FileAllOfSecondaryFilesInner{
				ChildDirectory: &ent,
			})
		} else {
			bn := basename(ld)
			ent := ChildFile{
				Class:    "File",
				Location: &ld,
				Basename: &bn,
			}
			listing = append(listing, FileAllOfSecondaryFilesInner{
				ChildFile: &ent,
			})
		}
	}
	dir.Listing = listing
	return nil
}
func globOutput(builderOutdir string, binding OutputBinding, outdir string, computeChecksum bool) ([]ApiDoEvalPostRequestContext, error) {
	var results []ApiDoEvalPostRequestContext
	// Example of globbing in Go
	for _, glob := range binding.Glob {
		globPath := Join(outdir, glob)
		matches, err := filepath.Glob(globPath) // This needs to be adapted to your specific logic
		if err != nil {
			return results, err
		}

		for _, match := range matches {
			f, d, err := convertToFileOrDirectory(builderOutdir, outdir, match)
			if f != nil {
				if binding.LoadContents != nil && *binding.LoadContents {
					content, _ := contentLimitRespectedReadBytes(*f.Location)
					f.Contents = &content
				}

				if computeChecksum {
					ComputeChecksums(f)
				}

				results = append(results, ApiDoEvalPostRequestContext{File: f})
			} else if d != nil {
				if binding.LoadListing != nil && *binding.LoadListing != NO_LISTING {
					get_listing(outdir, d, *binding.LoadListing == DEEP_LISTING)
				}
				results = append(results, ApiDoEvalPostRequestContext{Directory: d})
			} else if err != nil {
				return results, err
			}
		}

		// Further processing as per your TypeScript logic
		// ...
	}
	return results, nil
}

const CONTENT_LIMIT = 64 * 1024 // Set your content limit here

// Helper functions like ensureWritable, copyFile, isSymlink, and removeIgnorePermissionError need to be implemented.
func contentLimitRespectedReadBytes(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	buffer := make([]byte, CONTENT_LIMIT+1)
	bytesRead, err := file.Read(buffer)
	if err != nil {
		return "", err
	}

	if bytesRead > CONTENT_LIMIT {
		return "", errors.New(fmt.Sprintf("file is too large, loadContents limited to %d bytes", CONTENT_LIMIT))
	}

	return string(buffer[:bytesRead]), nil
}
func downloadFile(svc *s3.S3, bucket, key, filePath string) error {
	// Ensure the local directory structure exists
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("error creating directory: %v", err)
	}

	// Create a file to write the download to
	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("error creating file: %v", err)
	}
	defer file.Close()

	// Download the file
	objInput := &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}
	output, err := svc.GetObject(objInput)
	if err != nil {
		return fmt.Errorf("error getting object: %v", err)
	}
	defer output.Body.Close()

	if _, err = io.Copy(file, output.Body); err != nil {
		return fmt.Errorf("error downloading object: %v", err)
	}

	return nil
}

func DownloadDirectory(svc *s3.S3, bucket, prefix, localDir string) error {
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
		Prefix: aws.String(prefix),
	}

	// List objects
	err := svc.ListObjectsV2Pages(input, func(page *s3.ListObjectsV2Output, lastPage bool) bool {
		for _, obj := range page.Contents {
			// Create file path based on object key
			filePath := filepath.Join(localDir, strings.TrimPrefix(*obj.Key, prefix))
			if err := downloadFile(svc, bucket, *obj.Key, filePath); err != nil {
				fmt.Printf("Failed to download file: %s, error: %v\n", *obj.Key, err)
			} else {
				fmt.Printf("File downloaded: %s\n", filePath)
			}
		}
		return !lastPage
	})

	if err != nil {
		return fmt.Errorf("error listing objects: %v", err)
	}

	return nil
}
func headS3Object(config *SharedFileSystemConfig, s3URL string) (string, error) {
	// URLを解析してバケットとキーを取得
	u, err := url.Parse(s3URL)
	if err != nil {
		return "", err
	}
	bucket := u.Host
	key := strings.TrimPrefix(u.Path, "/")
	var region string = "ap-northeast-1"
	// AWSセッションを作成
	sess, err := session.NewSession(&aws.Config{
		Region:           &region, // 適切なリージョンに変更してください
		Credentials:      credentials.NewStaticCredentials(*config.AccessKey, *config.SecretKey, ""),
		Endpoint:         aws.String(*config.Endpoint),
		S3ForcePathStyle: aws.Bool(true),
	})
	if err != nil {
		return "", err
	}

	// S3サービスクライアントを作成
	svc := s3.New(sess)
	input := &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}

	// S3オブジェクトのメタデータを取得
	_, err = svc.HeadObject(input)
	if err == nil {
		return "file", nil
	}
	key += "/"
	input = &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}
	_, err = svc.HeadObject(input)
	if err == nil {
		return "directory", err
	}
	return "", err
}
func downloadS3FileToTemp(config *SharedFileSystemConfig, s3URL string, dstPath *string) (string, error) {
	// URLを解析してバケットとキーを取得
	u, err := url.Parse(s3URL)
	if err != nil {
		return "", err
	}
	bucket := u.Host
	key := strings.TrimPrefix(u.Path, "/")
	var region string = "ap-northeast-1"
	// AWSセッションを作成
	sess, err := session.NewSession(&aws.Config{
		Region:           &region, // 適切なリージョンに変更してください
		Credentials:      credentials.NewStaticCredentials(*config.AccessKey, *config.SecretKey, ""),
		Endpoint:         aws.String(*config.Endpoint),
		S3ForcePathStyle: aws.Bool(true),
	})
	if err != nil {
		return "", err
	}

	// S3サービスクライアントを作成
	svc := s3.New(sess)
	input := &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}

	// S3オブジェクトのメタデータを取得
	result, err := svc.HeadObject(input)
	if err != nil {
		key += "/"
		input = &s3.HeadObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(key),
		}
		result, err = svc.HeadObject(input)
		if err != nil {
			if dstPath == nil {
				tmpPath, err := ioutil.TempDir("", "example")
				if err != nil {
					return "", err
				}
				dstPath = &tmpPath
			}
			DownloadDirectory(svc, bucket, key, *dstPath)
			return *dstPath, nil
		}
	}
	if result.Metadata["x-amz-meta-filetype"] == aws.String("directory") {
		if dstPath != nil {
			tmpPath, err := os.MkdirTemp("", "flowy-")
			if err != nil {
				return "", err
			}
			dstPath = &tmpPath
		}

		DownloadDirectory(svc, bucket, key, *dstPath)
		return *dstPath, nil
	} else {
		// S3オブジェクトを取得
		resp, err := svc.GetObject(&s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(key),
		})
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()

		var destFile *os.File
		// 一時ファイルを作成
		if dstPath == nil {
			destFile, err = ioutil.TempFile("", "flowy-")
			if err != nil {
				return "", err
			}
			defer destFile.Close()
		} else {
			destFile, err = os.Create(*dstPath)
			if err != nil {
				return "", err
			}
		}

		// S3オブジェクトの内容を一時ファイルに書き込み
		if _, err := io.Copy(destFile, resp.Body); err != nil {
			return "", err
		}

		return destFile.Name(), nil

	}
}
func prepareForDocker(config *SharedFileSystemConfig, commands []string) ([]string, error) {
	var dockerCommands []string
	for _, cmd := range commands {
		var command string = cmd
		if strings.HasPrefix(cmd, "--mount=") {
			mounts := strings.Split(cmd, ",")
			var isUpdated = false
			for indx, mnt := range mounts {
				if strings.HasPrefix(mnt, "source=s3://") {
					tmpfile, err := downloadS3FileToTemp(config,
						mnt[len("source="):], nil)
					if err != nil {
						return nil, err
					}
					isUpdated = true
					mounts[indx] = "source=" + tmpfile
				}
			}
			if isUpdated {
				command = strings.Join(mounts, ",")
			}
		}
		dockerCommands = append(dockerCommands, command)
	}
	return dockerCommands, nil
}
func executeJob(config *SharedFileSystemConfig, commands []string, stdinPath, stdoutPath, stderrPath *string, env map[string]string, cwd string, timelimit *int32) (int, error) {
	var err error = nil
	if commands[0] == "docker" {
		commands, err = prepareForDocker(config, commands)
		if err != nil {
			return -1, err
		}
	}
	var stdin io.Reader = os.Stdin
	var stdout, stderr io.Writer = os.Stdout, os.Stderr

	if stdinPath != nil {
		if strings.HasPrefix(*stdinPath, "s3://") {
			tmppath, err := downloadS3FileToTemp(config, *stdinPath, nil)
			if err != nil {
				return 0, err

			}
			stdinPath = &tmppath
		}
		stdin, err = os.Open(*stdinPath)
		if err != nil {
			return -1, err
		}
		defer stdin.(*os.File).Close()
	}
	if stdoutPath != nil {
		stdout, err = os.Create(*stdoutPath)
		if err != nil {
			return -1, err
		}
		defer stdout.(*os.File).Close()
	}
	if stderrPath != nil {
		stderr, err = os.Create(*stderrPath)
		if err != nil {
			return -1, err
		}
		defer stderr.(*os.File).Close()
	}
	fmt.Println("start commands " + commands[0])
	cmd := exec.Command(commands[0], commands[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, stdout, stderr
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	if timelimit != nil && *timelimit > 0 {
		timer := time.AfterFunc(time.Duration(*timelimit)*time.Second, func() {
			cmd.Process.Kill()
		})
		defer timer.Stop()
	}

	err = cmd.Start()
	if err != nil {
		return -1, err
	}

	err = cmd.Wait()
	if err != nil {
		exitError, ok := err.(*exec.ExitError)
		if ok {
			return exitError.ExitCode(), nil
		}
		return -1, err
	}

	return cmd.ProcessState.ExitCode(), nil
}
