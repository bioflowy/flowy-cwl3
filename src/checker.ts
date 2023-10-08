import { ValidationException } from 'cwl-ts-auto';
import * as cwlTsAuto from 'cwl-ts-auto';
import { _logger } from './loghandler.js';
import { shortname } from './process.js';
import type {
  CommandOutputParameter,
  IWorkflowStep,
  ToolType,
  WorkflowStepInput,
  WorkflowStepOutput,
} from './types.js';
import { aslist, str, type MutableMapping, isString } from './utils.js';

// const _get_type = (tp: WorkflowStepInput | cwlTsAuto.WorkflowOutputParameter): any => {
//   if (tp.type instanceof Map) {
//     if (tp.get('type') !== 'array' && tp.get('type') !== 'record' && tp.get('type') !== 'enum') {
//       return tp['type'];
//     }
//   }
//   return tp;
// };
export function isArraySchema(
  type: ToolType,
): type is
  | cwlTsAuto.CommandInputArraySchema
  | cwlTsAuto.InputArraySchema
  | cwlTsAuto.OutputArraySchema
  | cwlTsAuto.CommandOutputArraySchema {
  return (
    type instanceof cwlTsAuto.CommandInputArraySchema ||
    type instanceof cwlTsAuto.InputArraySchema ||
    type instanceof cwlTsAuto.CommandOutputArraySchema ||
    type instanceof cwlTsAuto.OutputArraySchema
  );
}
export function isRecordSchema(
  type: ToolType,
): type is
  | cwlTsAuto.CommandInputRecordSchema
  | cwlTsAuto.InputRecordSchema
  | cwlTsAuto.CommandOutputRecordSchema
  | cwlTsAuto.OutputRecordSchema {
  return (
    type instanceof cwlTsAuto.CommandInputRecordSchema ||
    type instanceof cwlTsAuto.InputRecordSchema ||
    type instanceof cwlTsAuto.CommandOutputRecordSchema ||
    type instanceof cwlTsAuto.OutputRecordSchema
  );
}
export function canAssignSrcToSinkType(src: ToolType, sink?: ToolType, strict = false): boolean {
  // Check for identical type specifications, ignoring extra keys like inputBinding.
  //
  // In non-strict comparison, at least one source type must match one sink type,
  // except for 'null'.
  // In strict comparison, all source types must match at least one sink type.
  //
  // :param src: admissible source types
  // :param sink: admissible sink types
  if (src === 'Any' || sink === 'Any') {
    return true;
  } else if (Array.isArray(src)) {
    if (strict) {
      for (const thisSrc of src) {
        if (!canAssignSrcToSinkType(thisSrc, sink)) {
          return false;
        }
      }
      return true;
    }

    for (const thisSrc of src) {
      if (thisSrc !== 'null' && canAssignSrcToSinkType(thisSrc, sink)) {
        return true;
      }
    }

    return false;
  } else if (Array.isArray(sink)) {
    for (const thisSink of sink) {
      if (canAssignSrcToSinkType(src, thisSink)) {
        return true;
      }
    }
    return false;
  } else if (isString(src) || isString(sink)) {
    return src === sink;
  } else {
    if (isArraySchema(src) && isArraySchema(sink)) {
      return canAssignSrcToSinkType(src.items, sink.items, strict);
    }

    if (isRecordSchema(src) && isRecordSchema(sink)) {
      return _compareRecords(src, sink, strict);
    }
  }
  return false;
}
export function canAssignSrcToSink(
  src: cwlTsAuto.WorkflowInputParameter | CommandOutputParameter,
  sink?: WorkflowStepInput | cwlTsAuto.WorkflowOutputParameter,
  strict = false,
): boolean {
  // Check for identical type specifications, ignoring extra keys like inputBinding.
  //
  // In non-strict comparison, at least one source type must match one sink type,
  // except for 'null'.
  // In strict comparison, all source types must match at least one sink type.
  //
  // :param src: admissible source types
  // :param sink: admissible sink types
  if (sink['not_connected'] && strict) {
    return false;
  }
  if (src.type === 'File' && sink.type === 'File') {
    for (const sinksf of aslist(sink.secondaryFiles)) {
      if (!aslist(src.secondaryFiles).some((srcsf) => sinksf === srcsf)) {
        if (strict) {
          return false;
        }
      }
    }
    return true;
  }

  return canAssignSrcToSinkType(src.type, sink.type, strict);
}
const merge_flatten_type = (src: ToolType): ToolType => {
  /* "Return the merge flattened type of the source type."*/
  if (isArraySchema(src)) {
    return src;
  }

  if (src instanceof Array) {
    return src.map((t) => merge_flatten_type(t)) as ToolType;
  }
  return new cwlTsAuto.CommandInputArraySchema({ items: src, type: 'array' as any });
};

