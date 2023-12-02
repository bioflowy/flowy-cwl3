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

// checks if the JobFinishedRequest type satisfies the MappedNullable interface at compile time
var _ MappedNullable = &JobFinishedRequest{}

// JobFinishedRequest struct for JobFinishedRequest
type JobFinishedRequest struct {
	Id string `json:"id"`
	ExitCode int32 `json:"exitCode"`
	Results map[string][]ApiDoEvalPostRequestContext `json:"results"`
}

type _JobFinishedRequest JobFinishedRequest

// NewJobFinishedRequest instantiates a new JobFinishedRequest object
// This constructor will assign default values to properties that have it defined,
// and makes sure properties required by API are set, but the set of arguments
// will change when the set of required properties is changed
func NewJobFinishedRequest(id string, exitCode int32, results map[string][]ApiDoEvalPostRequestContext) *JobFinishedRequest {
	this := JobFinishedRequest{}
	this.Id = id
	this.ExitCode = exitCode
	this.Results = results
	return &this
}

// NewJobFinishedRequestWithDefaults instantiates a new JobFinishedRequest object
// This constructor will only assign default values to properties that have it defined,
// but it doesn't guarantee that properties required by API are set
func NewJobFinishedRequestWithDefaults() *JobFinishedRequest {
	this := JobFinishedRequest{}
	return &this
}

// GetId returns the Id field value
func (o *JobFinishedRequest) GetId() string {
	if o == nil {
		var ret string
		return ret
	}

	return o.Id
}

// GetIdOk returns a tuple with the Id field value
// and a boolean to check if the value has been set.
func (o *JobFinishedRequest) GetIdOk() (*string, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Id, true
}

// SetId sets field value
func (o *JobFinishedRequest) SetId(v string) {
	o.Id = v
}

// GetExitCode returns the ExitCode field value
func (o *JobFinishedRequest) GetExitCode() int32 {
	if o == nil {
		var ret int32
		return ret
	}

	return o.ExitCode
}

// GetExitCodeOk returns a tuple with the ExitCode field value
// and a boolean to check if the value has been set.
func (o *JobFinishedRequest) GetExitCodeOk() (*int32, bool) {
	if o == nil {
		return nil, false
	}
	return &o.ExitCode, true
}

// SetExitCode sets field value
func (o *JobFinishedRequest) SetExitCode(v int32) {
	o.ExitCode = v
}

// GetResults returns the Results field value
func (o *JobFinishedRequest) GetResults() map[string][]ApiDoEvalPostRequestContext {
	if o == nil {
		var ret map[string][]ApiDoEvalPostRequestContext
		return ret
	}

	return o.Results
}

// GetResultsOk returns a tuple with the Results field value
// and a boolean to check if the value has been set.
func (o *JobFinishedRequest) GetResultsOk() (*map[string][]ApiDoEvalPostRequestContext, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Results, true
}

// SetResults sets field value
func (o *JobFinishedRequest) SetResults(v map[string][]ApiDoEvalPostRequestContext) {
	o.Results = v
}

func (o JobFinishedRequest) MarshalJSON() ([]byte, error) {
	toSerialize,err := o.ToMap()
	if err != nil {
		return []byte{}, err
	}
	return json.Marshal(toSerialize)
}

func (o JobFinishedRequest) ToMap() (map[string]interface{}, error) {
	toSerialize := map[string]interface{}{}
	toSerialize["id"] = o.Id
	toSerialize["exitCode"] = o.ExitCode
	toSerialize["results"] = o.Results
	return toSerialize, nil
}

func (o *JobFinishedRequest) UnmarshalJSON(bytes []byte) (err error) {
    // This validates that all required properties are included in the JSON object
	// by unmarshalling the object into a generic map with string keys and checking
	// that every required field exists as a key in the generic map.
	requiredProperties := []string{
		"id",
		"exitCode",
		"results",
	}

	allProperties := make(map[string]interface{})

	err = json.Unmarshal(bytes, &allProperties)

	if err != nil {
		return err;
	}

	for _, requiredProperty := range(requiredProperties) {
		if _, exists := allProperties[requiredProperty]; !exists {
			return fmt.Errorf("no value given for required property %v", requiredProperty)
		}
	}

	varJobFinishedRequest := _JobFinishedRequest{}

	err = json.Unmarshal(bytes, &varJobFinishedRequest)

	if err != nil {
		return err
	}

	*o = JobFinishedRequest(varJobFinishedRequest)

	return err
}

type NullableJobFinishedRequest struct {
	value *JobFinishedRequest
	isSet bool
}

func (v NullableJobFinishedRequest) Get() *JobFinishedRequest {
	return v.value
}

func (v *NullableJobFinishedRequest) Set(val *JobFinishedRequest) {
	v.value = val
	v.isSet = true
}

func (v NullableJobFinishedRequest) IsSet() bool {
	return v.isSet
}

func (v *NullableJobFinishedRequest) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableJobFinishedRequest(val *JobFinishedRequest) *NullableJobFinishedRequest {
	return &NullableJobFinishedRequest{value: val, isSet: true}
}

func (v NullableJobFinishedRequest) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableJobFinishedRequest) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


