import { ValidationException } from 'cwl-ts-auto';
import * as cwlTsAuto from 'cwl-ts-auto';
import { _logger } from './loghandler.js';
import { shortname } from './process.js';
import type { CommandInputParameter, CommandOutputParameter } from './types.js';
import type { CWLObjectType, CWLOutputAtomType, CWLOutputType, MutableMapping, SinkType } from './utils.js';

const _get_type = (tp: any): any => {
  if (tp instanceof Map) {
    if (tp.get('type') !== 'array' && tp.get('type') !== 'record' && tp.get('type') !== 'enum') {
      return tp['type'];
    }
  }
  return tp;
};

const check_types = (srctype: SinkType, sinktype: SinkType, linkMerge?: string, valueFrom?: string) => {
  //
  // Check if the source and sink types are correct.
  //
  // raises WorkflowException: If there is an unrecognized linkMerge type
  //
  if (valueFrom !== null) {
    return 'pass';
  }
  if (linkMerge === null) {
    if (can_assign_src_to_sink(srctype, sinktype, true)) {
      return 'pass';
    }
    if (can_assign_src_to_sink(srctype, sinktype, false)) {
      return 'warning';
    }
    return 'exception';
  }
  if (linkMerge === 'merge_nested') {
    return check_types(['items', _get_type(srctype)], _get_type(sinktype), null, null);
  }
  if (linkMerge === 'merge_flattened') {
    return check_types(merge_flatten_type(_get_type(srctype)), _get_type(sinktype), null, null);
  }
  throw 'Unrecognized linkMerge enum';
};

const merge_flatten_type = (src: SinkType): CWLOutputType => {
  /* "Return the merge flattened type of the source type."*/
  if (src instanceof Array) {
    return src.map((t) => merge_flatten_type(t as SinkType));
  }
  if (src instanceof Map && src.get('type') === 'array') {
    return src;
  }
  return { items: src, type: 'array' };
};