const check_types = (
  srctype: cwlTsAuto.WorkflowInputParameter | CommandOutputParameter,
  sinktype: WorkflowStepInput | cwlTsAuto.WorkflowOutputParameter,
  linkMerge?: cwlTsAuto.LinkMergeMethod,
  valueFrom?: string,
) => {
  //
  // Check if the source and sink types are correct.
  //
  // raises WorkflowException: If there is an unrecognized linkMerge type
  //
  if (valueFrom) {
    return 'pass';
  }
  if (!linkMerge) {
    if (canAssignSrcToSink(srctype, sinktype, true)) {
      return 'pass';
    }
    if (canAssignSrcToSink(srctype, sinktype, false)) {
      return 'warning';
    }
    return 'exception';
  }
  const srcType =
    linkMerge === cwlTsAuto.LinkMergeMethod.MERGE_NESTED
      ? new cwlTsAuto.InputArraySchema({ items: srctype.type, type: 'array' as any })
      : merge_flatten_type(srctype.type);
  if (canAssignSrcToSinkType(srcType, sinktype.type, true)) {
    return 'pass';
  } else if (canAssignSrcToSinkType(srcType, sinktype.type, false)) {
    return 'warning';
  } else {
    return 'exception';
  }
};

function _compareRecords(src: cwlTsAuto.InputRecordSchema, sink: cwlTsAuto.InputRecordSchema, strict = false): boolean {
  function _rec_fields(rec: cwlTsAuto.InputRecordSchema): MutableMapping<ToolType> {
    const out = {};
    for (const field of rec.fields) {
      const name = shortname(field.name);
      out[name] = field.type;
    }
    return out;
  }

  const srcfields = _rec_fields(src);
  const sinkfields = _rec_fields(sink);

  for (const key of Object.keys(sinkfields)) {
    if (
      !canAssignSrcToSinkType(srcfields[key] ?? 'null', sinkfields[key] ?? 'null', strict) &&
      sinkfields[key] !== undefined
    ) {
      _logger.info(
        `Record comparison failure for ${src['name']} and ${sink['name']}\n
                Did not match fields for ${key}: ${str(srcfields[key])} and ${str(sinkfields[key])}`,
      );
      return false;
    }
  }
  return true;
}

function missing_subset(fullset: any[], subset: any[]): any[] {
  const missing = [];
  for (const i of subset) {
    if (!fullset.includes(i)) {
      missing.push(i);
    }
  }
  return missing;
}
function bullets(textlist: string[], bul: string): string {
  if (textlist.length === 1) {
    return textlist[0];
  }
  return textlist.map((t) => `${bul}${t}`).join('\n');
}

