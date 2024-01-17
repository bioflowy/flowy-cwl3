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

// checks if the StagingCommand type satisfies the MappedNullable interface at compile time
var _ MappedNullable = &StagingCommand{}

// StagingCommand struct for StagingCommand
type StagingCommand struct {
	Command StagingCommandName `json:"command"`
	Target *string `json:"target,omitempty"`
	Resolved *string `json:"resolved,omitempty"`
	Content *string `json:"content,omitempty"`
	Mode *int32 `json:"mode,omitempty"`
	EnsureWritable *bool `json:"ensureWritable,omitempty"`
	Recursive *bool `json:"recursive,omitempty"`
}

type _StagingCommand StagingCommand

// NewStagingCommand instantiates a new StagingCommand object
// This constructor will assign default values to properties that have it defined,
// and makes sure properties required by API are set, but the set of arguments
// will change when the set of required properties is changed
func NewStagingCommand(command StagingCommandName) *StagingCommand {
	this := StagingCommand{}
	this.Command = command
	return &this
}

// NewStagingCommandWithDefaults instantiates a new StagingCommand object
// This constructor will only assign default values to properties that have it defined,
// but it doesn't guarantee that properties required by API are set
func NewStagingCommandWithDefaults() *StagingCommand {
	this := StagingCommand{}
	return &this
}

// GetCommand returns the Command field value
func (o *StagingCommand) GetCommand() StagingCommandName {
	if o == nil {
		var ret StagingCommandName
		return ret
	}

	return o.Command
}

// GetCommandOk returns a tuple with the Command field value
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetCommandOk() (*StagingCommandName, bool) {
	if o == nil {
		return nil, false
	}
	return &o.Command, true
}

// SetCommand sets field value
func (o *StagingCommand) SetCommand(v StagingCommandName) {
	o.Command = v
}

// GetTarget returns the Target field value if set, zero value otherwise.
func (o *StagingCommand) GetTarget() string {
	if o == nil || IsNil(o.Target) {
		var ret string
		return ret
	}
	return *o.Target
}

// GetTargetOk returns a tuple with the Target field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetTargetOk() (*string, bool) {
	if o == nil || IsNil(o.Target) {
		return nil, false
	}
	return o.Target, true
}

// HasTarget returns a boolean if a field has been set.
func (o *StagingCommand) HasTarget() bool {
	if o != nil && !IsNil(o.Target) {
		return true
	}

	return false
}

// SetTarget gets a reference to the given string and assigns it to the Target field.
func (o *StagingCommand) SetTarget(v string) {
	o.Target = &v
}

// GetResolved returns the Resolved field value if set, zero value otherwise.
func (o *StagingCommand) GetResolved() string {
	if o == nil || IsNil(o.Resolved) {
		var ret string
		return ret
	}
	return *o.Resolved
}

// GetResolvedOk returns a tuple with the Resolved field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetResolvedOk() (*string, bool) {
	if o == nil || IsNil(o.Resolved) {
		return nil, false
	}
	return o.Resolved, true
}

// HasResolved returns a boolean if a field has been set.
func (o *StagingCommand) HasResolved() bool {
	if o != nil && !IsNil(o.Resolved) {
		return true
	}

	return false
}

// SetResolved gets a reference to the given string and assigns it to the Resolved field.
func (o *StagingCommand) SetResolved(v string) {
	o.Resolved = &v
}

// GetContent returns the Content field value if set, zero value otherwise.
func (o *StagingCommand) GetContent() string {
	if o == nil || IsNil(o.Content) {
		var ret string
		return ret
	}
	return *o.Content
}

// GetContentOk returns a tuple with the Content field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetContentOk() (*string, bool) {
	if o == nil || IsNil(o.Content) {
		return nil, false
	}
	return o.Content, true
}

// HasContent returns a boolean if a field has been set.
func (o *StagingCommand) HasContent() bool {
	if o != nil && !IsNil(o.Content) {
		return true
	}

	return false
}

// SetContent gets a reference to the given string and assigns it to the Content field.
func (o *StagingCommand) SetContent(v string) {
	o.Content = &v
}

// GetMode returns the Mode field value if set, zero value otherwise.
func (o *StagingCommand) GetMode() int32 {
	if o == nil || IsNil(o.Mode) {
		var ret int32
		return ret
	}
	return *o.Mode
}

// GetModeOk returns a tuple with the Mode field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetModeOk() (*int32, bool) {
	if o == nil || IsNil(o.Mode) {
		return nil, false
	}
	return o.Mode, true
}

