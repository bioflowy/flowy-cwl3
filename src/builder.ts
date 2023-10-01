import * as fs from 'node:fs';
import type { CpuInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as cwlTsAuto from 'cwl-ts-auto';
import {
  CommandInputEnumSchema,
  CommandInputRecordField,
  CommandInputRecordSchema,
  InlineJavascriptRequirement,
  InputRecordSchema,
  SecondaryFileSchema,
} from 'cwl-ts-auto';
import { deepcopy } from './copy.js';
import { ValidationException, WorkflowException } from './errors.js';
import * as expression from './expression.js';
import { _logger } from './loghandler.js';
import { PathMapper } from './pathmapper.js';
import { StdFsAccess } from './stdfsaccess.js';
import {
  type CommandInputParameter,
  type ToolRequirement,
  CommandLineBinded,
  type CommandLineBinding,
} from './types.js';
import {
  CONTENT_LIMIT,
  type CWLObjectType,
  type CWLOutputType,
  type CommentedMap,
  HasReqsHints,
  type MutableMapping,
  type MutableSequence,
  aslist,
  get_listing,
  normalizeFilesDirs,
  visit_class,
  isString,
  getRequirement,
  get_filed_name,
} from './utils.js';
import { validate } from './validate.js';

export const INPUT_OBJ_VOCAB: { [key: string]: string } = {
  Any: 'https://w3id.org/cwl/salad#Any',
  File: 'https://w3id.org/cwl/cwl#File',
  Directory: 'https://w3id.org/cwl/cwl#Directory',
};

export async function contentLimitRespectedReadBytes(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(CONTENT_LIMIT + 1);
    const fd = fs.openSync(fileURLToPath(filePath), 'r');
    fs.read(fd, buffer, 0, CONTENT_LIMIT + 1, null, (err, bytesRead, buffer) => {
      fs.closeSync(fd);
      if (err) {
        reject(err);
        return;
      }
      if (bytesRead > CONTENT_LIMIT) {
        reject(new WorkflowException(`file is too large, loadContents limited to ${CONTENT_LIMIT} bytes`));
        return;
      }
      resolve(buffer.slice(0, bytesRead).toString('utf-8'));
    });
  });
}

export function substitute(value: string, replace: string): string {
  if (replace.startsWith('^')) {
    try {
      return substitute(value.substring(0, value.lastIndexOf('.')), replace.substring(1));
    } catch (e) {
      return value + replace.replace(/^\^+/g, '');
    }
  }
  return value + replace;
}

export class Builder {
  job: any;
  files: any[];
  bindings: CommandLineBinded[];
  schemaDefs: { [key: string]: any };
  names: any;
  requirements?: undefined | ToolRequirement;
  hints?: undefined | any[];
  resources: { [key: string]: number };
  mutation_manager: any | null;
  formatgraph: any | null;
  make_fs_access: any;
  fs_access: StdFsAccess;
  job_script_provider: any | null;
  timeout: number;
  debug: boolean;
  js_console: boolean;
  force_docker_pull: boolean;
  loadListing: any;
  outdir: string;
  tmpdir: string;
  stagedir: string;
  cwlVersion: string;
  container_engine: string;
  pathmapper: PathMapper | null;
  prov_obj: any | null;
  find_default_container: any | null;

  // eslint-disable-next-line max-params
  constructor(
    job: any,
    files: any[],
    bindings: CommandLineBinded[],
    schemaDefs: { [key: string]: any },
    names: any,
    requirements: ToolRequirement,
    hints: ToolRequirement,
    resources: { [key: string]: number },
    mutation_manager: any | null,
    formatgraph: any | null,
    make_fs_access: any,
    fs_access: any,
    job_script_provider: any | null,
    timeout: number,
    debug: boolean,
    js_console: boolean,
    force_docker_pull: boolean,
    loadListing: any,
    outdir: string,
    tmpdir: string,
    stagedir: string,
    cwlVersion: string,
    container_engine: string,
  ) {
    this.job = job;
    this.files = files;
    this.bindings = bindings;
    this.schemaDefs = schemaDefs;
    this.names = names;
    this.requirements = requirements;
    this.hints = hints;
    this.resources = resources;
    this.mutation_manager = mutation_manager;
    this.formatgraph = formatgraph;
    this.make_fs_access = make_fs_access;
    this.fs_access = fs_access;
    this.job_script_provider = job_script_provider;
    this.timeout = timeout;
    this.debug = debug;
    this.js_console = js_console;
    this.force_docker_pull = force_docker_pull;
    this.loadListing = loadListing;
    this.outdir = outdir;
    this.tmpdir = tmpdir;
    this.stagedir = stagedir;
    this.cwlVersion = cwlVersion;
    this.pathmapper = null;
    this.prov_obj = null;
    this.find_default_container = null;
    this.container_engine = container_engine;
  }

