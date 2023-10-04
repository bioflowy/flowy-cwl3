import exp from 'node:constants';
import type { InlineJavascriptRequirement } from 'cwl-ts-auto';
import IsolatedVM from 'isolated-vm';
import { JavascriptException, SubstitutionError, WorkflowException } from './errors.js';
import { _logger } from './loghandler.js';
import type { CWLObjectType, CWLOutputType } from './utils.js';

const segmentRe = /(\.\w+|\['([^']|\\')+'\]|\["([^"]|\\")+"\]|\[[0-9]+\])/u;
const paramRe = /\((\w+)(\.\w+|\['([^']|\\')+'\]|\["([^"]|\\")+"\]|\[[0-9]+\])*\)$/u;
function scanner(scan: string): [number, number] | null {
  const DEFAULT = 0;
  const DOLLAR = 1;
  const PAREN = 2;
  const BRACE = 3;
  const SINGLE_QUOTE = 4;
  const DOUBLE_QUOTE = 5;
  const BACKSLASH = 6;

  let i = 0;
  const stack = [DEFAULT];
  let start = 0;
  while (i < scan.length) {
    const state = stack[stack.length - 1];
    const c = scan[i];

    if (state === DEFAULT) {
      if (c === '$') {
        stack.push(DOLLAR);
      } else if (c === '\\') {
        stack.push(BACKSLASH);
      }
    } else if (state === BACKSLASH) {
      stack.pop();
      if (stack[stack.length - 1] === DEFAULT) {
        return [i - 1, i + 1];
      }
    } else if (state === DOLLAR) {
      if (c === '(') {
        start = i - 1;
        stack.push(PAREN);
      } else if (c === '{') {
        start = i - 1;
        stack.push(BRACE);
      } else {
        stack.pop();
        i -= 1;
      }
    } else if (state === PAREN) {
      if (c === '(') {
        stack.push(PAREN);
      } else if (c === ')') {
        stack.pop();
        if (stack[stack.length - 1] === DOLLAR) {
          return [start, i + 1];
        }
      } else if (c === "'") {
        stack.push(SINGLE_QUOTE);
      } else if (c === '"') {
        stack.push(DOUBLE_QUOTE);
      }
    } else if (state === BRACE) {
      if (c === '{') {
        stack.push(BRACE);
      } else if (c === '}') {
        stack.pop();
        if (stack[stack.length - 1] === DOLLAR) {
          return [start, i + 1];
        }
      } else if (c === "'") {
        stack.push(SINGLE_QUOTE);
      } else if (c === '"') {
        stack.push(DOUBLE_QUOTE);
      }
    } else if (state === SINGLE_QUOTE) {
      if (c === "'") {
        stack.pop();
      } else if (c === '\\') {
        stack.push(BACKSLASH);
      }
    } else if (state === DOUBLE_QUOTE) {
      if (c === '"') {
        stack.pop();
      } else if (c === '\\') {
        stack.push(BACKSLASH);
      }
    }
    i += 1;
  }

  if (stack.length > 1 && !(stack.length === 2 && (stack[1] === BACKSLASH || stack[1] === DOLLAR))) {
    throw new SubstitutionError(
      `Substitution error, unfinished block starting at position ${start}: '${scan.slice(
        start,
      )}' stack was ${JSON.stringify(stack)}`,
    );
  }

  return null;
}
interface JSEngine {
  eval(scan: string, jslib: string, rootvars: { [key: string]: any }): Promise<CWLOutputType>;
}
class JSEngine1 implements JSEngine {
  code_fragment_to_js(jscript: string, jslib = ''): string {
    let inner_js = '';
    if (jscript.length > 1 && jscript[0] == '{') {
      inner_js = jscript;
    } else {
      inner_js = `{return ${jscript};}`;
    }

    return `"use strict";\n${jslib}\nJSON.stringify((function()${inner_js})())`;
  }
  async eval(expr: string, jslib: string, rootvars: { [key: string]: any }): Promise<CWLOutputType> {
    const isolate = new IsolatedVM.Isolate({ memoryLimit: 128 });

    // 新しいContextを作成する
    const context = isolate.createContextSync();

    // Contextに基本的なconsole.log関数を注入する
    for (const key of Object.keys(rootvars)) {
      context.global.setSync(key, new IsolatedVM.ExternalCopy(rootvars[key]).copyInto());
    }
    const jail = context.global;
    jail.setSync('global', jail.derefInto());
    // Contextにスクリプトを実行する
    const scr = this.code_fragment_to_js(expr, jslib);
    const script = isolate.compileScriptSync(scr);
    const rslt_str = await script.run(context);
    const rslt = JSON.parse(rslt_str);
    return rslt;
  }
}
export function regex_eval(
  parsed_string: string,
  remaining_string: string,
  current_value: CWLOutputType,
): CWLOutputType {
  if (remaining_string) {
    const m = remaining_string.match(segmentRe);
    if (!m) {
      return current_value;
    }
    const next_segment_str = m[1];
    let key: string | number | null = null;
    if (next_segment_str[0] === '.') {
      key = next_segment_str.substr(1);
    } else if (next_segment_str[1] === "'" || next_segment_str[1] === '"') {
      key = next_segment_str
        .substring(2, next_segment_str.length - 2)
        .replace("\\'", "'")
        .replace('\\"', '"');
    }
    if (key !== null) {
      if (Array.isArray(current_value) && key === 'length' && !remaining_string.substring(m[1].length)) {
        return current_value.length;
      }
      if (!(current_value instanceof Object)) {
        throw new WorkflowException(`${parsed_string} is a ${typeof current_value}, cannot index on string '${key}'`);
      }
      if (!{}.hasOwnProperty.call(current_value, key)) {
        throw new WorkflowException(`${parsed_string} does not contain key '${key}'.`);
      }
    } else {
      try {
        key = parseInt(next_segment_str.substring(1, next_segment_str.length - 1), 10);
      } catch (v) {
        throw new WorkflowException(String(v));
      }
      if (!Array.isArray(current_value)) {
        throw new WorkflowException(`${parsed_string} is a ${typeof current_value}, cannot index on int '${key}'`);
      }
      if (key && key >= current_value.length) {
        throw new WorkflowException(`${parsed_string} list index ${key} out of range`);
      }
    }

    if (current_value instanceof Object) {
      try {
        return regex_eval(
          parsed_string + remaining_string,
          remaining_string.substring(m[1].length),
          current_value[key as string],
        );
      } catch (err: any) {
        _logger.error(err.message);
        throw new WorkflowException(`'${parsed_string}' doesn't have property '${key}'.`);
      }
    } else if (Array.isArray(current_value) && typeof key === 'number') {
      try {
        return regex_eval(
          parsed_string + remaining_string,
          remaining_string.substring(m[1].length),
          current_value[key],
        );
      } catch (err: any) {
        _logger.error(err.message);
        throw new WorkflowException(`'${parsed_string}' doesn't have property '${key}'.`);
      }
    } else {
      throw new WorkflowException(`'${parsed_string}' doesn't have property '${key}'.`);
    }
  } else {
    return current_value;
  }
}
export function get_js_engine() {
  return new JSEngine1();
}
export async function evaluator(
  js_engine: JSEngine,
  ex: string,
  obj: CWLObjectType,
  jslib: string,
  fullJS: boolean,
): Promise<CWLOutputType | null> {
  js_engine = js_engine || get_js_engine();
  let expression_parse_exception: Error | null = null;
  const match = ex.match(paramRe);
  if (match) {
    const first_symbol = match[1];
    const first_symbol_end = match.index + first_symbol.length;

    if (first_symbol_end + 2 === ex.length && first_symbol === 'null') {
      return null;
    }
    try {
      if (!(first_symbol in obj)) {
        throw new WorkflowException(`${first_symbol} is not defined`);
      }

      return regex_eval(first_symbol, ex.slice(first_symbol_end + 1, -1), obj[first_symbol] as CWLObjectType);
    } catch (werr) {
      expression_parse_exception = werr;
    }
  }
  if (fullJS) {
    return (await js_engine.eval(ex, jslib, obj)) as CWLObjectType;
  } else {
    if (expression_parse_exception !== null) {
      throw new JavascriptException(
        `Syntax error in parameter reference '${ex.slice(1, -1)}': ${
          expression_parse_exception.message
        }. This could be ` +
          `due to using Javascript code without specifying ` +
          `InlineJavascriptRequirement.`,
      );
    } else {
      throw new JavascriptException(
        `Syntax error in parameter reference '${ex}'. This could be due ` +
          `to using Javascript code without specifying ` +
          `InlineJavascriptRequirement.`,
      );
    }
  }
}
function _convert_dumper(string: string): string {
  return `${JSON.stringify(string)} + `;
}
async function interpolate(
  scan: string,
  rootvars: CWLObjectType,
  jslib = '',
  fullJS = false,
  strip_whitespace = true,
  escaping_behavior = 2,
  convert_to_expression = false,
  js_engine: JSEngine | null = null,
): Promise<CWLOutputType | null> {
  if (strip_whitespace) {
    scan = scan.trim();
  }
  const parts = [];
  let dump;

  if (convert_to_expression) {
    dump = _convert_dumper;
    parts.push('${return ');
  } else {
    dump = (string: string) => string;
  }
  let w = scanner(scan);

  while (w) {
    if (convert_to_expression) {
      parts.push(`"${scan.substring(0, w[0])}" + `);
    } else {
      parts.push(scan.substring(0, w[0]));
    }
    if (scan[w[0]] == '$') {
      if (!convert_to_expression) {
        js_engine = js_engine || get_js_engine();
        const e = await evaluator(js_engine, scan.substring(w[0] + 1, w[1]), rootvars, jslib, fullJS);
        if (w[0] == 0 && w[1] == scan.length && parts.length <= 1) {
          return e;
        }
        let leaf = JSON.stringify(e);
        if (leaf[0] == '"') {
          leaf = JSON.parse(leaf);
        }
        parts.push(leaf);
      } else {
        parts.push(
          `function(){var item =${scan
            .substring(w[0], w[1])
            .slice(2, -1)}; if (typeof(item) === "string"){ return item; } ` +
            `else { return JSON.stringify(item); }}() + `,
        );
      }
    } else if (scan[w[0]] == '\\') {
      if (escaping_behavior == 1) {
        const e = scan[w[1] - 1];
        parts.push(dump(e));
      } else if (escaping_behavior == 2) {
        const e = scan.substring(w[0], w[1] + 1);
        if (e == '\\$(' || e == '\\${') {
          parts.push(dump(e.slice(1)));
          w = [w[0], w[1] + 1];
        } else if (e[1] == '\\') {
          parts.push(dump('\\'));
        } else {
          parts.push(dump(e.slice(0, 2)));
        }
      } else {
        throw new Error(`Unknown escaping behavior ${escaping_behavior}`);
      }
    }
    scan = scan.substring(w[1]);
    w = scanner(scan);
  }
  if (convert_to_expression) {
    parts.push(`"${scan}"`);
    parts.push(';}');
  } else {
    parts.push(scan);
  }
  return parts.join('');
}

