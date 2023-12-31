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

// checks if the ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner type satisfies the MappedNullable interface at compile time
var _ MappedNullable = &ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner{}

// ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner struct for ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner
type ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner struct {
	Pattern string `json:"pattern"`
	RequiredBoolean *bool `json:"requiredBoolean,omitempty"`
	RequiredString *string `json:"requiredString,omitempty"`
}

type _ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner

// NewApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner instantiates a new ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner object
// This constructor will assign default values to properties that have it defined,
// and makes sure properties required by API are set, but the set of arguments
// will change when the set of required properties is changed
func NewApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner(pattern string) *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner {
	this := ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner{}
	this.Pattern = pattern
	return &this
}

// NewApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInnerWithDefaults instantiates a new ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner object
// This constructor will only assign default values to properties that have it defined,
// but it doesn't guarantee that properties required by API are set
func NewApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInnerWithDefaults() *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner {
	this := ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner{}
	return &this
}

// GetPattern returns the Pattern field value
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) GetPattern() string {
	if o == nil {
		var ret string
		return ret
	}

	return o.Pattern
}

// GetPatternOk returns a tuple with the Pattern field value
// and a boolean to check if the value has been set.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) GetPatternOk() (*string, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Pattern, true
}

// SetPattern sets field value
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) SetPattern(v string) {
	o.Pattern = v
}

// GetRequiredBoolean returns the RequiredBoolean field value if set, zero value otherwise.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) GetRequiredBoolean() bool {
	if o == nil || IsNil(o.RequiredBoolean) {
		var ret bool
		return ret
	}
	return *o.RequiredBoolean
}

// GetRequiredBooleanOk returns a tuple with the RequiredBoolean field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) GetRequiredBooleanOk() (*bool, bool) {
	if o == nil || IsNil(o.RequiredBoolean) {
		return nil, false
	}
	return o.RequiredBoolean, true
}

// HasRequiredBoolean returns a boolean if a field has been set.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) HasRequiredBoolean() bool {
	if o != nil && !IsNil(o.RequiredBoolean) {
		return true
	}

	return false
}

// SetRequiredBoolean gets a reference to the given bool and assigns it to the RequiredBoolean field.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) SetRequiredBoolean(v bool) {
	o.RequiredBoolean = &v
}

// GetRequiredString returns the RequiredString field value if set, zero value otherwise.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) GetRequiredString() string {
	if o == nil || IsNil(o.RequiredString) {
		var ret string
		return ret
	}
	return *o.RequiredString
}

// GetRequiredStringOk returns a tuple with the RequiredString field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) GetRequiredStringOk() (*string, bool) {
	if o == nil || IsNil(o.RequiredString) {
		return nil, false
	}
	return o.RequiredString, true
}

// HasRequiredString returns a boolean if a field has been set.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) HasRequiredString() bool {
	if o != nil && !IsNil(o.RequiredString) {
		return true
	}

	return false
}

// SetRequiredString gets a reference to the given string and assigns it to the RequiredString field.
func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) SetRequiredString(v string) {
	o.RequiredString = &v
}

func (o ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) MarshalJSON() ([]byte, error) {
	toSerialize,err := o.ToMap()
	if err != nil {
		return []byte{}, err
	}
	return json.Marshal(toSerialize)
}

func (o ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) ToMap() (map[string]interface{}, error) {
	toSerialize := map[string]interface{}{}
	toSerialize["pattern"] = o.Pattern
	if !IsNil(o.RequiredBoolean) {
		toSerialize["requiredBoolean"] = o.RequiredBoolean
	}
	if !IsNil(o.RequiredString) {
		toSerialize["requiredString"] = o.RequiredString
	}
	return toSerialize, nil
}

func (o *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) UnmarshalJSON(bytes []byte) (err error) {
    // This validates that all required properties are included in the JSON object
	// by unmarshalling the object into a generic map with string keys and checking
	// that every required field exists as a key in the generic map.
	requiredProperties := []string{
		"pattern",
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

	varApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner := _ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner{}

	err = json.Unmarshal(bytes, &varApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner)

	if err != nil {
		return err
	}

	*o = ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner(varApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner)

	return err
}

type NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner struct {
	value *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner
	isSet bool
}

func (v NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) Get() *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner {
	return v.value
}

func (v *NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) Set(val *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) {
	v.value = val
	v.isSet = true
}

func (v NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) IsSet() bool {
	return v.isSet
}

func (v *NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner(val *ApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) *NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner {
	return &NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner{value: val, isSet: true}
}

func (v NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableApiGetExectableJobPost200ResponseInnerOutputBindingsInnerSecondaryFilesInner) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


