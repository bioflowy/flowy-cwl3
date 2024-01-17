/*
My API

This is the API

API version: 1.0.0
*/

// Code generated by OpenAPI Generator (https://openapi-generator.tech); DO NOT EDIT.

package main

import (
	"encoding/json"
	"fmt"
)

// DirectoryAllOfListing struct for DirectoryAllOfListing
type DirectoryAllOfListing struct {
	ChildDirectory *ChildDirectory
	ChildFile *ChildFile
}

// Unmarshal JSON data into any of the pointers in the struct
func (dst *DirectoryAllOfListing) UnmarshalJSON(data []byte) error {
	var err error
	// try to unmarshal JSON data into ChildDirectory
	err = json.Unmarshal(data, &dst.ChildDirectory);
	if err == nil {
		jsonChildDirectory, _ := json.Marshal(dst.ChildDirectory)
		if string(jsonChildDirectory) == "{}" { // empty struct
			dst.ChildDirectory = nil
		} else {
			return nil // data stored in dst.ChildDirectory, return on the first match
		}
	} else {
		dst.ChildDirectory = nil
	}

	// try to unmarshal JSON data into ChildFile
	err = json.Unmarshal(data, &dst.ChildFile);
	if err == nil {
		jsonChildFile, _ := json.Marshal(dst.ChildFile)
		if string(jsonChildFile) == "{}" { // empty struct
			dst.ChildFile = nil
		} else {
			return nil // data stored in dst.ChildFile, return on the first match
		}
	} else {
		dst.ChildFile = nil
	}

	return fmt.Errorf("data failed to match schemas in anyOf(DirectoryAllOfListing)")
}

// Marshal data from the first non-nil pointers in the struct to JSON
func (src *DirectoryAllOfListing) MarshalJSON() ([]byte, error) {
	if src.ChildDirectory != nil {
		return json.Marshal(&src.ChildDirectory)
	}

	if src.ChildFile != nil {
		return json.Marshal(&src.ChildFile)
	}

	return nil, nil // no data in anyOf schemas
}

type NullableDirectoryAllOfListing struct {
	value *DirectoryAllOfListing
	isSet bool
}

func (v NullableDirectoryAllOfListing) Get() *DirectoryAllOfListing {
	return v.value
}

func (v *NullableDirectoryAllOfListing) Set(val *DirectoryAllOfListing) {
	v.value = val
	v.isSet = true
}

func (v NullableDirectoryAllOfListing) IsSet() bool {
	return v.isSet
}

func (v *NullableDirectoryAllOfListing) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableDirectoryAllOfListing(val *DirectoryAllOfListing) *NullableDirectoryAllOfListing {
	return &NullableDirectoryAllOfListing{value: val, isSet: true}
}

func (v NullableDirectoryAllOfListing) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableDirectoryAllOfListing) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}