function jshead(engine_config: string[]): string {
  return engine_config.join('\n');
}

export function needs_parsing(snippet: any): boolean {
  return typeof snippet === 'string' && (snippet.includes('$(') || snippet.includes('${'));
}
export async function do_eval(
  ex: CWLOutputType | null,
  jobinput: CWLObjectType,
  requirements: InlineJavascriptRequirement | undefined,
  outdir: string | null,
  tmpdir: string | null,
  resources: { [key: string]: number },
  context: CWLOutputType | null = null,
  strip_whitespace = true,
  cwlVersion = '',
): Promise<CWLOutputType | null> {
  const runtime = { ...resources } as { [key: string]: number | string | null };
  runtime['tmpdir'] = tmpdir ? tmpdir : null;
  runtime['outdir'] = outdir ? outdir : null;

  const rootvars = { inputs: jobinput, self: context, runtime } as CWLObjectType;

  if (typeof ex === 'string' && needs_parsing(ex)) {
    let fullJS = false;
    let jslib = '';
    if (requirements) {
      fullJS = true;
      jslib = jshead(requirements.expressionLib ?? []);
    }

    try {
      const ret = await interpolate(
        ex,
        rootvars,
        jslib,
        fullJS,
        strip_whitespace,
        cwlVersion in ['v1.0', 'v1.1.0-dev1', 'v1.1', 'v1.2.0-dev1', 'v1.2.0-dev2', 'v1.2.0-dev3'] ? 1 : 2,
        false,
        get_js_engine(),
      );
      return ret;
    } catch (e) {
      throw new WorkflowException(`Expression evaluation error:\n${e.message}`);
    }
  } else {
    return ex;
  }
}