export function static_checker(
  workflow_inputs: cwlTsAuto.WorkflowInputParameter[],
  workflow_outputs: cwlTsAuto.WorkflowOutputParameter[],
  step_inputs: WorkflowStepInput[],
  step_outputs: WorkflowStepOutput[],
  param_to_step: { [id: string]: IWorkflowStep },
): void {
  const src_dict: { [id: string]: cwlTsAuto.WorkflowInputParameter | WorkflowStepOutput } = {};
  for (const param of workflow_inputs) {
    src_dict[param['id'].toString()] = param;
  }
  for (const param of step_outputs) {
    src_dict[param['id'].toString()] = param;
  }
  const step_inputs_val = check_all_step_input_types(src_dict, step_inputs, param_to_step);
  const workflow_outputs_val = check_all_workflow_output_types(src_dict, workflow_outputs, param_to_step);
  const warnings = step_inputs_val['warning'].concat(workflow_outputs_val['warning']);
  const exceptions = step_inputs_val['exception'].concat(workflow_outputs_val['exception']);
  const warning_msgs = [];
  const exception_msgs = [];
  for (const warning of warnings) {
    const src = warning.src;
    const sink = warning.sink;
    const linkMerge = warning.linkMerge;
    const sinksf = [...aslist(sink.secondaryFiles)]
      .filter((p) => p.required ?? true)
      .sort((a, b) => {
        if (a.pattern < b.pattern) {
          return -1;
        } else if (a.pattern > b.pattern) {
          return 1;
        }
        return 0;
      });
    const srcsf = [...aslist(src.secondaryFiles)].sort((a, b) => {
      if (a.pattern < b.pattern) {
        return -1;
      } else if (a.pattern > b.pattern) {
        return 1;
      }
      return 0;
    });
    const missing = missing_subset(srcsf, sinksf);
    let msg = '';
    if (missing) {
      const msg1 = `Parameter '${shortname(sink['id'])}' requires secondaryFiles ${missing} but`;
      const msg3 = `source '${shortname(src['id'])}' does not provide those secondaryFiles.`;
      const msg4 = `To resolve, add missing secondaryFiles patterns to definition of '${shortname(src['id'])}' or`;
      const msg5 = `mark missing secondaryFiles in definition of '${shortname(sink['id'])}' as optional.`;
      msg = `${msg1}\n${bullets([msg3, msg4, msg5], '  ')}`;
    } else if (sink['not_connected']) {
      if (!sink['used_by_step']) {
        const msg1 = str(param_to_step[sink['id']].run);
        const msg2 = str(
          param_to_step[sink['id']]['inputs']
            .filter((s: any) => !s.get('not_connected'))
            .map((s: any) => shortname(s['id'])),
        );
        msg = `'${shortname(sink['id'])}' is not an input parameter of ${msg1}, expected ${msg2}`;
      } else {
        msg = '';
      }
    } else {
      msg =
        `Source '${shortname(src['id'])}' of type ${JSON.stringify(src['type'])} may be incompatible` +
        `  with sink '${shortname(sink['id'])}' of type ${JSON.stringify(sink['type'])}`;
      if (linkMerge != null) {
        msg += `\n  source has linkMerge method ${linkMerge}`;
      }
    }
    if (warning.message != null) {
      msg += `\n  ${warning.message}`;
    }
    if (msg) {
      warning_msgs.push(msg);
    }
  }
  for (const exception of exceptions) {
    const src = exception.src;
    const sink = exception.sink;
    const linkMerge = exception.linkMerge;
    const extra_message = exception.message;
    let msg =
      `Source '${shortname(src['id'])}' of type ${JSON.stringify(src['type'])} is incompatible` +
      `\n  with sink '${shortname(sink['id'])}' of type ${JSON.stringify(sink['type'])}`;
    if (extra_message != null) {
      msg += `\n  ${extra_message}`;
    }
    if (linkMerge != null) {
      msg += `\n  source has linkMerge method ${linkMerge}`;
    }
    exception_msgs.push(msg);
  }
  for (const sink of step_inputs) {
    if (!aslist(sink.type).includes('null') && !sink.source && !sink.default_ && !sink.valueFrom) {
      const msg = `Required parameter '${shortname(
        sink['id'],
      )}' does not have source, default, or valueFrom expression`;
      exception_msgs.push(msg);
    }
  }
  const all_warning_msg = warning_msgs.join('\n');
  const all_exception_msg = `\n${exception_msgs.join('\n')}`;
  if (all_warning_msg) {
    _logger.warn('Workflow checker warning:\n%s', all_warning_msg);
  }
  if (exceptions.length > 0) {
    throw new ValidationException(all_exception_msg);
  }
}
type SrcSink = {
  src: cwlTsAuto.WorkflowInputParameter | CommandOutputParameter;
  sink: WorkflowStepInput | cwlTsAuto.WorkflowOutputParameter;
  linkMerge?: string;
  message?: string;
};
export function check_all_step_input_types(
  src_dict: { [id: string]: cwlTsAuto.WorkflowInputParameter | WorkflowStepOutput },
  sinks: WorkflowStepInput[],
  param_to_step: { [key: string]: IWorkflowStep },
): { [key: string]: SrcSink[] } {
  const validation: { [key: string]: SrcSink[] } = { warning: [], exception: [] };
  for (const sink of sinks) {
    if (sink.source) {
      const valueFrom = sink.valueFrom;
      const pickValue = sink.pickValue as string | undefined;

      let extra_message: string | null = null;
      if (pickValue !== undefined) {
        extra_message = `pickValue is: ${pickValue}`;
      }
      let linkMerge: cwlTsAuto.LinkMergeMethod | null = null;
      const srcs_of_sink: (cwlTsAuto.WorkflowInputParameter | CommandOutputParameter)[] = [];
      if (Array.isArray(sink.source)) {
        linkMerge = sink.linkMerge || (sink.source.length > 1 ? cwlTsAuto.LinkMergeMethod.MERGE_NESTED : null);

        if (pickValue === 'first_non_null' || pickValue === 'the_only_non_null') {
          linkMerge = null;
        }

        for (const parm_id of sink.source) {
          srcs_of_sink.push(src_dict[parm_id]);
          if (is_conditional_step(param_to_step, parm_id) && pickValue === null) {
            validation['warning'].push({
              src: src_dict[parm_id],
              sink,
              linkMerge,
              message: 'Source is from conditional step, but pickValue is not used',
            });
          }

          if (is_all_output_method_loop_step(param_to_step, parm_id)) {
            src_dict[parm_id].type = new cwlTsAuto.InputArraySchema({
              type: 'array' as any,
              items: src_dict[parm_id]['type'],
            });
          }
        }
      } else {
        const parm_id = sink.source;
        if (!(parm_id in src_dict)) {
          throw new ValidationException(`source not found: ${parm_id}`);
        }

        srcs_of_sink.push(src_dict[parm_id]);

        if (pickValue !== undefined) {
          validation['warning'].push({
            src: src_dict[parm_id],
            sink,
            linkMerge,
            message: 'pickValue is used but only a single input source is declared',
          });
        }

        if (is_conditional_step(param_to_step, parm_id)) {
          let src_typ = [].concat(srcs_of_sink[0].type);
          const snk_typ = sink['type'];

          if (src_typ.indexOf('null') == -1) {
            src_typ = ['null'].concat(src_typ);
          }

          if (Array.isArray(snk_typ)) {
            if (snk_typ.indexOf('null') == -1) {
              validation['warning'].push({
                src: src_dict[parm_id],
                sink,
                linkMerge,
                message: 'Source is from conditional step and may produce `null`',
              });
            }
          }

          srcs_of_sink[0]['type'] = src_typ;
        }

        if (is_all_output_method_loop_step(param_to_step, parm_id)) {
          src_dict[parm_id].type = new cwlTsAuto.InputArraySchema({
            type: 'array' as any,
            items: src_dict[parm_id]['type'],
          });
        }
      }

      for (const src of srcs_of_sink) {
        const check_result = check_types(src, sink, linkMerge, valueFrom);
        if (check_result == 'warning') {
          validation['warning'].push({ src, sink, linkMerge, message: extra_message });
        } else if (check_result == 'exception') {
          validation['exception'].push({ src, sink, linkMerge, message: extra_message });
        }
      }
    }
  }
  return validation;
}
export function check_all_workflow_output_types(
  src_dict: { [id: string]: cwlTsAuto.WorkflowInputParameter | CommandOutputParameter },
  sinks: cwlTsAuto.WorkflowOutputParameter[],
  param_to_step: { [key: string]: IWorkflowStep },
): { [key: string]: SrcSink[] } {
  const validation: { [key: string]: SrcSink[] } = { warning: [], exception: [] };
  for (const sink of sinks) {
    if (sink.outputSource) {
      const pickValue = sink.pickValue as string | undefined;

      let extra_message: string | null = null;
      if (pickValue !== undefined) {
        extra_message = `pickValue is: ${pickValue}`;
      }

      const srcs_of_sink: (cwlTsAuto.WorkflowInputParameter | CommandOutputParameter)[] = [];
      let linkMerge: cwlTsAuto.LinkMergeMethod | null = null;
      if (Array.isArray(sink.outputSource)) {
        linkMerge = sink.linkMerge || (sink.outputSource.length > 1 ? cwlTsAuto.LinkMergeMethod.MERGE_NESTED : null);

        if (pickValue === 'first_non_null' || pickValue === 'the_only_non_null') {
          linkMerge = null;
        }

        for (const parm_id of sink.outputSource) {
          srcs_of_sink.push(src_dict[parm_id]);
          if (is_conditional_step(param_to_step, parm_id) && pickValue === null) {
            validation['warning'].push({
              src: src_dict[parm_id],
              sink,
              linkMerge,
              message: 'Source is from conditional step, but pickValue is not used',
            });
          }

          if (is_all_output_method_loop_step(param_to_step, parm_id)) {
            const t = src_dict[parm_id];
            t.type = new cwlTsAuto.InputArraySchema({ items: t.type, type: 'array' as any });
          }
        }
      } else {
        const parm_id = sink.outputSource;
        if (!(parm_id in src_dict)) {
          throw new ValidationException(`source not found: ${parm_id}`);
        }

        const srcs_of_sink = [src_dict[parm_id]];

        if (pickValue !== undefined) {
          validation['warning'].push({
            src: src_dict[parm_id],
            sink,
            linkMerge,
            message: 'pickValue is used but only a single input source is declared',
          });
        }

        if (is_conditional_step(param_to_step, parm_id)) {
          let src_typ = [].concat(srcs_of_sink[0]['type']);
          const snk_typ = sink['type'];

          if (src_typ.indexOf('null') == -1) {
            src_typ = ['null'].concat(src_typ);
          }

          if (Array.isArray(snk_typ)) {
            if (snk_typ.indexOf('null') == -1) {
              validation['warning'].push({
                src: src_dict[parm_id],
                sink,
                linkMerge,
                message: 'Source is from conditional step and may produce `null`',
              });
            }
          }

          srcs_of_sink[0]['type'] = src_typ;
        }

        if (is_all_output_method_loop_step(param_to_step, parm_id)) {
          src_dict[parm_id].type = new cwlTsAuto.InputArraySchema({
            items: src_dict[parm_id]['type'],
            type: 'array' as any,
          });
        }
      }

      for (const src of srcs_of_sink) {
        const check_result = check_types(src, sink, linkMerge, null);
        if (check_result == 'warning') {
          validation['warning'].push({ src, sink, linkMerge, message: extra_message });
        } else if (check_result == 'exception') {
          validation['exception'].push({ src, sink, linkMerge, message: extra_message });
        }
      }
    }
  }
  return validation;
}
export function circular_dependency_checker(step_inputs: WorkflowStepInput[]): void {
  const adjacency = get_dependency_tree(step_inputs);
  const vertices = Object.keys(adjacency);
  const processed: string[] = [];
  const cycles: string[][] = [];
  for (const vertex of vertices) {
    if (!processed.includes(vertex)) {
      const traversal_path = [vertex];
      processDFS(adjacency, traversal_path, processed, cycles);
    }
  }
  if (cycles.length) {
    let exception_msg = 'The following steps have circular dependency:\n';
    const cyclestrs = cycles.map((cycle) => cycle.toString());
    exception_msg += cyclestrs.join('\n');
    throw new ValidationException(exception_msg);
  }
}

