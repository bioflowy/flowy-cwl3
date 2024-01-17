/*
My API

This is the API

API version: 1.0.0
*/

// Code generated by OpenAPI Generator (https://openapi-generator.tech); DO NOT EDIT.

package main

import (
	"encoding/json"
	"bytes"
	"fmt"
)

// checks if the ApiDoEvalPostRequest type satisfies the MappedNullable interface at compile time
var _ MappedNullable = &ApiDoEvalPostRequest{}

// ApiDoEvalPostRequest struct for ApiDoEvalPostRequest
type ApiDoEvalPostRequest struct {
	Id string `json:"id"`
	Ex string `json:"ex"`
	Context interface{} `json:"context,omitempty"`
}

type _ApiDoEvalPostRequest ApiDoEvalPostRequest

// NewApiDoEvalPostRequest instantiates a new ApiDoEvalPostRequest object
// This constructor will assign default values to properties that have it defined,
// and makes sure properties required by API are set, but the set of arguments
// will change when the set of required properties is changed
func NewApiDoEvalPostRequest(id string, ex string) *ApiDoEvalPostRequest {
	this := ApiDoEvalPostRequest{}
	this.Id = id
	this.Ex = ex
	return &this
}

// NewApiDoEvalPostRequestWithDefaults instantiates a new ApiDoEvalPostRequest object
// This constructor will only assign default values to properties that have it defined,
// but it doesn't guarantee that properties required by API are set
func NewApiDoEvalPostRequestWithDefaults() *ApiDoEvalPostRequest {
	this := ApiDoEvalPostRequest{}
	return &this
}

// GetId returns the Id field value
func (o *ApiDoEvalPostRequest) GetId() string {
	if o == nil {
		var ret string
		return ret
	}

	return o.Id
}

// GetIdOk returns a tuple with the Id field value
// and a boolean to check if the value has been set.
func (o *ApiDoEvalPostRequest) GetIdOk() (*string, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Id, true
}

// SetId sets field value
func (o *ApiDoEvalPostRequest) SetId(v string) {
	o.Id = v
}

// GetEx returns the Ex field value
func (o *ApiDoEvalPostRequest) GetEx() string {
	if o == nil {
		var ret string
		return ret
	}

	return o.Ex
}

// GetExOk returns a tuple with the Ex field value
// and a boolean to check if the value has been set.
func (o *ApiDoEvalPostRequest) GetExOk() (*string, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Ex, true
}

// SetEx sets field value
func (o *ApiDoEvalPostRequest) SetEx(v string) {
	o.Ex = v
}

// GetContext returns the Context field value if set, zero value otherwise (both if not set or set to explicit null).
func (o *ApiDoEvalPostRequest) GetContext() interface{} {
	if o == nil {
		var ret interface{}
		return ret
	}
	return o.Context
}

// GetContextOk returns a tuple with the Context field value if set, nil otherwise
// and a boolean to check if the value has been set.
// NOTE: If the value is an explicit nil, `nil, true` will be returned
func (o *ApiDoEvalPostRequest) GetContextOk() (*interface{}, bool) {
	if o == nil || IsNil(o.Context) {
		return nil, false
	}
	return &o.Context, true
}

// HasContext returns a boolean if a field has been set.
func (o *ApiDoEvalPostRequest) HasContext() bool {
	if o != nil && IsNil(o.Context) {
		return true
	}

	return false
}

// SetContext gets a reference to the given interface{} and assigns it to the Context field.
func (o *ApiDoEvalPostRequest) SetContext(v interface{}) {
	o.Context = v
}

func (o ApiDoEvalPostRequest) MarshalJSON() ([]byte, error) {
	toSerialize,err := o.ToMap()
	if err != nil {
		return []byte{}, err
	}
	return json.Marshal(toSerialize)
}

func (o ApiDoEvalPostRequest) ToMap() (map[string]interface{}, error) {
	toSerialize := map[string]interface{}{}
	toSerialize["id"] = o.Id
	toSerialize["ex"] = o.Ex
	if o.Context != nil {
		toSerialize["context"] = o.Context
	}
	return toSerialize, nil
}

func (o *ApiDoEvalPostRequest) UnmarshalJSON(data []byte) (err error) {
	// This validates that all required properties are included in the JSON object
	// by unmarshalling the object into a generic map with string keys and checking
	// that every required field exists as a key in the generic map.
	requiredProperties := []string{
		"id",
		"ex",
	}

	allProperties := make(map[string]interface{})

	err = json.Unmarshal(data, &allProperties)

	if err != nil {
		return err;
	}

	for _, requiredProperty := range(requiredProperties) {
		if _, exists := allProperties[requiredProperty]; !exists {
			return fmt.Errorf("no value given for required property %v", requiredProperty)
		}
	}

	varApiDoEvalPostRequest := _ApiDoEvalPostRequest{}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	err = decoder.Decode(&varApiDoEvalPostRequest)

	if err != nil {
		return err
	}

	*o = ApiDoEvalPostRequest(varApiDoEvalPostRequest)

	return err
}

type NullableApiDoEvalPostRequest struct {
	value *ApiDoEvalPostRequest
	isSet bool
}

func (v NullableApiDoEvalPostRequest) Get() *ApiDoEvalPostRequest {
	return v.value
}

func (v *NullableApiDoEvalPostRequest) Set(val *ApiDoEvalPostRequest) {
	v.value = val
	v.isSet = true
}

func (v NullableApiDoEvalPostRequest) IsSet() bool {
	return v.isSet
}

func (v *NullableApiDoEvalPostRequest) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableApiDoEvalPostRequest(val *ApiDoEvalPostRequest) *NullableApiDoEvalPostRequest {
	return &NullableApiDoEvalPostRequest{value: val, isSet: true}
}

func (v NullableApiDoEvalPostRequest) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableApiDoEvalPostRequest) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


