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

// ApiJobFinishedPostRequestResultsValueInner struct for ApiJobFinishedPostRequestResultsValueInner
type ApiJobFinishedPostRequestResultsValueInner struct {
	Directory *Directory
	File *File
}

// Unmarshal JSON data into any of the pointers in the struct
func (dst *ApiJobFinishedPostRequestResultsValueInner) UnmarshalJSON(data []byte) error {
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

	return fmt.Errorf("data failed to match schemas in anyOf(ApiJobFinishedPostRequestResultsValueInner)")
}

// Marshal data from the first non-nil pointers in the struct to JSON
func (src *ApiJobFinishedPostRequestResultsValueInner) MarshalJSON() ([]byte, error) {
	if src.Directory != nil {
		return json.Marshal(&src.Directory)
	}

	if src.File != nil {
		return json.Marshal(&src.File)
	}

	return nil, nil // no data in anyOf schemas
}

type NullableApiJobFinishedPostRequestResultsValueInner struct {
	value *ApiJobFinishedPostRequestResultsValueInner
	isSet bool
}

func (v NullableApiJobFinishedPostRequestResultsValueInner) Get() *ApiJobFinishedPostRequestResultsValueInner {
	return v.value
}

func (v *NullableApiJobFinishedPostRequestResultsValueInner) Set(val *ApiJobFinishedPostRequestResultsValueInner) {
	v.value = val
	v.isSet = true
}

func (v NullableApiJobFinishedPostRequestResultsValueInner) IsSet() bool {
	return v.isSet
}

func (v *NullableApiJobFinishedPostRequestResultsValueInner) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableApiJobFinishedPostRequestResultsValueInner(val *ApiJobFinishedPostRequestResultsValueInner) *NullableApiJobFinishedPostRequestResultsValueInner {
	return &NullableApiJobFinishedPostRequestResultsValueInner{value: val, isSet: true}
}

func (v NullableApiJobFinishedPostRequestResultsValueInner) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableApiJobFinishedPostRequestResultsValueInner) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}

