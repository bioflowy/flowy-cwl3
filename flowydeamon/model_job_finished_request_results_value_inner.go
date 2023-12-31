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

// JobFinishedRequestResultsValueInner struct for JobFinishedRequestResultsValueInner
type JobFinishedRequestResultsValueInner struct {
	Directory *Directory
	File *File
}

// Unmarshal JSON data into any of the pointers in the struct
func (dst *JobFinishedRequestResultsValueInner) UnmarshalJSON(data []byte) error {
	var err error
	// try to unmarshal JSON data into Directory
	err = json.Unmarshal(data, &dst.Directory);
	if err == nil {
		jsonDirectory, _ := json.Marshal(dst.Directory)
		if string(jsonDirectory) == "{}" { // empty struct
			dst.Directory = nil
		} else {
			return nil // data stored in dst.Directory, return on the first match
		}
	} else {
		dst.Directory = nil
	}

	// try to unmarshal JSON data into File
	err = json.Unmarshal(data, &dst.File);
	if err == nil {
		jsonFile, _ := json.Marshal(dst.File)
		if string(jsonFile) == "{}" { // empty struct
			dst.File = nil
		} else {
			return nil // data stored in dst.File, return on the first match
		}
	} else {
		dst.File = nil
	}

	return fmt.Errorf("data failed to match schemas in anyOf(JobFinishedRequestResultsValueInner)")
}

// Marshal data from the first non-nil pointers in the struct to JSON
func (src *JobFinishedRequestResultsValueInner) MarshalJSON() ([]byte, error) {
	if src.Directory != nil {
		return json.Marshal(&src.Directory)
	}

	if src.File != nil {
		return json.Marshal(&src.File)
	}

	return nil, nil // no data in anyOf schemas
}

type NullableJobFinishedRequestResultsValueInner struct {
	value *JobFinishedRequestResultsValueInner
	isSet bool
}

func (v NullableJobFinishedRequestResultsValueInner) Get() *JobFinishedRequestResultsValueInner {
	return v.value
}

func (v *NullableJobFinishedRequestResultsValueInner) Set(val *JobFinishedRequestResultsValueInner) {
	v.value = val
	v.isSet = true
}

func (v NullableJobFinishedRequestResultsValueInner) IsSet() bool {
	return v.isSet
}

func (v *NullableJobFinishedRequestResultsValueInner) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableJobFinishedRequestResultsValueInner(val *JobFinishedRequestResultsValueInner) *NullableJobFinishedRequestResultsValueInner {
	return &NullableJobFinishedRequestResultsValueInner{value: val, isSet: true}
}

func (v NullableJobFinishedRequestResultsValueInner) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableJobFinishedRequestResultsValueInner) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


