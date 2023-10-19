import cwlTsAuto, { ToolTimeLimitProperties } from 'cwl-ts-auto';
import { CommandLineBinding } from './cwltypes.js';
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
export class CommandLineBinded {
  extensionFields?: { [key: string]: unknown };
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
export function createRequirements(element: unknown): ToolRequirementEntity {
  const clazz = element['class'];
  if (clazz === 'EnvVarRequirement') {
    return new cwlTsAuto.EnvVarRequirement(element as cwlTsAuto.EnvVarRequirementProperties);
  } else if (clazz === 'InlineJavascriptRequirement') {
    return new cwlTsAuto.InlineJavascriptRequirement(element);
  } else if (clazz === 'SchemaDefRequirement') {
    return new cwlTsAuto.SchemaDefRequirement(element as cwlTsAuto.SchemaDefRequirementProperties);
  } else if (clazz === 'LoadListingRequirement') {
    return new cwlTsAuto.LoadListingRequirement(element);
  } else if (clazz === 'DockerRequirement') {
    return new cwlTsAuto.DockerRequirement(element);
  } else if (clazz === 'SoftwareRequirement') {
    return new cwlTsAuto.SoftwareRequirement(element as cwlTsAuto.SoftwareRequirementProperties);
  } else if (clazz === 'InitialWorkDirRequirement') {
    return new cwlTsAuto.InitialWorkDirRequirement(element);
  } else if (clazz === 'ResourceRequirement') {
    return new cwlTsAuto.ResourceRequirement(element);
  } else if (clazz === 'WorkReuse') {
    return new cwlTsAuto.WorkReuse(element as cwlTsAuto.WorkReuseProperties);
  } else if (clazz === 'NetworkAccess') {
    return new cwlTsAuto.NetworkAccess(element as cwlTsAuto.NetworkAccessProperties);
  } else if (clazz === 'ToolTimeLimit') {
    return new cwlTsAuto.ToolTimeLimit(element as ToolTimeLimitProperties);
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
export function transferProperties(source: unknown, target: unknown, exclude: string[] = []): void {
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
export function transferClassProperties(source: unknown, target: unknown): void {
  if (typeof source !== 'object') {
    throw new Error('source is not an object');
  }
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