function get_dependency_tree(step_inputs: WorkflowStepInput[]): { [key: string]: string[] } {
  const adjacency: { [key: string]: string[] } = {};
  for (const step_input of step_inputs) {
    if (step_input.source) {
      let vertices_in: string[];
      if (Array.isArray(step_input.source)) {
        vertices_in = step_input.source.map((src) => get_step_id(src.toString()));
      } else {
        vertices_in = [get_step_id(step_input.source.toString())];
      }
      const vertex_out = get_step_id(step_input.id.toString());
      for (const vertex_in of vertices_in) {
        if (!(vertex_in in adjacency)) {
          adjacency[vertex_in] = [vertex_out];
        } else if (!adjacency[vertex_in].includes(vertex_out)) {
          adjacency[vertex_in].push(vertex_out);
        }
      }
      if (!(vertex_out in adjacency)) {
        adjacency[vertex_out] = [];
      }
    }
  }
  return adjacency;
}

function processDFS(
  adjacency: { [key: string]: string[] },
  traversal_path: string[],
  processed: string[],
  cycles: string[][],
): void {
  const tip = traversal_path[traversal_path.length - 1];
  for (const vertex of adjacency[tip]) {
    if (traversal_path.includes(vertex)) {
      const i = traversal_path.indexOf(vertex);
      cycles.push(traversal_path.slice(i));
    } else if (!processed.includes(vertex)) {
      traversal_path.push(vertex);
      processDFS(adjacency, traversal_path, processed, cycles);
    }
  }
  processed.push(tip);
  traversal_path.pop();
}

