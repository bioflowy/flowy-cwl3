/* eslint-disable no-use-before-define */
import * as cwl from 'cwl-ts-auto';
import {
  enum_d062602be0b4b8fd33e69e29a841317b6ab665bc as ArrayTypeEnum,
  enum_d9cba076fca539106791a4f46d198c7fcfbdb779 as RecordTypeEnum,
  enum_d961d79c225752b9fadb617367615ab176b47d77 as EnumTypeEnum,
} from 'cwl-ts-auto';
import { Dictionary } from 'cwl-ts-auto/dist/util/Dict.js';
import type { LoadingOptions } from 'cwl-ts-auto/dist/util/LoadingOptions.js';
import { ToolRequirement } from './types.js';
import { CWLOutputType } from './utils.js';
export interface IOParam {
  extensionFields?: Dictionary<unknown>;
  name?: undefined | string;
  label?: undefined | string;
  doc?: undefined | string | string[];
}

export interface CommandLineBinding {
  extensionFields?: Dictionary<unknown>;
  loadContents?: undefined | boolean;
  position?: undefined | number | string;
  prefix?: undefined | string;
  separate?: undefined | boolean;
  itemSeparator?: undefined | string;
  valueFrom?: undefined | string;
  shellQuote?: undefined | boolean;
}

// ArraySchema
export interface IOArraySchema extends IOParam {
  items: IOType;
  type: ArrayTypeEnum;
}
export interface CommandOutputArraySchema extends IOArraySchema {
  items: CommandOutputType;
}
export interface OutputArraySchema extends IOArraySchema {
  items: OutputType;
}
export interface CommandInputArraySchema extends IOArraySchema {
  items: CommandInputType;
  inputBinding?: undefined | CommandLineBinding;
}
export interface InputArraySchema extends IOArraySchema {
  items: InputType;
}

// EnumSchema
export const ArrayType = ArrayTypeEnum.ARRAY;
export const RecordType = RecordTypeEnum.RECORD;
export const EnumType = EnumTypeEnum.ENUM;

export interface IOEnumSchema extends IOParam {
  symbols: string[];
  type: EnumTypeEnum;
}
export interface InputEnumSchema extends IOEnumSchema {}
export interface CommandInputEnumSchema extends IOEnumSchema {
  inputBinding?: undefined | CommandLineBinding;
}
export type CommandOutputEnumSchema = IOEnumSchema;
export type OutputEnumSchema = IOEnumSchema;

// RecordSchema
export interface IORecordField {
  extensionFields?: Dictionary<unknown>;
  name: string;
  doc?: undefined | string | string[];
  type: IOType;
  label?: undefined | string;
  secondaryFiles?: undefined | cwl.SecondaryFileSchema | cwl.SecondaryFileSchema[];
}
export interface InputRecordField extends IORecordField {
  type: InputType;
  streamable?: undefined | boolean;
  format?: undefined | string | string[];
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
}
export interface CommandInputRecordField extends IORecordField {
  type: CommandInputType;
  inputBinding?: undefined | CommandLineBinding;
}
export interface CommandOutputRecordField extends IORecordField {
  type: CommandOutputType;
  streamable?: undefined | boolean;
  format?: undefined | string;
  outputBinding?: undefined | CommandOutputBinding;
}
export interface OutputRecordField extends IORecordField {
  type: OutputType;
  streamable?: undefined | boolean;
  format?: undefined | string;
}

export interface IORecordSchema {
  extensionFields?: Dictionary<unknown>;
  name?: undefined | string;
  fields?: undefined | IORecordField[];
  type: RecordTypeEnum;
  label?: undefined | string;
  doc?: undefined | string | string[];
}
export interface InputRecordSchema extends IORecordSchema {
  fields?: InputRecordField[];
}
export interface CommandInputRecordSchema extends IORecordSchema {
  fields?: CommandInputRecordField[];
  inputBinding?: undefined | CommandLineBinding;
}
export interface CommandOutputRecordSchema extends IORecordSchema {
  fields?: CommandOutputRecordField[];
}
export interface OutputRecordSchema extends IORecordSchema {
  fields?: OutputRecordField[];
}
export interface SecondaryFileSchema {
  extensionFields?: Dictionary<unknown>;
  pattern: string;
  required?: undefined | boolean | string;
}

