import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import * as cwlTsAuto from 'cwl-ts-auto';

import { InlineJavascriptRequirement } from 'cwl-ts-auto';
import {
  ArrayType,
  CommandInputArraySchema,
  CommandInputEnumSchema,
  CommandInputParameter,
  CommandInputRecordSchema,
  Directory,
  File,
  SecondaryFileSchema,
  isCommandInputArraySchema,
  isCommandInputRecordSchema,
} from './cwltypes.js';
import { ValidationException, WorkflowException } from './errors.js';
import * as expression from './expression.js';
import { FormatGraph } from './formatgraph.js';
import { _logger } from './loghandler.js';
import { PathMapper } from './pathmapper.js';
import { SharedFileSystem } from './server/config.js';
import { getServerConfig } from './server/server.js';
import { StdFsAccess } from './stdfsaccess.js';
import { type ToolRequirement, CommandLineBinded } from './types.js';
import {
  CONTENT_LIMIT,
  type CWLObjectType,
  type CWLOutputType,
  aslist,
  get_listing,
  normalizeFilesDirs,
  isString,
  getRequirement,
  get_filed_name,
  str,
  visitFileDirectory,
  isFileOrDirectory,
} from './utils.js';
import { validate } from './validate.js';

export const INPUT_OBJ_VOCAB: { [key: string]: string } = {
  Any: 'https://w3id.org/cwl/salad#Any',
  File: 'https://w3id.org/cwl/cwl#File',
  Directory: 'https://w3id.org/cwl/cwl#Directory',
};
const streamToString = async (stream: Readable): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
};
export async function getFileContentFromS3(config: SharedFileSystem, s3Url: string): Promise<string> {
  if (config.type !== 's3') {
    throw new Error('Unsupported file system type');
  }

  // S3のクライアントを初期化
  const s3 = new S3Client({
    forcePathStyle: true,
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKey ?? '',
      secretAccessKey: config.secretKey ?? '',
    },
  });

  // S3のURLからバケット名とオブジェクトキーを抽出
  const urlParts = new URL(s3Url);
  const bucket = urlParts.hostname.split('.')[0];
  const key = urlParts.pathname.substring(1);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const { Body } = await s3.send(command);
  if (Body instanceof Readable) {
    return streamToString(Body);
  }
  throw new Error('Invalid object body type.');
}
export async function contentLimitRespectedReadBytes(filePath: string): Promise<string> {
  if (filePath.startsWith('s3://')) {
    const config = getServerConfig();
    return getFileContentFromS3(config.sharedFileSystem, filePath);
  }
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
async function check_format(actual_file: File[], input_formats: string | string[], ontology: FormatGraph) {
  // Confirm that the format present is valid for the allowed formats."""
  for (const afile of aslist(actual_file)) {
    if (!afile) {
      continue;
    }
    if (!afile.format) {
      throw new ValidationException(`File has no 'format' defined: ${JSON.stringify(afile, null, 4)}`);
    }
    for (const inpf of aslist(input_formats)) {
      if (afile.format === inpf) {
        return;
      } else {
        if (!ontology.isLoaded()) {
          await ontology.loads();
        }
        if (ontology.isSubClassOf(afile.format, inpf)) {
          return;
        }
      }
    }
    throw new ValidationException(`File has an incompatible format: ${JSON.stringify(afile, null, 4)}`);
  }
}

export function substitute(value: string, replace: string): string {
  if (replace.startsWith('^')) {
    try {
      return substitute(value.substring(0, value.lastIndexOf('.')), replace.substring(1));
    } catch {
      return value + replace.replace(/^\^+/gu, '');
    }
  }
  return value + replace;
}
export class Builder {
  job: CWLObjectType;
  files: (File | Directory)[];
  bindings: CommandLineBinded[];
  schemaDefs: {
    [key: string]: CommandInputArraySchema | CommandInputEnumSchema | CommandInputRecordSchema;
  };
  requirements?: undefined | ToolRequirement;
  hints?: undefined | ToolRequirement;
  resources: { [key: string]: number };
  formatgraph: FormatGraph;
  make_fs_access: new (string) => StdFsAccess;
  fs_access: StdFsAccess;
  timeout: number;
  debug: boolean;
  js_console: boolean;
  force_docker_pull: boolean;
  loadListing: cwlTsAuto.LoadListingEnum;
  outdir: string;
  tmpdir: string;
  stagedir: string;
  cwlVersion: string;
  container_engine: string;
  pathmapper: PathMapper | null;

  // eslint-disable-next-line max-params
  constructor(
    job: CWLObjectType,
    files: (File | Directory)[],
    bindings: CommandLineBinded[],
    schemaDefs: {
      [key: string]: CommandInputArraySchema | CommandInputEnumSchema | CommandInputRecordSchema;
    },
    requirements: ToolRequirement,
    hints: ToolRequirement,
    resources: { [key: string]: number },
    formatgraph: FormatGraph,
    make_fs_access: any,
    fs_access: any,
    timeout: number,
    debug: boolean,
    js_console: boolean,
    force_docker_pull: boolean,
    loadListing: cwlTsAuto.LoadListingEnum,
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
    this.requirements = requirements;
    this.hints = hints;
    this.resources = resources;
    this.formatgraph = formatgraph;
    this.make_fs_access = make_fs_access;
    this.fs_access = fs_access;
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
    this.container_engine = container_engine;
  }

  async handle_union(
    schema: CommandInputParameter,
    datum: CWLOutputType,
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
          const schemaDef = this.schemaDefs[t];
          t = schemaDef;
        }
      } else if (t.name in this.schemaDefs) {
        t = this.schemaDefs[t.name];
      }

      if (validate(t, datum, false)) {
        schema = JSON.parse(JSON.stringify(schema));
        schema.type = t;
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
      throw new ValidationException(`'${JSON.stringify(datum)}' is not a valid union ${JSON.stringify(schema.type)}`);
    }
    return undefined;
  }
  async bind_input(
    schema: CommandInputParameter,
    datum: CWLOutputType,
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

    if (schema.inputBinding) {
      [binding, value_from_expression] = await this.handle_binding(schema, datum, lead_pos, tail_pos);
    }

    if (Array.isArray(schema.type)) {
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
    } else if (typeof schema.type === 'object') {
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
      if (schema.type == 'org.w3id.cwl.salad.Any') {
        this.handle_any(schema, datum);
      }
      if (typeof schema.type === 'string') {
        if (schema.type in this.schemaDefs) {
          const schemaDef = this.schemaDefs[schema.type];
          const binded = await this.bind_inputObject(schemaDef, datum, discover_secondaryFiles, lead_pos, tail_pos);
          bindings.push(...binded);
        }
      }

      const _capture_files = (f: File | Directory) => {
        this.files.push(f);
      };

      if (schema.type == 'File') {
        await this.handleFile(schema, datum, discover_secondaryFiles, debug, binding);
      }

      if (schema.type == 'Directory') {
        datum = await this.handle_directory(schema, datum);
      }

      if (schema.type == 'Any') {
        visitFileDirectory(datum, _capture_files);
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
  async bind_inputObject(
    schema: CommandInputRecordSchema | CommandInputEnumSchema | CommandInputArraySchema,
    datum: CWLOutputType,
    discover_secondaryFiles: boolean,
    lead_pos?: number | number[],
    tail_pos?: string | number[],
    parentSchema?: CommandInputParameter,
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

    if (schema.inputBinding) {
      [binding, value_from_expression] = await this.handle_binding(schema, datum, lead_pos, tail_pos);
    }

    if (isCommandInputRecordSchema(schema)) {
      datum = await this.handle_record(schema, datum, discover_secondaryFiles, lead_pos, tail_pos, bindings);
    } else if (isCommandInputArraySchema(schema)) {
      await this.handle_array(
        schema,
        datum as CWLObjectType[],
        discover_secondaryFiles,
        lead_pos,
        tail_pos,
        bindings,
        binding,
        parentSchema,
      );
      binding = undefined;
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
  handle_any(schema: CommandInputParameter, datum: CWLOutputType): void {
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
          const t: CommandInputParameter = { type: 'Any' };
          t.name = field_name;
          return t;
        });
        (schema as any).fields['fields'] = fields;
      }
    }
  }

  async handle_directory(schema: CommandInputParameter, datum: CWLOutputType): Promise<Directory> {
    const dir = datum as Directory;
    const ll = schema.loadListing ?? this.loadListing;
    if (ll && ll !== cwlTsAuto.LoadListingEnum.NO_LISTING) {
      await get_listing(this.fs_access, datum, ll === cwlTsAuto.LoadListingEnum.DEEP_LISTING);
    }
    this.files.push(dir);
    return dir;
  }
  async handleFile(
    schema: CommandInputParameter,
    datum2: CWLOutputType,
    discoverSecondaryFiles: boolean,
    debug: boolean,
    binding: CommandLineBinded,
  ): Promise<void> {
    const datum = datum2 as File;
    this.files.push(datum);

    let loadContentsSourceline: CommandLineBinded | CommandInputParameter | null = null;
    if (binding && binding.loadContents) {
      loadContentsSourceline = binding;
    } else if (schema.loadContents) {
      loadContentsSourceline = schema;
    }

    if (loadContentsSourceline && loadContentsSourceline.loadContents) {
      try {
        datum.contents = await contentLimitRespectedReadBytes(datum.location);
      } catch (error) {
        throw new WorkflowException(`Reading ${str(datum['location'])}\n${error}`);
      }
    }

    if (schema.secondaryFiles) {
      await this.handleSecondaryFile(schema, datum, discoverSecondaryFiles, debug);
    }

    if (schema.format) {
      await this.handleFileFormat(schema, datum);
    }
    const _capture_files = (f: File | Directory) => {
      this.files.push(f);
    };

    visitFileDirectory(datum.secondaryFiles || [], _capture_files);
  }
  async handleFileFormat(schema: CommandInputParameter, datum: File) {
    const eval_format = await this.do_eval(schema.format);
    let evaluated_format: string | string[];

    if (isString(eval_format)) {
      evaluated_format = eval_format;
    } else if (Array.isArray(eval_format)) {
      for (let index = 0; index < eval_format.length; index++) {
        const entry = eval_format[index];
        let message = '';
        if (typeof entry !== 'string') {
          message = `An expression in the 'format' field must evaluate to a string, or list of strings. However a non-string item was received: ${str(
            entry,
          )} of type ${typeof entry}. The expression was ${str(schema.format)} and its fully evaluated result is ${str(
            eval_format,
          )}.`;
        }
        if (expression.needs_parsing(entry)) {
          message = `For inputs, 'format' field can either contain a single CWL Expression or CWL Parameter Reference, a single format string, or a list of format strings. But the list cannot contain CWL Expressions or CWL Parameter References. List entry number ${
            index + 1
          } contains the following unallowed CWL Parameter Reference or Expression: ${str(entry)}.`;
        }
        if (message) {
          throw new WorkflowException(message);
        }
      }
      evaluated_format = eval_format as string[];
    } else {
      throw new WorkflowException(
        `An expression in the 'format' field must evaluate to a string, or list of strings. However the type of the expression result was ${typeof eval_format}. The expression was ${str(
          schema['format'],
        )} and its fully evaluated result is ${str(eval_format)}.`,
      );
    }
    // TODO check_format is not implemented
    try {
      await check_format(aslist(datum), evaluated_format, this.formatgraph);
    } catch (ve) {
      throw new WorkflowException(
        `Expected value of ${schema['name']} to have format ${str(schema['format'])} but\n ${ve}`,
      );
    }
  }
  async handleSecondaryFile(
    schema: CommandInputParameter,
    datum: File,
    discover_secondaryFiles: boolean,
    debug: boolean,
  ): Promise<void> {
    let sf_schema: SecondaryFileSchema[] = [];
    if (!datum.secondaryFiles) {
      datum.secondaryFiles = [];
      sf_schema = aslist(schema.secondaryFiles);
    } else if (!discover_secondaryFiles) {
      sf_schema = []; // trust the inputs
    } else {
      sf_schema = aslist(schema.secondaryFiles);
    }

    let sf_required = true;
    for (const [_num, sf_entry] of sf_schema.entries()) {
      if (sf_entry.required !== undefined) {
        const required_result = await this.do_eval(sf_entry.required, datum);
        if (!(typeof required_result === 'boolean' || required_result === null)) {
          throw new WorkflowException(
            `The result of a expression in the field 'required' must be a bool or None, not a ${typeof required_result}. Expression ${
              sf_entry.required
            } resulted in ${str(required_result)}.`,
          );
        }
        sf_required = required_result as boolean;
      }

      let sfpath: CWLOutputType;
      const pattern = sf_entry.pattern;
      if (typeof pattern === 'string') {
        if (pattern.includes('$(') || pattern.includes('${')) {
          sfpath = await this.do_eval(sf_entry.pattern, datum);
        } else {
          sfpath = substitute(datum['basename'], pattern);
        }
      }

      for (const sfname of aslist(sfpath)) {
        if (!sfname) {
          continue;
        }
        await this.handle_secondary_path(schema, datum, discover_secondaryFiles, debug, sf_entry, sf_required, sfname);
      }
    }

    normalizeFilesDirs(datum.secondaryFiles || []);
  }
  addsf(files: (File | Directory)[], newsf: File): void {
    for (const f of files) {
      if (f.location == newsf.location) {
        f.basename = newsf.basename;
        return;
      }
    }
    files.push(newsf);
  }
  async handle_secondary_path(
    schema: CommandInputParameter,
    datum: File,
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
      d_location = datum.location;
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
      if (typeof sfname === 'object') {
        this.addsf(datum.secondaryFiles ?? [], sfname);
      } else if (discover_secondaryFiles && (await this.fs_access.exists(sf_location))) {
        this.addsf(datum.secondaryFiles ?? [], {
          class: 'File',
          location: sf_location,
          basename: sfname,
        });
      } else if (sf_required) {
        throw new WorkflowException(
          `Missing required secondary file '${sfname}' from file object: ${JSON.stringify(datum, null, 4)}`,
        );
      }
    }
  }
  async handle_array(
    schema: CommandInputArraySchema,
    datum: CWLObjectType[],
    discover_secondaryFiles: boolean,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    bindeds: CommandLineBinded[],
    binded: CommandLineBinded,
    parentSchema: CommandInputParameter,
  ): Promise<CommandLineBinded> {
    for (const [n, item] of datum.entries()) {
      let b2: CommandLineBinded | undefined = undefined;
      if (binded) {
        b2 = { ...binded };
        b2.positions = binded.positions;
      }
      const itemschema: CommandInputParameter = {
        type: schema.items,
        inputBinding: b2,
        format: parentSchema.format,
        streamable: parentSchema.streamable,
        secondaryFiles: parentSchema.secondaryFiles,
      };
      const bs = await this.bind_input(itemschema, item, discover_secondaryFiles, n, tail_pos);
      bindeds.push(...bs);
    }
    return { positions: undefined };
  }
  async handle_record(
    schema: CommandInputRecordSchema,
    datum: CWLOutputType,
    discover_secondaryFiles: boolean,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    bindings: CommandLineBinded[],
  ): Promise<CWLOutputType> {
    if (datum instanceof Object) {
      for (const f of schema.fields) {
        const name = get_filed_name(f.name);
        if (name in datum && datum[name] !== null) {
          const bs = await this.bind_input(f, datum[name], discover_secondaryFiles, lead_pos, name);
          bindings.push(...bs);
        }
        //  else {
        //   datum[name] = f.default_ ?? null;
        // }
      }
    } else {
      throw new WorkflowException(`value for ${schema.name} is not Object(${datum})`);
    }
    return datum;
  }
  async handle_map(
    schema: CommandInputParameter,
    datum: CWLOutputType,
    discover_secondaryFiles: boolean,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
    bindings: CommandLineBinded[],
    binding: CommandLineBinded | undefined,
    value_from_expression: boolean,
  ) {
    if (isString(schema.type) || Array.isArray(schema.type)) {
      throw new Error('Error');
    }
    const st = schema.type;
    if (binding && !st.inputBinding && st.type === ArrayType && binding.itemSeparator === undefined) {
      st.inputBinding = new cwlTsAuto.InputBinding({});
    }
    for (const k of ['secondaryFiles', 'format', 'streamable']) {
      if (schema[k]) {
        st[k] = schema[k];
      }
    }
    if (value_from_expression) {
      await this.bind_inputObject(st, datum, discover_secondaryFiles, lead_pos, tail_pos, schema);
    } else {
      const bs = await this.bind_inputObject(st, datum, discover_secondaryFiles, lead_pos, tail_pos, schema);
      bindings.push(...bs);
    }
  }
  async handle_binding(
    schema: CommandInputParameter,
    datum: CWLOutputType,
    lead_pos: number | number[] | undefined,
    tail_pos: string | number[] | undefined,
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
              `resulted in ${str(result)}.`,
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
  tostr(value: CWLOutputType): string {
    if (isFileOrDirectory(value)) {
      if (!value.path) {
        throw new WorkflowException(`${value['class']} object missing "path": ${value}`);
      }
      return value.path;

      // TODO
      // } else if (value instanceof ScalarFloat) {
      //     let rep = new RoundTripRepresenter();
      //     let dec_value = new Decimal(rep.represent_scalar_float(value).value);
      //     if (dec_value.toString().indexOf("E") !== -1) {
      //         return dec_value.quantize(1).toString();
      //     }
      //     return dec_value.toString();
    }
    return value.toString();
  }
  async generate_arg(binding: CommandLineBinded): Promise<string[]> {
    let value = binding.datum;

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
    } else if (isFileOrDirectory(value)) {
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
    if (this.resources && this.resources['cores']) {
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