function get_step_id(field_id: string): string {
  let step_id: string;
  if (field_id.split('#')[1].includes('/')) {
    step_id = field_id.split('/').slice(0, -1).join('/');
  } else {
    step_id = field_id.split('#')[0];
  }
  return step_id;
}

function is_conditional_step(param_to_step: { [key: string]: IWorkflowStep }, parm_id: string): boolean {
  const source_step = param_to_step[parm_id];
  if (source_step && source_step.when) {
    return true;
  }
  return false;
}
function is_all_output_method_loop_step(param_to_step: { [key: string]: any }, parm_id: string): boolean {
  const source_step = param_to_step[parm_id];
  if (source_step !== undefined) {
    for (const requirement of source_step['requirements'] || []) {
      if (requirement['class'] === 'http://commonwl.org/cwltool#Loop' && requirement['outputMethod'] === 'all') {
        return true;
      }
    }
  }
  return false;
}

// function loop_checker(steps: Iterator<{ [key: string]: any }>): void {
//   const exceptions = [];
//   for (const step of steps) {
//     const requirements = {
//       ...step['hints'].reduce(
//         (obj: { [key: string]: any }, h: { [key: string]: any }) => ({ ...obj, [h['class']]: h }),
//         {},
//       ),
//       ...step['requirements'].reduce(
//         (obj: { [key: string]: any }, r: { [key: string]: any }) => ({ ...obj, [r['class']]: r }),
//         {},
//       ),
//     };
//     if ('http://commonwl.org/cwltool#Loop' in requirements) {
//       if ('when' in step) {
//         exceptions.push(
//           SourceLine(step, 'id').makeError('The `cwltool:Loop` clause is not compatible with the `when` directive.'),
//         );
//       }
//       if ('scatter' in step) {
//         exceptions.push(
//           SourceLine(step, 'id').makeError('The `cwltool:Loop` clause is not compatible with the `scatter` directive.'),
//         );
//       }
//     }
//   }
//   if (exceptions.length > 0) {
//     throw new ValidationException(exceptions.join('\n'));
//   }
// }