export interface CommandOutputParameter {
  extensionFields?: Dictionary<unknown>;
  id?: undefined | string;
  name?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | string[];
  format?: undefined | string;
  type: CommandOutputType | cwl.stdout | cwl.stderr;
  outputBinding?: undefined | CommandOutputBinding;
}
export interface CommandOutputBinding {
  extensionFields?: Dictionary<unknown>;
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  glob?: undefined | string | string[];
  outputEval?: undefined | string;
}
export interface OutputBinding {
  name: string;
  secondaryFiles: SecondaryFileSchema[];
  loadContents?: boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  glob?: string[];
  outputEval?: undefined | string;
}
export interface File {
  class: 'File';
  location?: undefined | string;
  path?: undefined | string;
  basename?: undefined | string;
  dirname?: undefined | string;
  nameroot?: undefined | string;
  nameext?: undefined | string;
  checksum?: undefined | string;
  size?: undefined | number;
  secondaryFiles?: undefined | (File | Directory)[];
  format?: undefined | string;
  contents?: undefined | string;
  writable?: undefined | boolean;
}
export interface Directory {
  class: 'Directory';
  location?: undefined | string;
  path?: undefined | string;
  basename?: undefined | string;
  dirname?: undefined | string;
  listing?: undefined | (File | Directory)[];
  writable?: undefined | boolean;
}

export interface CommandInputParameter {
  id?: undefined | string;
  name?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | string[];
  format?: undefined | string | string[];
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  default_?: undefined | CWLOutputType;
  type: CommandInputType | cwl.stdin;
  inputBinding?: undefined | CommandLineBinding;
}
export interface WorkflowStepInput extends CommandInputParameter {
  source?: undefined | string | string[];
  not_connected?: boolean;
  used_by_step?: boolean;
  _tool_entry?: CommandInputParameter;
  linkMerge?: undefined | cwl.LinkMergeMethod;
  pickValue?: undefined | cwl.PickValueMethod;
  valueFrom?: undefined | string;
}
export interface WorkflowStepOutput extends CommandOutputParameter {
  default_?: unknown;
  _tool_entry?: CommandOutputParameter;
}
export interface IWorkflowStep {
  extensionFields?: Dictionary<unknown>;
  id?: undefined | string;
  label?: undefined | string;
  doc?: undefined | string | string[];
  in_: WorkflowStepInput[];
  inputs: WorkflowStepInput[];
  out: (string | WorkflowStepOutput)[];
  outputs: WorkflowStepOutput[];
  requirements: ToolRequirement;
  hints: ToolRequirement;
  run: string | cwl.CommandLineTool | cwl.ExpressionTool | cwl.Workflow | cwl.Operation;
  when?: undefined | string;
  scatter?: undefined | string | string[];
  scatterMethod?: undefined | cwl.ScatterMethod;
}
export interface Tool {
  id?: undefined | string;
  inputs?: CommandInputParameter[];
  outputs?: CommandOutputParameter[];
  requirements?: undefined | ToolRequirement;
  hints?: undefined | ToolRequirement;
  baseCommand?: undefined | string | string[];
  loadingOptions?: LoadingOptions;
  /**
   * Command line bindings which are not directly associated with input
   * parameters. If the value is a string, it is used as a string literal
   * argument. If it is an Expression, the result of the evaluation is used
   * as an argument.
   *
   */
  arguments_?: undefined | (string | CommandLineBinding)[];
}
export interface InputBinding {
  extensionFields?: Dictionary<unknown>;
  loadContents?: undefined | boolean;
}
export interface WorkflowOutputParameter {
  extensionFields?: Dictionary<unknown>;
  id?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | SecondaryFileSchema[];
  /**
   * Only valid when `type: File` or is an array of `items: File`.
   *
   * A value of `true` indicates that the file is read or written
   * sequentially without seeking.  An implementation may use this flag to
   * indicate whether it is valid to stream file contents using a named
   * pipe.  Default: `false`.
   *
   */
  streamable?: undefined | boolean;
  /**
   * A documentation string for this object, or an array of strings which should be concatenated.
   */
  doc?: undefined | string | string[];
  /**
   * Only valid when `type: File` or is an array of `items: File`.
   *
   * This is the file format that will be assigned to the output
   * File object.
   *
   */
  format?: undefined | string;
  /**
   * Specifies one or more names of an output from a workflow step (in the form
   * `step_name/output_name` with a `/` separator`), or a workflow input name,
   * that supply their value(s) to the output parameter.
   * the output parameter.  It is valid to reference workflow level inputs
   * here.
   *
   */
  outputSource?: undefined | string | string[];
  /**
   * The method to use to merge multiple sources into a single array.
   * If not specified, the default method is "merge_nested".
   *
   */
  linkMerge?: undefined | cwl.LinkMergeMethod;
  /**
   * The method to use to choose non-null elements among multiple sources.
   *
   */
  pickValue?: undefined | cwl.PickValueMethod;
  /**
   * Specify valid types of data that may be assigned to this parameter.
   *
   */
  type: OutputType;
}
export interface WorkflowInputParameter {
  extensionFields?: Dictionary<unknown>;
  id?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | string[];
  format?: undefined | string | string[];
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  default_?: undefined | File | Directory | CWLOutputType;
  /**
   * Specify valid types of data that may be assigned to this parameter.
   *
   */
  type:
    | cwl.CWLType
    | InputRecordSchema
    | InputEnumSchema
    | InputArraySchema
    | string
    | (cwl.CWLType | InputRecordSchema | InputEnumSchema | InputArraySchema | string)[];
  inputBinding?: undefined | cwl.InputBinding;
}
export type IOType =
  | cwl.CWLType
  | IORecordSchema
  | IOEnumSchema
  | IOArraySchema
  | string
  | (cwl.CWLType | IORecordSchema | IOEnumSchema | IOArraySchema | string)[];

