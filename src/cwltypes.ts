import * as cwl from 'cwl-ts-auto';
import { Dictionary } from 'cwl-ts-auto/dist/util/Dict.js';
import { ToolRequirement } from './types.js';
import type { LoadingOptions } from 'cwl-ts-auto/dist/util/LoadingOptions.js';
import { aslist, isStringOrStringArray } from './utils.js';
import { Builder } from './builder.js';
import { WorkflowException } from './errors.js';
export interface IOParam {
  extensionFields?: Dictionary<any>;
  name?: undefined | string;
  label?: undefined | string;
  doc?: undefined | string | Array<string>;
}
export type CommandOutputType =
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

export type ToolType = CommandOutputType | CommandInputType | OutputType | InputType;

export function isCommandInputRecordSchema(t: CommandInputParameter): t is CommandInputRecordSchema {
  return t instanceof Object && t['type'] === 'record';
}
export function isCommandInputArraySchema(t: CommandInputParameter): t is CommandInputArraySchema {
  return t instanceof Object && t['type'] === 'array';
}
export function isIORecordSchema(t: any): t is IORecordSchema<any> {
  return t instanceof Object && t['type'] === 'record';
}
export function isIOArraySchema(t: any): t is IOArraySchema<any> {
  return t instanceof Object && t['type'] === 'array';
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
  inputBinding?: undefined | CommandLineBinding;
}
export type InputArraySchema = IOArraySchema<InputType>;

// EnumSchema
export type EnumTypeEnum = cwl.enum_d961d79c225752b9fadb617367615ab176b47d77;
export interface IOEnumSchema extends IOParam {
  symbols: Array<string>;
  type: EnumTypeEnum;
}
export interface InputEnumSchema extends IOEnumSchema {}
export interface CommandInputEnumSchema extends IOEnumSchema {
  inputBinding?: undefined | CommandLineBinding;
}
export type CommandOutputEnumSchema = IOEnumSchema;
export type OutputEnumSchema = IOEnumSchema;

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

export interface IORecordSchema<T> {
  extensionFields?: Dictionary<any>;
  name?: undefined | string;
  fields?: undefined | Array<T>;
  type: RecordTypeEnum;
  label?: undefined | string;
  doc?: undefined | string | Array<string>;
}
export type InputRecordSchema = IORecordSchema<InputRecordField>;
export interface CommandInputRecordSchema extends IORecordSchema<CommandInputRecordField> {
  inputBinding?: undefined | CommandLineBinding;
}
export interface CommandOutputRecordSchema extends IORecordSchema<CommandOutputRecordField> {}
export interface OutputRecordSchema extends IORecordSchema<OutputRecordField> {}

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
export interface JobOutputBinding {
  name: string;
  secondaryFiles?: Array<SecondaryFileSchema>;
  streamable: boolean;
  type: CommandOutputType | cwl.stdout | cwl.stderr;
  loadContents: boolean;
  loadListing: cwl.LoadListingEnum;
  glob?: Array<string>;
}
export async function convertToJobOutputBindings(
  outputs: CommandOutputParameter[],
  builder: Builder,
): Promise<JobOutputBinding[]> {
  const jobOutputBindings: JobOutputBinding[] = [];
  for (const output of outputs) {
    const jobOutputBinding = await convertToJobOutputBinding(output, builder);
    if (jobOutputBinding) {
      jobOutputBindings.push(jobOutputBinding);
    }
  }
  return jobOutputBindings;
}
export async function convertToJobOutputBinding(
  output: CommandOutputParameter,
  builder: Builder,
): Promise<JobOutputBinding | undefined> {
  if (output.outputBinding === undefined) {
    return undefined;
  }
  const glob = [];
  for (const g of aslist(output.outputBinding.glob)) {
    const gb = await builder.do_eval(g);
    if (gb) {
      let gb_eval_fail = false;
      if (isStringOrStringArray(gb)) {
        glob.push(...aslist(gb));
      } else {
        throw new WorkflowException(
          'Resolved glob patterns must be strings or list of strings, not ' + `${gb} from ${output}`,
        );
      }
    }
  }
  return {
    name: output.name,
    secondaryFiles: aslist(output.secondaryFiles),
    streamable: output.streamable || false,
    type: output.type,
    loadContents: output.outputBinding.loadContents || false,
    loadListing: output.outputBinding.loadListing || cwl.LoadListingEnum.NO_LISTING,
    glob: glob,
  };
}
export interface CommandOutputParameter {
  extensionFields?: Dictionary<any>;
  id?: undefined | string;
  name?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | Array<SecondaryFileSchema>;
  streamable?: undefined | boolean;
  doc?: undefined | string | Array<string>;
  format?: undefined | string;
  type: CommandOutputType | cwl.stdout | cwl.stderr;
  outputBinding?: undefined | CommandOutputBinding;
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
  name?: undefined | string;
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
  extensionFields?: Dictionary<any>;
  loadContents?: undefined | boolean;
}
export interface WorkflowOutputParameter {
  extensionFields?: Dictionary<any>;
  id?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | Array<SecondaryFileSchema>;
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
  doc?: undefined | string | Array<string>;
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
  outputSource?: undefined | string | Array<string>;
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
  extensionFields?: Dictionary<any>;
  id?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | SecondaryFileSchema | Array<SecondaryFileSchema>;
  streamable?: undefined | boolean;
  doc?: undefined | string | Array<string>;
  format?: undefined | string | Array<string>;
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwl.LoadListingEnum;
  default_?: undefined | cwl.File | cwl.Directory | any;
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
    | Array<cwl.CWLType | InputRecordSchema | InputEnumSchema | InputArraySchema | string>;
  inputBinding?: undefined | cwl.InputBinding;
}