export const can_assign_src_to_sink = (src: SinkType, sink?: SinkType, strict = false): boolean => {
  //
  // Check for identical type specifications, ignoring extra keys like inputBinding.
  //
  // In non-strict comparison, at least one source type must match one sink type,
  // except for 'null'.
  // In strict comparison, all source types must match at least one sink type.
  //
  // param src: admissible source types
  // param sink: admissible sink types
  //
  if (src === 'Any' || sink === 'Any') {
    return true;
  }
  if (src instanceof Map && sink instanceof Map) {
    if (sink.get('not_connected') && strict) {
      return false;
    }
    if (src['type'] === 'array' && sink['type'] === 'array') {
      return can_assign_src_to_sink(src['items'] as CWLOutputAtomType[], sink['items'] as CWLOutputAtomType[], strict);
    }
    if (src['type'] === 'File' && sink['type'] === 'File') {
      for (const sinksf of sink.get('secondaryFiles') || []) {
        if (!(src.get('secondaryFiles') || []).some((srcsf) => sinksf === srcsf)) {
          if (strict) {
            return false;
          }
        }
      }
      return true;
    }
    return can_assign_src_to_sink(src['type'] as SinkType, sink['type'] as SinkType, strict);
  }
  if (src instanceof Array) {
    if (strict) {
      for (const this_src of src) {
        if (!can_assign_src_to_sink(this_src as SinkType, sink)) {
          return false;
        }
      }
      return true;
    }
    for (const this_src of src) {
      if (this_src !== 'null' && can_assign_src_to_sink(this_src as SinkType, sink)) {
        return true;
      }
    }
    return false;
  }
  if (sink instanceof Array) {
    for (const this_sink of sink) {
      if (can_assign_src_to_sink(src, this_sink as SinkType)) {
        return true;
      }
    }
    return false;
  }
  return src === sink;
};
function _compare_records(src: CWLObjectType, sink: CWLObjectType, strict = false): boolean {
  function _rec_fields(rec: MutableMapping<any>): MutableMapping<any> {
    const out = {};
    for (const field of rec['fields']) {
      const name = shortname(field['name']);
      out[name] = field['type'];
    }
    return out;
  }

  const srcfields = _rec_fields(src);
  const sinkfields = _rec_fields(sink);

  for (const key of Object.keys(sinkfields)) {
    if (
      !can_assign_src_to_sink(srcfields[key] ?? 'null', sinkfields[key] ?? 'null', strict) &&
      sinkfields[key] !== undefined
    ) {
      _logger.info(
        `Record comparison failure for ${src['name']} and ${sink['name']}\n
                Did not match fields for ${key}: ${srcfields[key]} and ${sinkfields[key]}`,
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
export function static_checker(
  workflow_inputs: cwlTsAuto.WorkflowInputParameter[],
  workflow_outputs: cwlTsAuto.WorkflowOutputParameter[],
  step_inputs: CommandInputParameter[],
  step_outputs: CommandOutputParameter[],
  param_to_step: { [id: string]: CWLObjectType },
): void {
  //   const src_dict: { [id: string]: cwlTsAuto.WorkflowInputParameter | CommandOutputParameter } = {};
  //   for (const param of workflow_inputs) {
  //     src_dict[param['id'].toString()] = param;
  //   }
  //   for (const param of step_outputs) {
  //     src_dict[param['id'].toString()] = param;
  //   }
  //   const step_inputs_val = check_all_types(src_dict, step_inputs, 'source', param_to_step);
  //   const workflow_outputs_val = check_all_types(src_dict, workflow_outputs, 'outputSource', param_to_step);
  //   const warnings = step_inputs_val['warning'].concat(workflow_outputs_val['warning']);
  //   const exceptions = step_inputs_val['exception'].concat(workflow_outputs_val['exception']);
  //   const warning_msgs = [];
  //   const exception_msgs = [];
  //   for (const warning of warnings) {
  //     const src = warning.src;
  //     const sink = warning.sink;
  //     const linkMerge = warning.linkMerge;
  //     const sinksf = sink
  //       .get('secondaryFiles', [])
  //       .filter((p: any) => p.get('required', true))
  //       .sort((p: any) => p['pattern']);
  //     const srcsf = src.get('secondaryFiles', []).sort((p: any) => p['pattern']);
  //     const missing = missing_subset(srcsf, sinksf);
  //     if (missing) {
  //       const msg1 = `Parameter '${shortname(sink['id'])}' requires secondaryFiles ${missing} but`;
  //       const msg3 = SourceLine(src, 'id').makeError(
  //         `source '${shortname(src['id'])}' does not provide those secondaryFiles.`,
  //       );
  //       const msg4 = SourceLine(src.get('_tool_entry', src), 'secondaryFiles').makeError(
  //         `To resolve, add missing secondaryFiles patterns to definition of '${shortname(src['id'])}' or`,
  //       );
  //       const msg5 = SourceLine(sink.get('_tool_entry', sink), 'secondaryFiles').makeError(
  //         `mark missing secondaryFiles in definition of '${shortname(sink['id'])}' as optional.`,
  //       );
  //       const msg = SourceLine(sink).makeError(`${msg1}\n${bullets([msg3, msg4, msg5], '  ')}`);
  //     } else if (sink.get('not_connected')) {
  //       if (!sink.get('used_by_step')) {
  //         const msg = SourceLine(sink, 'type').makeError(
  //           `'${shortname(sink['id'])}' is not an input parameter of ${
  //             param_to_step[sink['id']]['run']
  //           }, expected ${param_to_step[sink['id']]['inputs']
  //             .filter((s: any) => !s.get('not_connected'))
  //             .map((s: any) => shortname(s['id']))}`,
  //         );
  //       } else {
  //         const msg = '';
  //       }
  //     } else {
  //       let msg = `${SourceLine(src, 'type').makeError(
  //         `Source '${shortname(src['id'])}' of type ${JSON.stringify(src['type'])} may be incompatible`,
  //       )}\n${SourceLine(sink, 'type').makeError(
  //         `  with sink '${shortname(sink['id'])}' of type ${JSON.stringify(sink['type'])}`,
  //       )}`;
  //       if (linkMerge != null) {
  //         msg += `\n${SourceLine(sink).makeError(`  source has linkMerge method ${linkMerge}`)}`;
  //       }
  //     }
  //     if (warning.message != null) {
  //       msg += `\n${SourceLine(sink).makeError(`  ${warning.message}`)}`;
  //     }
  //     if (msg) {
  //       warning_msgs.push(msg);
  //     }
  //   }
  //   for (const exception of exceptions) {
  //     const src = exception.src;
  //     const sink = exception.sink;
  //     const linkMerge = exception.linkMerge;
  //     const extra_message = exception.message;
  //     let msg = `${SourceLine(src, 'type').makeError(
  //       `Source '${shortname(src['id'])}' of type ${JSON.stringify(src['type'])} is incompatible`,
  //     )}\n${SourceLine(sink, 'type').makeError(
  //       `  with sink '${shortname(sink['id'])}' of type ${JSON.stringify(sink['type'])}`,
  //     )}`;
  //     if (extra_message != null) {
  //       msg += `\n${SourceLine(sink).makeError(`  ${extra_message}`)}`;
  //     }
  //     if (linkMerge != null) {
  //       msg += `\n${SourceLine(sink).makeError(`  source has linkMerge method ${linkMerge}`)}`;
  //     }
  //     exception_msgs.push(msg);
  //   }
  //   for (const sink of step_inputs) {
  //     if (
  //       'null' != sink['type'] &&
  //       !sink['type'].includes('null') &&
  //       !sink.hasOwnProperty('source') &&
  //       !sink.hasOwnProperty('default') &&
  //       !sink.hasOwnProperty('valueFrom')
  //     ) {
  //       const msg = SourceLine(sink).makeError(
  //         `Required parameter '${shortname(sink['id'])}' does not have source, default, or valueFrom expression`,
  //       );
  //       exception_msgs.push(msg);
  //     }
  //   }
  //   const all_warning_msg = strip_dup_lineno(warning_msgs.join('\n'));
  //   const all_exception_msg = strip_dup_lineno(`\n${exception_msgs.join('\n')}`);
  //   if (all_warning_msg) {
  //     _logger.warning('Workflow checker warning:\n%s', all_warning_msg);
  //   }
  //   if (exceptions) {
  //     throw new ValidationException(all_exception_msg);
  //   }
}
type SrcSink = {
  src: CWLObjectType;
  sink: CWLObjectType;
  linkMerge?: string;
  message?: string;
};
type Sink = {
  valueFrom;
  pickValue;
  linkMerge;
  source;
  outputSource;
};
export function check_all_types(
  src_dict: { [key: string]: CWLObjectType },
  sinks: Sink[],
  sourceField: 'source' | 'outputSource',
  param_to_step: { [key: string]: CWLObjectType },
): { [key: string]: SrcSink[] } {
  const validation: { [key: string]: SrcSink[] } = { warning: [], exception: [] };
  //   for (const sink of sinks) {
  //     if (sourceField in sink) {
  //       const valueFrom = sink.valueFrom as string | undefined;
  //       const pickValue = sink.pickValue as string | undefined;

  //       let extra_message: string | null = null;
  //       if (pickValue !== undefined) {
  //         extra_message = `pickValue is: ${pickValue}`;
  //       }

  //       if (Array.isArray(sink[sourceField])) {
  //         let linkMerge = sink.linkMerge || (sink[sourceField].length > 1 ? 'merge_nested' : null);

  //         if (pickValue === 'first_non_null' || pickValue === 'the_only_non_null') {
  //           linkMerge = null;
  //         }

  //         const srcs_of_sink: CWLObjectType[] = [];
  //         for (const parm_id of sink[sourceField]) {
  //           srcs_of_sink.push(src_dict[parm_id]);
  //           if (is_conditional_step(param_to_step, parm_id) && pickValue === null) {
  //             validation['warning'].push({
  //               src: src_dict[parm_id],
  //               sink,
  //               linkMerge,
  //               message: 'Source is from conditional step, but pickValue is not used',
  //             });
  //           }

  //           if (is_all_output_method_loop_step(param_to_step, parm_id)) {
  //             src_dict[parm_id]['type'] = { type: 'array', items: src_dict[parm_id]['type'] };
  //           }
  //         }
  //       } else {
  //         const parm_id = sink[sourceField] as string;
  //         if (!src_dict.hasOwnProperty(parm_id)) {
  //           // Here we don't know how to translate validation exception in typescript so I omit it.
  //         }

  //         const srcs_of_sink = [src_dict[parm_id]];
  //         const linkMerge = null;

  //         if (pickValue !== undefined) {
  //           validation['warning'].push({
  //             src: src_dict[parm_id],
  //             sink,
  //             linkMerge,
  //             message: 'pickValue is used but only a single input source is declared',
  //           });
  //         }

  //         if (is_conditional_step(param_to_step, parm_id)) {
  //           let src_typ = [].concat(srcs_of_sink[0]['type']);
  //           const snk_typ = sink['type'];

  //           if (src_typ.indexOf('null') == -1) {
  //             src_typ = ['null'].concat(src_typ);
  //           }

  //           if (Array.isArray(snk_typ)) {
  //             if (snk_typ.indexOf('null') == -1) {
  //               validation['warning'].push({
  //                 src: src_dict[parm_id],
  //                 sink,
  //                 linkMerge,
  //                 message: 'Source is from conditional step and may produce `null`',
  //               });
  //             }
  //           }

  //           srcs_of_sink[0]['type'] = src_typ;
  //         }

  //         if (is_all_output_method_loop_step(param_to_step, parm_id)) {
  //           src_dict[parm_id]['type'] = { type: 'array', items: src_dict[parm_id]['type'] };
  //         }
  //       }

  //       for (const src of srcs_of_sink) {
  //         const check_result = check_types(src, sink, linkMerge, valueFrom);
  //         if (check_result == 'warning') {
  //           validation['warning'].push({ src, sink, linkMerge, message: extra_message });
  //         } else if (check_result == 'exception') {
  //           validation['exception'].push({ src, sink, linkMerge, message: extra_message });
  //         }
  //       }
  //     }
  //   }
  return validation;
}
export function circular_dependency_checker(step_inputs: CWLObjectType[]): void {
  //   const adjacency = get_dependency_tree(step_inputs);
  //   const vertices = Object.keys(adjacency);
  //   const processed: string[] = [];
  //   const cycles: string[][] = [];
  //   for (const vertex of vertices) {
  //     if (!processed.includes(vertex)) {
  //       const traversal_path = [vertex];
  //       processDFS(adjacency, traversal_path, processed, cycles);
  //     }
  //   }
  //   if (cycles.length) {
  //     let exception_msg = 'The following steps have circular dependency:\n';
  //     const cyclestrs = cycles.map((cycle) => cycle.toString());
  //     exception_msg += cyclestrs.join('\n');
  //     throw new ValidationException(exception_msg);
  //   }
}

function get_dependency_tree(step_inputs: CWLObjectType[]): { [key: string]: string[] } {
  const adjacency: { [key: string]: string[] } = {};
  for (const step_input of step_inputs) {
    if ('source' in step_input) {
      let vertices_in: string[];
      if (Array.isArray(step_input['source'])) {
        vertices_in = step_input['source'].map((src) => get_step_id(src.toString()));
      } else {
        vertices_in = [get_step_id(step_input['source'].toString())];
      }
      const vertex_out = get_step_id(step_input['id'].toString());
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

function is_conditional_step(param_to_step: { [key: string]: CWLObjectType }, parm_id: string): boolean {
  const source_step = param_to_step[parm_id];
  if (source_step && source_step['when']) {
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

function loop_checker(steps: Iterator<{ [key: string]: any }>): void {
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
}