// HasMode returns a boolean if a field has been set.
func (o *StagingCommand) HasMode() bool {
	if o != nil && !IsNil(o.Mode) {
		return true
	}

	return false
}

// SetMode gets a reference to the given int32 and assigns it to the Mode field.
func (o *StagingCommand) SetMode(v int32) {
	o.Mode = &v
}

// GetEnsureWritable returns the EnsureWritable field value if set, zero value otherwise.
func (o *StagingCommand) GetEnsureWritable() bool {
	if o == nil || IsNil(o.EnsureWritable) {
		var ret bool
		return ret
	}
	return *o.EnsureWritable
}

// GetEnsureWritableOk returns a tuple with the EnsureWritable field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetEnsureWritableOk() (*bool, bool) {
	if o == nil || IsNil(o.EnsureWritable) {
		return nil, false
	}
	return o.EnsureWritable, true
}

// HasEnsureWritable returns a boolean if a field has been set.
func (o *StagingCommand) HasEnsureWritable() bool {
	if o != nil && !IsNil(o.EnsureWritable) {
		return true
	}

	return false
}

// SetEnsureWritable gets a reference to the given bool and assigns it to the EnsureWritable field.
func (o *StagingCommand) SetEnsureWritable(v bool) {
	o.EnsureWritable = &v
}

// GetRecursive returns the Recursive field value if set, zero value otherwise.
func (o *StagingCommand) GetRecursive() bool {
	if o == nil || IsNil(o.Recursive) {
		var ret bool
		return ret
	}
	return *o.Recursive
}

// GetRecursiveOk returns a tuple with the Recursive field value if set, nil otherwise
// and a boolean to check if the value has been set.
func (o *StagingCommand) GetRecursiveOk() (*bool, bool) {
	if o == nil || IsNil(o.Recursive) {
		return nil, false
	}
	return o.Recursive, true
}

// HasRecursive returns a boolean if a field has been set.
func (o *StagingCommand) HasRecursive() bool {
	if o != nil && !IsNil(o.Recursive) {
		return true
	}

	return false
}

// SetRecursive gets a reference to the given bool and assigns it to the Recursive field.
func (o *StagingCommand) SetRecursive(v bool) {
	o.Recursive = &v
}

func (o StagingCommand) MarshalJSON() ([]byte, error) {
	toSerialize,err := o.ToMap()
	if err != nil {
		return []byte{}, err
	}
	return json.Marshal(toSerialize)
}

func (o StagingCommand) ToMap() (map[string]interface{}, error) {
	toSerialize := map[string]interface{}{}
	toSerialize["command"] = o.Command
	if !IsNil(o.Target) {
		toSerialize["target"] = o.Target
	}
	if !IsNil(o.Resolved) {
		toSerialize["resolved"] = o.Resolved
	}
	if !IsNil(o.Content) {
		toSerialize["content"] = o.Content
	}
	if !IsNil(o.Mode) {
		toSerialize["mode"] = o.Mode
	}
	if !IsNil(o.EnsureWritable) {
		toSerialize["ensureWritable"] = o.EnsureWritable
	}
	if !IsNil(o.Recursive) {
		toSerialize["recursive"] = o.Recursive
	}
	return toSerialize, nil
}

func (o *StagingCommand) UnmarshalJSON(data []byte) (err error) {
	// This validates that all required properties are included in the JSON object
	// by unmarshalling the object into a generic map with string keys and checking
	// that every required field exists as a key in the generic map.
	requiredProperties := []string{
		"command",
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

	varStagingCommand := _StagingCommand{}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	err = decoder.Decode(&varStagingCommand)

	if err != nil {
		return err
	}

	*o = StagingCommand(varStagingCommand)

	return err
}

type NullableStagingCommand struct {
	value *StagingCommand
	isSet bool
}

func (v NullableStagingCommand) Get() *StagingCommand {
	return v.value
}

func (v *NullableStagingCommand) Set(val *StagingCommand) {
	v.value = val
	v.isSet = true
}

func (v NullableStagingCommand) IsSet() bool {
	return v.isSet
}

func (v *NullableStagingCommand) Unset() {
	v.value = nil
	v.isSet = false
}

func NewNullableStagingCommand(val *StagingCommand) *NullableStagingCommand {
	return &NullableStagingCommand{value: val, isSet: true}
}

func (v NullableStagingCommand) MarshalJSON() ([]byte, error) {
	return json.Marshal(v.value)
}

func (v *NullableStagingCommand) UnmarshalJSON(src []byte) error {
	v.isSet = true
	return json.Unmarshal(src, &v.value)
}


