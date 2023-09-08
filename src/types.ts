import cwlTsAuto from 'cwl-ts-auto';
import type { CWLOutputType } from './utils.js';

export type ToolRequirement = (
  | cwlTsAuto.InlineJavascriptRequirement
  | cwlTsAuto.SchemaDefRequirement
  | cwlTsAuto.LoadListingRequirement
  | cwlTsAuto.DockerRequirement
  | cwlTsAuto.SoftwareRequirement
  | cwlTsAuto.InitialWorkDirRequirement
  | cwlTsAuto.EnvVarRequirement
  | cwlTsAuto.ShellCommandRequirement
  | cwlTsAuto.ResourceRequirement
  | cwlTsAuto.WorkReuse
  | cwlTsAuto.NetworkAccess
  | cwlTsAuto.InplaceUpdateRequirement
  | cwlTsAuto.ToolTimeLimit
  | cwlTsAuto.SubworkflowFeatureRequirement
  | cwlTsAuto.ScatterFeatureRequirement
  | cwlTsAuto.MultipleInputFeatureRequirement
  | cwlTsAuto.StepInputExpressionRequirement
)[];
export type ToolType =
  | cwlTsAuto.CWLType
  | cwlTsAuto.stdin
  | cwlTsAuto.CommandInputRecordSchema
  | cwlTsAuto.CommandInputEnumSchema
  | cwlTsAuto.CommandInputArraySchema
  | string
  | cwlTsAuto.stdout
  | cwlTsAuto.stderr
  | (
      | cwlTsAuto.CWLType
      | cwlTsAuto.CommandInputRecordSchema
      | cwlTsAuto.CommandInputEnumSchema
      | cwlTsAuto.CommandInputArraySchema
      | string
    )[];
export class CommandLineBinding {
  extensionFields?: { [key: string]: any };
  datum?: CWLOutputType;
  loadContents?: undefined | boolean;
  position: (number | string)[];
  prefix?: undefined | string;
  separate?: undefined | boolean;
  itemSeparator?: undefined | string;
  valueFrom?: undefined | string;
  shellQuote?: undefined | boolean;
}
export function compareInputBinding(a: CommandLineBinding, b: CommandLineBinding): number {
  if (!a.position) {
    return -1;
  }
  if (!b.position) {
    return 1;
  }
  const maxIndex = Math.max(a.position.length, b.position.length);
  for (let index = 0; index < maxIndex; index++) {
    const i = index < a.position.length ? a.position[index] : undefined;
    const j = index < b.position.length ? b.position[index] : undefined;
    if (i === j) {
      continue;
    }
    if (i === undefined) {
      return -1;
    }
    if (j === undefined) {
      return 1;
    }
    if (typeof i === 'string' || typeof j === 'string') {
      return String(i) > String(j) ? 1 : -1;
    }
    return i > j ? 1 : -1;
  }
  return 0;
}

export function convertToCommandLineBinding(binding1: cwlTsAuto.CommandLineBinding) {
  const binding2 = new CommandLineBinding();
  transferProperties(binding1, binding2, ['position']);
  return binding2;
}
export class CommandInputParameter {
  extensionFields?: { [key: string]: any };
  name?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | cwlTsAuto.SecondaryFileSchema | cwlTsAuto.SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | string[];
  format?: undefined | string | string[];
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwlTsAuto.LoadListingEnum;
  default_?: undefined | any;
  type: ToolType;
  inputBinding?: undefined | cwlTsAuto.CommandLineBinding;
}
export class CommandOutputParameter {
  extensionFields?: { [key: string]: any };
  name?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | cwlTsAuto.SecondaryFileSchema | cwlTsAuto.SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | string[];
  format?: undefined | string;
  type: ToolType;
  outputBinding?: undefined | cwlTsAuto.CommandOutputBinding;
}
export function convertCommandInputParameter(input: cwlTsAuto.CommandInputParameter) {
  const input2 = new CommandInputParameter();
  transferProperties(input, input2);
  return input2;
}
export function convertCommandOutputParameter(output: cwlTsAuto.CommandOutputParameter) {
  const output2 = new CommandOutputParameter();
  transferProperties(output, output2);
  return output2;
}
function transferProperties(source: any, target: any, exclude: string[] = []): void {
  for (const key of Object.keys(source)) {
    if (!(key in exclude) && key in target) {
      target[key] = source[key];
    }
  }
}
export interface Tool {
  id?: undefined | string;
  inputs: cwlTsAuto.CommandInputParameter[];
  outputs: cwlTsAuto.CommandOutputParameter[];
  requirements?: undefined | ToolRequirement;
  hints?: undefined | any[];
  baseCommand?: undefined | string | string[];
  /**
   * Command line bindings which are not directly associated with input
   * parameters. If the value is a string, it is used as a string literal
   * argument. If it is an Expression, the result of the evaluation is used
   * as an argument.
   *
   */
  arguments_?: undefined | (string | cwlTsAuto.CommandLineBinding)[];
}