  build_job_script(commands: string[]): string | null {
    if (this.job_script_provider) {
      return this.job_script_provider.build_job_script(this, commands);
    }
    return null;
  }
  async handle_union(
    schema: CommandInputParameter,
    datum: CWLObjectType | CWLObjectType[],
    discover_secondaryFiles: boolean,
    value_from_expression: boolean,
    lead_pos: number | number[] | undefined = undefined,
    // eslint-disable-next-line
    tail_pos: string | number[] | undefined = undefined,
  ): Promise<CommandLineBinded[] | undefined> {
    let bound_input = false;
    if (!Array.isArray(schema.type)) {
      throw new Error('Unexpected');
    }
    for (let t of schema.type) {
      if (isString(t)) {
        if (t in this.schemaDefs) {
          t = this.schemaDefs[t];
        }
      } else if (t.name in this.schemaDefs) {
        t = this.schemaDefs[t.name];
      }

      if (validate(t, datum, false)) {
        schema = JSON.parse(JSON.stringify(schema));
        schema['type'] = t;
        if (!value_from_expression) {
          return this.bind_input(schema, datum, discover_secondaryFiles, lead_pos, tail_pos);
        } else {
          await this.bind_input(schema, datum, discover_secondaryFiles, lead_pos, tail_pos);
          bound_input = true;
        }
      }
    }
    if (!bound_input) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new ValidationException(
        `'${JSON.stringify(datum)}' is not a valid union ${JSON.stringify(schema['type'])}`,
      );
    }
    return undefined;
  }
  async bind_input(
    schema: CommandInputParameter,
    datum: CWLObjectType | CWLObjectType[],
    discover_secondaryFiles: boolean,
    lead_pos?: number | number[],
    tail_pos?: string | number[],
  ): Promise<CommandLineBinded[]> {
    const debug = _logger.isDebugEnabled();

    if (tail_pos === undefined) {
      tail_pos = [];
    }

    if (lead_pos === undefined) {
      lead_pos = [];
    }

    const bindings: CommandLineBinded[] = [];
    let binding: CommandLineBinded | undefined;
    let value_from_expression = false;

    if ('inputBinding' in schema && typeof schema['inputBinding'] === 'object') {
      [binding, value_from_expression] = await this.handle_binding(schema, datum, lead_pos, tail_pos, debug);
    }

    if (Array.isArray(schema['type'])) {
      if (!value_from_expression) {
        const ret = this.handle_union(
          schema,
          datum,
          discover_secondaryFiles,
          value_from_expression,
          lead_pos,
          tail_pos,
        );
        return ret;
      } else {
        await this.handle_union(schema, datum, discover_secondaryFiles, value_from_expression, lead_pos, tail_pos);
      }
    } else if (typeof schema['type'] === 'object') {
      await this.handle_map(
        schema,
        datum,
        discover_secondaryFiles,
        lead_pos,
        tail_pos,
        bindings,
        binding,
        value_from_expression,
      );
    } else {
      if (schema['type'] == 'org.w3id.cwl.salad.Any') {
        this.handle_any(schema, datum);
      }
      if (typeof schema['type'] === 'string') {
        if (schema['type'] in this.schemaDefs) {
          schema = this.schemaDefs[schema['type']];
        }
      }

      if (schema['type'] == 'record') {
        datum = await this.handle_record(schema, datum, discover_secondaryFiles, lead_pos, tail_pos, bindings);
      }

      if (schema['type'] == 'array') {
        await this.handle_array(
          schema,
          datum as CWLObjectType[],
          discover_secondaryFiles,
          lead_pos,
          tail_pos,
          bindings,
          binding,
        );
        binding = undefined;
      }

      const _capture_files = (f: CWLObjectType): CWLObjectType => {
        this.files.push(f);
        return f;
      };

      if (schema['type'] == 'File') {
        await this.handleFile(schema, datum, discover_secondaryFiles, debug, binding);
      }

      if (schema['type'] == 'Directory') {
        datum = this.handle_directory(schema, datum);
      }

      if (schema['type'] == 'Any') {
        visit_class(datum, ['File', 'Directory'], _capture_files);
      }
    }
    if (binding) {
      for (const bi of bindings) {
        const positions: (string | number)[] = [...binding.positions];
        positions.push(...bi.positions);
        bi.positions = positions;
      }
      bindings.push(binding);
    }
    return bindings;
  }
  handle_any(schema: CommandInputParameter, datum: CWLObjectType | CWLObjectType[]): void {
    if (datum instanceof Array) {
      schema.type = 'array';
      schema['items'] = 'Any';
    } else if (datum instanceof Object) {
      if (datum['class'] === 'File') {
        schema.type = 'File';
      } else if (datum['class'] === 'Directory') {
        schema.type = 'Directory';
      } else {
        schema.type = 'record';
        const fields = Object.keys(datum).map((field_name) => {
          const t: CommandInputParameter = new cwlTsAuto.CommandInputParameter({ type: 'Any' });
          t.name = field_name;
          return t;
        });
        schema.fields['fields'] = fields;
      }
    }
  }

  handle_directory(schema: CommandInputParameter, datum: CWLObjectType | CWLObjectType[]): CWLObjectType {
    datum = datum as CWLObjectType;
    const ll = schema.loadListing;
    if (ll && ll !== 'no_listing') {
      get_listing(this.fs_access, datum, ll === 'deep_listing');
    }
    this.files.push(datum);
    return datum;
  }
  async handleFile(
    schema: CommandInputParameter,
    datum: CWLObjectType | CWLObjectType[],
    discoverSecondaryFiles: boolean,
    debug: boolean,
    binding: { [key: string]: string | number[] } | CommentedMap,
  ): Promise<void> {
    const _captureFiles = (f: CWLObjectType): CWLObjectType => {
      this.files.push(f);
      return f;
    };

    datum = datum as CWLObjectType;
    this.files.push(datum);

    let loadContentsSourceline: { [key: string]: string | number[] } | CommandInputParameter | null = null;
    if (binding && binding['loadContents']) {
      loadContentsSourceline = binding;
    } else if (schema.loadContents) {
      loadContentsSourceline = schema;
    }

    if (loadContentsSourceline && loadContentsSourceline['loadContents']) {
      try {
        datum['contents'] = await contentLimitRespectedReadBytes(datum['location'] as string);
      } catch (error) {
        throw new WorkflowException(`Reading ${datum['location']}\n${error}`);
      }
    }

    if (schema.secondaryFiles) {
      return this.handleSecondaryFile(schema, datum, discoverSecondaryFiles, debug);
    }

    if (schema.format) {
      await this.handleFileFormat(schema, datum, debug);
    }

    visit_class(datum['secondaryFiles'] || [], ['File', 'Directory'], _captureFiles);
  }
  async handleFileFormat(schema: CommandInputParameter, datum: CWLObjectType | CWLObjectType[], debug: boolean) {
    const eval_format: any = await this.do_eval(schema.format);
    let evaluated_format: string | string[];

    if (typeof eval_format === 'string') {
      evaluated_format = eval_format;
    } else if (Array.isArray(eval_format)) {
      for (let index = 0; index < eval_format.length; index++) {
        const entry = eval_format[index];
        let message = '';
        if (typeof entry !== 'string') {
          message = `An expression in the 'format' field must evaluate to a string, or list of strings. However a non-string item was received: ${entry} of type ${typeof entry}. The expression was ${
            schema.format
          } and its fully evaluated result is ${eval_format}.`;
        }
        if (expression.needs_parsing(entry)) {
          message = `For inputs, 'format' field can either contain a single CWL Expression or CWL Parameter Reference, a single format string, or a list of format strings. But the list cannot contain CWL Expressions or CWL Parameter References. List entry number ${
            index + 1
          } contains the following unallowed CWL Parameter Reference or Expression: ${entry}.`;
        }
        if (message) {
          throw new WorkflowException(message);
        }
      }
      evaluated_format = eval_format as string[];
    } else {
      throw new WorkflowException(
        `An expression in the 'format' field must evaluate to a string, or list of strings. However the type of the expression result was ${typeof eval_format}. The expression was ${
          schema['format']
        } and its fully evaluated result is ${eval_format}.`,
      );
    }
    // TODO check_format is not implemented
    // try {
    //     check_format(datum, evaluated_format, this.formatgraph);
    // } catch (ve) {
    //     throw new WorkflowException(
    //         "Expected value of " + schema['name'] + " to have format " + schema['format'] + " but\n " + ve);
    // }
  }
  async handleSecondaryFile(
    schema: CommandInputParameter,
    datum: CWLObjectType,
    discover_secondaryFiles: boolean,
    debug: boolean,
  ): Promise<void> {
    let sf_schema: SecondaryFileSchema[] = [];
    if (!('secondaryFiles' in datum)) {
      datum['secondaryFiles'] = [];
      sf_schema = aslist(schema.secondaryFiles);
    } else if (!discover_secondaryFiles) {
      sf_schema = []; // trust the inputs
    } else {
      sf_schema = aslist(schema.secondaryFiles);
    }

    let sf_required = true;
    for (const [num, sf_entry] of sf_schema.entries()) {
      if (sf_entry.required !== undefined) {
        const required_result = await this.do_eval(sf_entry.required, datum);
        if (!(typeof required_result === 'boolean' || required_result === null)) {
          throw new WorkflowException(
            `The result of a expression in the field 'required' must be a bool or None, not a ${typeof required_result}. Expression ${
              sf_entry.required
            } resulted in ${required_result}.`,
          );
        }
        sf_required = required_result as boolean;
      }

      let sfpath: any;
      const pattern = sf_entry.pattern;
      if (typeof pattern === 'string') {
        if (pattern.includes('$(') || pattern.includes('${')) {
          sfpath = await this.do_eval(sf_entry.pattern, { context: datum });
        } else {
          sfpath = substitute(datum['basename'] as string, pattern);
        }
      }

      for (const sfname of aslist(sfpath)) {
        if (!sfname) {
          continue;
        }
        this.handle_secondary_path(schema, datum, discover_secondaryFiles, debug, sf_entry, sf_required, sfname);
      }
    }

    normalizeFilesDirs(datum['secondaryFiles'] as MutableSequence<CWLObjectType>);
  }
  handle_secondary_path(
    schema: CommandInputParameter,
    datum: CWLObjectType,
    discover_secondaryFiles: boolean,
    debug: boolean,
    sf_entry: any,
    sf_required: any,
    sfname: any,
  ) {
    let found = false;

    let d_location: string;
    let sf_location: string;
    let sfbasename: string;

    if (typeof sfname === 'string') {
      d_location = datum['location'] as string;
      if (d_location.indexOf('/') != -1) {
        sf_location = d_location.slice(0, d_location.lastIndexOf('/') + 1) + sfname;
      } else {
        sf_location = d_location + sfname;
      }
      sfbasename = sfname;
    } else if (typeof sfname === 'object') {
      sf_location = sfname['location'];
      sfbasename = sfname['basename'];
    } else {
      throw new WorkflowException(
        'Expected secondaryFile expression to ' +
          "return type 'str', a 'File' or 'Directory' " +
          'dictionary, or a list of the same. Received ' +
          `${typeof sfname} from ${sf_entry['pattern']}.`,
      );
    }

    for (const d of aslist(datum['secondaryFiles'])) {
      if (!d['basename']) {
        d['basename'] = d['location'].slice(d['location'].lastIndexOf('/') + 1);
      }
      if (d['basename'] == sfbasename) {
        found = true;
      }
    }

    if (!found) {
      function addsf(files: CWLObjectType[], newsf: CWLObjectType): void {
        for (const f of files) {
          if (f['location'] == newsf['location']) {
            f['basename'] = newsf['basename'];
            return;
          }
        }
        files.push(newsf);
      }

      if (typeof sfname === 'object') {
        addsf(datum['secondaryFiles'] as CWLObjectType[], sfname);
      } else if (discover_secondaryFiles && this.fs_access.exists(sf_location)) {
        addsf(datum['secondaryFiles'] as CWLObjectType[], {
          location: sf_location,
          basename: sfname,
          class: 'File',
        });
      } else if (sf_required) {
        throw new WorkflowException(
          `Missing required secondary file '${sfname}' from file object: ${JSON.stringify(datum, null, 4)}`,
        );
      }
    }
  }
  async handle_array(
    schema: CommandInputParameter,
    datum: CWLObjectType[],
    discover_secondaryFiles: boolean,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    bindeds: CommandLineBinded[],
    binded: CommandLineBinded,
  ): Promise<CommandLineBinded> {
    for (const [n, item] of datum.entries()) {
      let b2: CommandLineBinding | undefined = undefined;
      if (binded) {
        b2 = { ...binded };
        b2.position = binded.positions;
      }
      const itemschema: CommandInputParameter = {
        type: schema.items,
        inputBinding: b2,
        format: schema.format,
        streamable: schema.streamable,
        secondaryFiles: schema.secondaryFiles,
      };
      const bs = await this.bind_input(itemschema, item, discover_secondaryFiles, n, tail_pos);
      bindeds.push(...bs);
    }
    return { positions: undefined };
  }
  async handle_record(
    schema: CommandInputParameter,
    datum: any,
    discover_secondaryFiles: any,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    bindings: CommandLineBinding[],
  ): Promise<any> {
    for (const f of schema.fields) {
      const name = get_filed_name(f.name);
      if (name in datum && datum[name] !== null) {
        const bs = await this.bind_input(f, datum[name], discover_secondaryFiles, lead_pos, name);
        bindings.push(...bs);
      } else {
        datum[name] = f.default_ ?? null;
      }
    }
    return datum;
  }
  async handle_map(
    schema: CommandInputParameter,
    datum: any,
    discover_secondaryFiles: any,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    bindings: CommandLineBinded[],
    binding: CommandLineBinded | undefined,
    value_from_expression: any,
  ) {
    if (isString(schema.type) || Array.isArray(schema.type)) {
      throw new Error('Error');
    }
    const st = schema.type;
    if (binding && !st.inputBinding && st.type == 'array' && binding.itemSeparator === undefined) {
      st.inputBinding = new cwlTsAuto.InputBinding({});
    }
    for (const k of ['secondaryFiles', 'format', 'streamable']) {
      if (k in schema) {
        st[k] = schema[k];
      }
    }
    if (value_from_expression) {
      await this.bind_input(st, datum, discover_secondaryFiles, lead_pos, tail_pos);
    } else {
      const bs = await this.bind_input(st, datum, discover_secondaryFiles, lead_pos, tail_pos);
      bindings.push(...bs);
    }
  }
  async handle_binding(
    schema: CommandInputParameter,
    datum: any,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    debug: any,
  ): Promise<[CommandLineBinded, boolean]> {
    const binding = schema.inputBinding;
    const binded = CommandLineBinded.fromBinding(binding);

    const bp: (number | string)[] = [...aslist(lead_pos)];
    if (binding.position) {
      const position = binding.position;
      if (typeof position === 'string') {
        const result = await this.do_eval(position, datum);
        if (typeof result !== 'number') {
          throw new WorkflowException(
            "'position' expressions must evaluate to an int, " +
              `not a ${typeof result}. Expression ${position} ` +
              `resulted in ${result?.toString()}.`,
          );
        }
        binding.position = result;
        bp.push(result);
      } else {
        bp.push(...aslist(binding.position));
      }
    } else {
      bp.push(0);
    }
    bp.push(...aslist<string | number>(tail_pos));
    binded.positions = bp;

    binded.datum = datum;
    const valueFrom: boolean = binded.valueFrom !== undefined;
    return [binded, valueFrom];
  }
  tostr(value: any): string {
    if (value instanceof Object && ['File', 'Directory'].indexOf(value['class']) !== -1) {
      if (!value.hasOwnProperty('path')) {
        throw new WorkflowException(`${value['class']} object missing "path": ${value}`);
      }
      return value['path'];
      // TODO
      // } else if (value instanceof ScalarFloat) {
      //     let rep = new RoundTripRepresenter();
      //     let dec_value = new Decimal(rep.represent_scalar_float(value).value);
      //     if (dec_value.toString().indexOf("E") !== -1) {
      //         return dec_value.quantize(1).toString();
      //     }
      //     return dec_value.toString();
    } else {
      return value.toString();
    }
  }
  async generate_arg(binding: CommandLineBinded): Promise<string[]> {
    let value = binding.datum;
    const debug = _logger.isDebugEnabled();

    if (binding.valueFrom) {
      try {
        value = await this.do_eval(binding.valueFrom, value);
      } catch (e) {
        throw e;
      }
    }

    const prefix = binding.prefix;
    const sep = !(binding.separate === false);
    if (prefix == null && !sep) {
      throw new WorkflowException("'separate' option can not be specified without prefix");
    }

    let argl: CWLOutputType[] = [];
    if (value instanceof Array) {
      if (binding.itemSeparator && value.length > 0) {
        const itemSeparator = binding.itemSeparator;
        argl = [value.map((v) => this.tostr(v)).join(itemSeparator)];
      } else if (binding.valueFrom) {
        const v2 = value.map((v) => this.tostr(v));
        return (prefix ? [prefix] : []).concat(v2);
      } else if (prefix && value.length > 0) {
        return [prefix];
      } else {
        return [];
      }
    } else if (value instanceof Object && ['File', 'Directory'].includes(value['class'] as string)) {
      argl = [value];
    } else if (value instanceof Object) {
      return prefix ? [prefix] : [];
    } else if (value === true && prefix) {
      return [prefix];
    } else if (value === false || value === null || (value === true && !prefix)) {
      return [];
    } else {
      argl = [value];
    }

    let args: (string | undefined)[] = [];
    for (const j of argl) {
      if (sep) {
        args = args.concat([prefix, this.tostr(j)]);
      } else {
        args.push((prefix ? prefix : '') + this.tostr(j));
      }
    }

    return args.filter((item): item is string => typeof item === 'string');
  }
  async do_eval(
    ex: CWLOutputType | undefined,
    context: any = undefined,
    recursive = false,
    strip_whitespace = true,
  ): Promise<CWLOutputType | undefined> {
    if (recursive) {
      if (ex instanceof Map) {
        const mutatedMap: { [key: string]: any } = {};
        ex.forEach((value, key) => {
          mutatedMap[key] = this.do_eval(value, context, recursive);
        });
        return mutatedMap;
      }
      if (Array.isArray(ex)) {
        const rets: CWLOutputType[] = [];
        for (let index = 0; index < ex.length; index++) {
          const ret = await this.do_eval(ex[index], context, recursive);
          rets.push(ret);
        }
        return rets;
      }
    }

    let resources = this.resources;
    if (this.resources && 'cores' in this.resources) {
      const cores = resources['cores'];
      resources = { ...resources };
      resources['cores'] = Math.ceil(cores);
    }
    const [javascriptRequirement] = getRequirement(this, InlineJavascriptRequirement);
    const ret = await expression.do_eval(
      ex as CWLObjectType,
      this.job,
      javascriptRequirement,
      this.outdir,
      this.tmpdir,
      resources,
      context,
      strip_whitespace,
      this.cwlVersion,
    );
    return ret;
  }
}