export type CommandOutputType =
  | cwl.CWLType
  | CommandOutputRecordSchema
  | CommandOutputEnumSchema
  | CommandOutputArraySchema
  | string
  | (cwl.CWLType | CommandOutputRecordSchema | CommandOutputEnumSchema | CommandOutputArraySchema | string)[];
export type OutputType =
  | cwl.CWLType
  | OutputRecordSchema
  | OutputEnumSchema
  | OutputArraySchema
  | string
  | (cwl.CWLType | OutputRecordSchema | OutputEnumSchema | OutputArraySchema | string)[];
export type CommandInputType =
  | cwl.CWLType
  | CommandInputRecordSchema
  | CommandInputEnumSchema
  | CommandInputArraySchema
  | string
  | (cwl.CWLType | CommandInputRecordSchema | CommandInputEnumSchema | CommandInputArraySchema | string)[];
export type InputType =
  | cwl.CWLType
  | InputRecordSchema
  | InputEnumSchema
  | InputArraySchema
  | string
  | (cwl.CWLType | InputRecordSchema | InputEnumSchema | InputArraySchema | string)[];

export function isCommandInputRecordSchema(t: CommandInputParameter): t is CommandInputRecordSchema {
  return t instanceof Object && t['type'] === 'record';
}
export function isCommandInputArraySchema(t: CommandInputParameter): t is CommandInputArraySchema {
  return t instanceof Object && t['type'] === 'array';
}
export function isIORecordSchema(t: unknown): t is IORecordSchema {
  return t instanceof Object && t['type'] === 'record';
}
export function isCommandOutputRecordSchema(t: CommandOutputType): t is CommandOutputRecordSchema {
  return t instanceof Object && t['type'] === 'record';
}
export function isIOArraySchema(t: unknown): t is IOArraySchema {
  return t instanceof Object && t['type'] === 'array';
}
