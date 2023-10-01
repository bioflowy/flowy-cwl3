import cwlTsAuto from 'cwl-ts-auto';
import type { Dictionary } from 'cwl-ts-auto/dist/util/Dict.js';
import type { CWLOutputType } from './utils.js';
export type ToolRequirementEntity =
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
  | cwlTsAuto.StepInputExpressionRequirement;

export type ToolRequirement = ToolRequirementEntity[];
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
export class CommandLineBinded {
  extensionFields?: { [key: string]: any };
  datum?: CWLOutputType;
  loadContents?: undefined | boolean;
  position?: number | string;
  positions: (number | string)[];
  prefix?: undefined | string;
  separate?: undefined | boolean;
  itemSeparator?: undefined | string;
  valueFrom?: undefined | string;
  shellQuote?: undefined | boolean;
  static fromBinding(binding: CommandLineBinding) {
    const t = new CommandLineBinded();
    transferClassProperties(binding, t);
    return t;
  }
}
export function createRequirements(element: any): ToolRequirementEntity {
  const clazz = element['class'];
  if (clazz === 'EnvVarRequirement') {
    return new cwlTsAuto.EnvVarRequirement(element);
  } else if (clazz === 'InlineJavascriptRequirement') {
    return new cwlTsAuto.InlineJavascriptRequirement(element);
  } else if (clazz === 'SchemaDefRequirement') {
    return new cwlTsAuto.SchemaDefRequirement(element);
  } else if (clazz === 'LoadListingRequirement') {
    return new cwlTsAuto.LoadListingRequirement(element);
  } else if (clazz === 'DockerRequirement') {
    return new cwlTsAuto.DockerRequirement(element);
  } else if (clazz === 'SoftwareRequirement') {
    return new cwlTsAuto.SoftwareRequirement(element);
  } else if (clazz === 'InitialWorkDirRequirement') {
    return new cwlTsAuto.InitialWorkDirRequirement(element);
  } else if (clazz === 'ResourceRequirement') {
    return new cwlTsAuto.ResourceRequirement(element);
  } else if (clazz === 'WorkReuse') {
    return new cwlTsAuto.WorkReuse(element);
  } else if (clazz === 'NetworkAccess') {
    return new cwlTsAuto.NetworkAccess(element);
  } else if (clazz === 'ToolTimeLimit') {
    return new cwlTsAuto.ToolTimeLimit(element);
  } else if (clazz === 'SubworkflowFeatureRequirement') {
    return new cwlTsAuto.SubworkflowFeatureRequirement(element);
  } else if (clazz === 'ScatterFeatureRequirement') {
    return new cwlTsAuto.ScatterFeatureRequirement(element);
  } else if (clazz === 'MultipleInputFeatureRequirement') {
    return new cwlTsAuto.MultipleInputFeatureRequirement(element);
  } else if (clazz === 'StepInputExpressionRequirement') {
    return new cwlTsAuto.StepInputExpressionRequirement(element);
  }
  return undefined;
}
export function compareInputBinding(a: CommandLineBinded, b: CommandLineBinded): number {
  if (!a.positions) {
    return -1;
  }
  if (!b.positions) {
    return 1;
  }
  const maxIndex = Math.max(a.positions.length, b.positions.length);
  for (let index = 0; index < maxIndex; index++) {
    const i = index < a.positions.length ? a.positions[index] : undefined;
    const j = index < b.positions.length ? b.positions[index] : undefined;
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
export interface CommandLineBinding {
  extensionFields?: Dictionary<any>;
  loadContents?: undefined | boolean;
  position?: undefined | number | string | (string | number)[];
  prefix?: undefined | string;
  separate?: undefined | boolean;
  itemSeparator?: undefined | string;
  valueFrom?: undefined | string;
  shellQuote?: undefined | boolean;
}

export interface CommandInputRecordField {
  extensionFields?: Dictionary<any>;
  name?: string;
  doc?: undefined | string | string[];
  type?: ToolType;
  label?: undefined | string;
  secondaryFiles?: undefined | cwlTsAuto.SecondaryFileSchema | cwlTsAuto.SecondaryFileSchema[];
  streamable?: undefined | boolean;
  format?: undefined | string | string[];
  loadContents?: undefined | boolean;
  loadListing?: undefined | cwlTsAuto.LoadListingEnum;
  default_?: undefined | any;
  /**
   * Describes how to turn this object into command line arguments.
   */
  inputBinding?: undefined | CommandLineBinding;
}
export interface CommandInputParameter {
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
  type?: ToolType;
  inputBinding?: undefined | CommandLineBinding;
  id?: string;
  items?:
    | cwlTsAuto.CWLType
    | cwlTsAuto.CommandInputRecordSchema
    | cwlTsAuto.CommandInputEnumSchema
    | cwlTsAuto.CommandInputArraySchema
    | string
    | (
        | cwlTsAuto.CWLType
        | cwlTsAuto.CommandInputRecordSchema
        | cwlTsAuto.CommandInputEnumSchema
        | cwlTsAuto.CommandInputArraySchema
        | string
      )[];
  fields?: CommandInputRecordField[];
  symbols?: string[];
}
export interface CommandOutputParameter {
  extensionFields?: { [key: string]: any };
  id?: undefined | string;
  name?: undefined | string;
  label?: undefined | string;
  secondaryFiles?: undefined | cwlTsAuto.SecondaryFileSchema | cwlTsAuto.SecondaryFileSchema[];
  streamable?: undefined | boolean;
  doc?: undefined | string | string[];
  format?: undefined | string;
  type?: ToolType;
  outputBinding?: undefined | cwlTsAuto.CommandOutputBinding;
  outputSource?: string | string[];
}
export interface WorkflowStepInput extends CommandInputParameter {
  not_connected?: boolean;
  used_by_step?: boolean;
  _tool_entry?: CommandInputParameter;
  linkMerge?: undefined | cwlTsAuto.LinkMergeMethod;
  pickValue?: undefined | cwlTsAuto.PickValueMethod;
  valueFrom?: undefined | string;
}
export interface WorkflowStepOutput extends CommandOutputParameter {
  default_?: any;
  _tool_entry?: CommandOutputParameter;
}
export function transferProperties(source: any, target: any, exclude: string[] = []): void {
  for (const key of Object.keys(source)) {
    if (key in exclude) {
      continue;
    }
    const value = source[key];
    if (value !== undefined && value !== null) {
      target[key] = value;
    }
  }
}
export function transferClassProperties(source: any, target: any): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      continue;
    }
    const value = source[key];
    if (value !== undefined && value !== null) {
      target[key] = value;
    }
  }
}
export interface IWorkflowStep {
  extensionFields?: Dictionary<any>;
  id?: undefined | string;
  label?: undefined | string;
  doc?: undefined | string | string[];
  in_: cwlTsAuto.WorkflowStepInput[];
  inputs: WorkflowStepInput[];
  out: (string | cwlTsAuto.WorkflowStepOutput)[];
  outputs: WorkflowStepOutput[];
  requirements: ToolRequirement;
  hints: ToolRequirement;
  run: string | cwlTsAuto.CommandLineTool | cwlTsAuto.ExpressionTool | cwlTsAuto.Workflow | cwlTsAuto.Operation;
  when?: undefined | string;
  scatter?: undefined | string | string[];
  scatterMethod?: undefined | cwlTsAuto.ScatterMethod;
}
export interface Tool {
  id?: undefined | string;
  inputs?: CommandInputParameter[];
  outputs?: CommandOutputParameter[];
  requirements?: undefined | ToolRequirement;
  hints?: undefined | ToolRequirement;
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
