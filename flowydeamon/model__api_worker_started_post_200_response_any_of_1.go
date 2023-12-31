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

// checks if the ApiWorkerStartedPost200ResponseAnyOf1 type satisfies the MappedNullable interface at compile time
var _ MappedNullable = &ApiWorkerStartedPost200ResponseAnyOf1{}

// ApiWorkerStartedPost200ResponseAnyOf1 struct for ApiWorkerStartedPost200ResponseAnyOf1
type ApiWorkerStartedPost200ResponseAnyOf1 struct {
	Type string `json:"type"`
	RootUrl string `json:"rootUrl"`
}

type _ApiWorkerStartedPost200ResponseAnyOf1 ApiWorkerStartedPost200ResponseAnyOf1

// NewApiWorkerStartedPost200ResponseAnyOf1 instantiates a new ApiWorkerStartedPost200ResponseAnyOf1 object
// This constructor will assign default values to properties that have it defined,
// and makes sure properties required by API are set, but the set of arguments
// will change when the set of required properties is changed
func NewApiWorkerStartedPost200ResponseAnyOf1(type_ string, rootUrl string) *ApiWorkerStartedPost200ResponseAnyOf1 {
	this := ApiWorkerStartedPost200ResponseAnyOf1{}
	this.Type = type_
	this.RootUrl = rootUrl
	return &this
}

// NewApiWorkerStartedPost200ResponseAnyOf1WithDefaults instantiates a new ApiWorkerStartedPost200ResponseAnyOf1 object
// This constructor will only assign default values to properties that have it defined,
// but it doesn't guarantee that properties required by API are set
func NewApiWorkerStartedPost200ResponseAnyOf1WithDefaults() *ApiWorkerStartedPost200ResponseAnyOf1 {
	this := ApiWorkerStartedPost200ResponseAnyOf1{}
	return &this
}

// GetType returns the Type field value
func (o *ApiWorkerStartedPost200ResponseAnyOf1) GetType() string {
	if o == nil {
		var ret string
		return ret
	}

	return o.Type
}

// GetTypeOk returns a tuple with the Type field value
// and a boolean to check if the value has been set.
func (o *ApiWorkerStartedPost200ResponseAnyOf1) GetTypeOk() (*string, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Type, true
}

// SetType sets field value
func (o *ApiWorkerStartedPost200ResponseAnyOf1) SetType(v string) {
	o.Type = v
}

// GetRootUrl returns the RootUrl field value
func (o *ApiWorkerStartedPost200ResponseAnyOf1) GetRootUrl() string {
	if o == nil {
		var ret string
		return ret
	}

	return o.RootUrl
}

// GetRootUrlOk returns a tuple with the RootUrl field value
// and a boolean to check if the value has been set.
func (o *ApiWorkerStartedPost200ResponseAnyOf1) GetRootUrlOk() (*string, bool) {
	if o == nil {
		return nil, false
	}
	return &o.RootUrl, true
}

// SetRootUrl sets field value
func (o *ApiWorkerStartedPost200ResponseAnyOf1) SetRootUrl(v string) {
	o.RootUrl = v
}

func (o ApiWorkerStartedPost200ResponseAnyOf1) MarshalJSON() ([]byte, error) {
	toSerialize,err := o.ToMap()
	if err != nil {
		return []byte{}, err
	}
	return json.Marshal(toSerialize)
}

func (o ApiWorkerStartedPost200ResponseAnyOf1) ToMap() (map[string]interface{}, error) {
	toSerialize := map[string]interface{}{}
	toSerialize["type"] = o.Type
	toSerialize["rootUrl"] = o.RootUrl
	return toSerialize, nil
}

func (o *ApiWorkerStartedPost200ResponseAnyOf1) UnmarshalJSON(bytes []byte) (err error) {
    // This validates that all required properties are included in the JSON object
	// by unmarshalling the object into a generic map with string keys and checking
	// that every required field exists as a key in the generic map.
	requiredProperties := []string{
		"type",
		"rootUrl",
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

	varApiWorkerStartedPost200ResponseAnyOf1 := _ApiWorkerStartedPost200ResponseAnyOf1{}

	err = json.Unmarshal(bytes, &varApiWorkerStartedPost200ResponseAnyOf1)

	if err != nil {
		return err
	}

	*o = ApiWorkerStartedPost200ResponseAnyOf1(varApiWorkerStartedPost200ResponseAnyOf1)

	return err
}

type NullableApiWorkerStartedPost200ResponseAnyOf1 struct {
	value *ApiWorkerStartedPost200ResponseAnyOf1
	isSet bool
}

func (v NullableApiWorkerStartedPost200ResponseAnyOf1) Get() *ApiWorkerStartedPost200ResponseAnyOf1 {
	return v.value
}

func (v *NullableApiWorkerStartedPost200ResponseAnyOf1) Set(val *ApiWorkerStartedPost200ResponseAnyOf1) {
	v.value = val
	v.isSet = true
}

func (v NullableApiWorkerStartedPost200ResponseAnyOf1) IsSet() bool {
	return v.isSet
}

func (v *NullableApiWorkerStartedPost200ResponseAnyOf1) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableApiWorkerStartedPost200ResponseAnyOf1(val *ApiWorkerStartedPost200ResponseAnyOf1) *NullableApiWorkerStartedPost200ResponseAnyOf1 {
	return &NullableApiWorkerStartedPost200ResponseAnyOf1{value: val, isSet: true}
}

func (v NullableApiWorkerStartedPost200ResponseAnyOf1) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableApiWorkerStartedPost200ResponseAnyOf1) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


