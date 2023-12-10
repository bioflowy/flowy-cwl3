package main

import (
	"fmt"
	"net/url"
)

func main() {
	u, err := url.Parse("s3://flowy-test-bucket/testdir/testfile.txt")
	if err != nil {
		panic(err)
	}
	fmt.Println(u.Host)
	fmt.Println(u.Path)
}