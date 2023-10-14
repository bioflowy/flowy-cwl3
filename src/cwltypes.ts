import * as cwl from 'cwl-ts-auto';
import { Dictionary } from 'cwl-ts-auto/dist/util/Dict.js';
import { ToolRequirement } from './types.js';
import type { LoadingOptions } from 'cwl-ts-auto/dist/util/LoadingOptions.js';
import { object } from '../work/tests/underscore.js';

export interface IOParam {
  extensionFields?: Dictionary<any>;
  name?: undefined | string;
  label?: undefined | string;
  doc?: undefined | string | Array<string>;
}
type CommandOutputType =
  | cwl.CWLType
  | CommandOutputRecordSchema
  | CommandOutputEnumSchema
  | CommandOutputArraySchema
  | string
  | Array<cwl.CWLType | CommandOutputRecordSchema | CommandOutputEnumSchema | CommandOutputArraySchema | string>;
export type OutputType =
  | cwl.CWLType
  | OutputRecordSchema
  | OutputEnumSchema
  | OutputArraySchema
  | string
  | Array<cwl.CWLType | OutputRecordSchema | OutputEnumSchema | OutputArraySchema | string>;
export type CommandInputType =
  | cwl.CWLType
  | CommandInputRecordSchema
  | CommandInputEnumSchema
  | CommandInputArraySchema
  | string
  | Array<cwl.CWLType | CommandInputRecordSchema | CommandInputEnumSchema | CommandInputArraySchema | string>;

export function isCommandInputRecordSchema(t: CommandInputType): t is CommandInputRecordSchema {
  return t instanceof object && t['type'] === 'record';
}
export type InputType =
  | cwl.CWLType
  | InputRecordSchema
  | InputEnumSchema
  | InputArraySchema
  | string
  | Array<cwl.CWLType | InputRecordSchema | InputEnumSchema | InputArraySchema | string>;

export interface CommandLineBinding {
  extensionFields?: Dictionary<any>;
  loadContents?: undefined | boolean;
  position?: undefined | number | string;
  prefix?: undefined | string;
  separate?: undefined | boolean;
  itemSeparator?: undefined | string;
  valueFrom?: undefined | string;
  shellQuote?: undefined | boolean;
}
// ArraySchema
export type ArrayTypeEnum = cwl.enum_d062602be0b4b8fd33e69e29a841317b6ab665bc;
export interface IOArraySchema<T> extends IOParam {
  items: T;
  type: ArrayTypeEnum;
}
export type CommandOutputArraySchema = IOArraySchema<CommandOutputType>;
export type OutputArraySchema = IOArraySchema<OutputType>;
export interface CommandInputArraySchema extends IOArraySchema<CommandInputType> {
  inputBinding?: undefined | cwl.CommandLineBinding;
}
export type InputArraySchema = IOArraySchema<InputType>;

// EnumSchema
export type EnumTypeEnum = cwl.enum_d961d79c225752b9fadb617367615ab176b47d77;
export interface InputEnumSchema extends IOParam {
  symbols: Array<string>;
  type: EnumTypeEnum;
}
export interface CommandInputEnumSchema extends InputEnumSchema {
  inputBinding?: undefined | CommandLineBinding;
}
export type CommandOutputEnumSchema = InputEnumSchema;
export type OutputEnumSchema = InputEnumSchema;

// RecordSchema
export interface AbstractInputRecordField<T> {
  extensionFields?: Dictionary<any>;
  name: string;
  doc?: undefined | string | Array<string>;
  type: T;
  label?: undefined | string;
  secondaryFiles?: undefined | cwl.SecondaryFileSchema | Array<cwl.SecondaryFileSchema>;
}
export interface InputRecordField extends AbstractInputRecordField<InputType> {
  streamable?: undefined | boolean;
  format?: undefined | string | Array<string>;
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
}
export interface CommandInputRecordField extends AbstractInputRecordField<CommandInputType> {
  inputBinding?: undefined | CommandLineBinding;
}
export interface CommandOutputRecordField extends AbstractInputRecordField<CommandOutputType> {
  streamable?: undefined | boolean;
  format?: undefined | string;
}
export interface OutputRecordField extends AbstractInputRecordField<OutputType> {
  streamable?: undefined | boolean;
  format?: undefined | string;
}
export type RecordTypeEnum = cwl.enum_d9cba076fca539106791a4f46d198c7fcfbdb779;
export interface AbstractRecordSchema<T> {
  extensionFields?: Dictionary<any>;
  name?: undefined | string;
  fields?: undefined | Array<T>;
  type: RecordTypeEnum;
  label?: undefined | string;
  doc?: undefined | string | Array<string>;
}
export type InputRecordSchema = AbstractRecordSchema<InputRecordField>;
export interface CommandInputRecordSchema extends AbstractRecordSchema<CommandInputRecordField> {
  inputBinding?: undefined | CommandLineBinding;
}
export interface CommandOutputRecordSchema extends AbstractRecordSchema<CommandOutputRecordField> {}
export interface OutputRecordSchema extends AbstractRecordSchema<OutputRecordField> {}

export interface SecondaryFileSchema {
  extensionFields?: Dictionary<any>;
  pattern: string;
  required?: undefined | boolean | string;
}

export interface CommandLineBinding {
  extensionFields?: Dictionary<any>;
  loadContents?: undefined | boolean;
  position?: undefined | number | string;
  prefix?: undefined | string;
  separate?: undefined | boolean;
  itemSeparator?: undefined | string;
  valueFrom?: undefined | string;
  shellQuote?: undefined | boolean;
}

export interface CommandOutputParameter {
  extensionFields?: Dictionary<any>;
  id?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | Array<SecondaryFileSchema>;
  streamable?: undefined | boolean;
  doc?: undefined | string | Array<string>;
  format?: undefined | string;
  type: CommandOutputType | cwl.stdout | cwl.stderr;
  outputBinding?: undefined | cwl.CommandOutputBinding;
}
export interface CommandOutputBinding {
  extensionFields?: Dictionary<any>;
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  glob?: undefined | string | Array<string>;
  outputEval?: undefined | string;
}

export interface CommandInputParameter {
  id?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | Array<string>;
  format?: undefined | string | Array<string>;
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  default_?: undefined | any;
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
  default_?: any;
  _tool_entry?: CommandOutputParameter;
}
export interface IWorkflowStep {
  extensionFields?: Dictionary<any>;
  id?: undefined | string;
  label?: undefined | string;
  doc?: undefined | string | string[];
  in_: cwl.WorkflowStepInput[];
  inputs: WorkflowStepInput[];
  out: (string | cwl.WorkflowStepOutput)[];
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
