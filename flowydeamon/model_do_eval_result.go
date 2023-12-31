/*
My API

This is the API

API version: 1.0.0
*/

// Code generated by OpenAPI Generator (https://openapi-generator.tech); DO NOT EDIT.

package main

import (
	"encoding/json"
)

// checks if the DoEvalResult type satisfies the MappedNullable interface at compile time
var _ MappedNullable = &DoEvalResult{}

// DoEvalResult struct for DoEvalResult
type DoEvalResult struct {
	StringValue *string `json:"string_value,omitempty"`
	JsonValue map[string]interface{} `json:"json_value,omitempty"`
	BooleanValue *bool `json:"boolean_value,omitempty"`
}

// NewDoEvalResult instantiates a new DoEvalResult object
// This constructor will assign default values to properties that have it defined,
// and makes sure properties required by API are set, but the set of arguments
// will change when the set of required properties is changed
func NewDoEvalResult() *DoEvalResult {
	this := DoEvalResult{}
	return &this
}

// NewDoEvalResultWithDefaults instantiates a new DoEvalResult object
// This constructor will only assign default values to properties that have it defined,
// but it doesn't guarantee that properties required by API are set
func NewDoEvalResultWithDefaults() *DoEvalResult {
	this := DoEvalResult{}
	return &this
}

// GetStringValue returns the StringValue field value if set, zero value otherwise.
func (o *DoEvalResult) GetStringValue() string {
	if o == nil || IsNil(o.StringValue) {
		var ret string
		return ret
	}
	return *o.StringValue
}

// GetStringValueOk returns a tuple with the StringValue field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *DoEvalResult) GetStringValueOk() (*string, bool) {
	if o == nil || IsNil(o.StringValue) {
		return nil, false
	}
	return o.StringValue, true
}

// HasStringValue returns a boolean if a field has been set.
func (o *DoEvalResult) HasStringValue() bool {
	if o != nil && !IsNil(o.StringValue) {
		return true
	}

	return false
}

// SetStringValue gets a reference to the given string and assigns it to the StringValue field.
func (o *DoEvalResult) SetStringValue(v string) {
	o.StringValue = &v
}

// GetJsonValue returns the JsonValue field value if set, zero value otherwise.
func (o *DoEvalResult) GetJsonValue() map[string]interface{} {
	if o == nil || IsNil(o.JsonValue) {
		var ret map[string]interface{}
		return ret
	}
	return o.JsonValue
}

// GetJsonValueOk returns a tuple with the JsonValue field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *DoEvalResult) GetJsonValueOk() (map[string]interface{}, bool) {
	if o == nil || IsNil(o.JsonValue) {
		return map[string]interface{}{}, false
	}
	return o.JsonValue, true
}

// HasJsonValue returns a boolean if a field has been set.
func (o *DoEvalResult) HasJsonValue() bool {
	if o != nil && !IsNil(o.JsonValue) {
		return true
	}

	return false
}

// SetJsonValue gets a reference to the given map[string]interface{} and assigns it to the JsonValue field.
func (o *DoEvalResult) SetJsonValue(v map[string]interface{}) {
	o.JsonValue = v
}

// GetBooleanValue returns the BooleanValue field value if set, zero value otherwise.
func (o *DoEvalResult) GetBooleanValue() bool {
	if o == nil || IsNil(o.BooleanValue) {
		var ret bool
		return ret
	}
	return *o.BooleanValue
}

// GetBooleanValueOk returns a tuple with the BooleanValue field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *DoEvalResult) GetBooleanValueOk() (*bool, bool) {
	if o == nil || IsNil(o.BooleanValue) {
		return nil, false
	}
	return o.BooleanValue, true
}

// HasBooleanValue returns a boolean if a field has been set.
func (o *DoEvalResult) HasBooleanValue() bool {
	if o != nil && !IsNil(o.BooleanValue) {
		return true
	}

	return false
}

// SetBooleanValue gets a reference to the given bool and assigns it to the BooleanValue field.
func (o *DoEvalResult) SetBooleanValue(v bool) {
	o.BooleanValue = &v
}

func (o DoEvalResult) MarshalJSON() ([]byte, error) {
	toSerialize,err := o.ToMap()
	if err != nil {
		return []byte{}, err
	}
	return json.Marshal(toSerialize)
}

func (o DoEvalResult) ToMap() (map[string]interface{}, error) {
	toSerialize := map[string]interface{}{}
	if !IsNil(o.StringValue) {
		toSerialize["string_value"] = o.StringValue
	}
	if !IsNil(o.JsonValue) {
		toSerialize["json_value"] = o.JsonValue
	}
	if !IsNil(o.BooleanValue) {
		toSerialize["boolean_value"] = o.BooleanValue
	}
	return toSerialize, nil
}

type NullableDoEvalResult struct {
	value *DoEvalResult
	isSet bool
}

func (v NullableDoEvalResult) Get() *DoEvalResult {
	return v.value
}

func (v *NullableDoEvalResult) Set(val *DoEvalResult) {
	v.value = val
	v.isSet = true
}

func (v NullableDoEvalResult) IsSet() bool {
	return v.isSet
}

func (v *NullableDoEvalResult) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableDoEvalResult(val *DoEvalResult) *NullableDoEvalResult {
	return &NullableDoEvalResult{value: val, isSet: true}
}

func (v NullableDoEvalResult) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableDoEvalResult) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


