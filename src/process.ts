/**
 * Classes and methods relevant for all CWL Process types.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import cwlTsAuto, {
  LoadListingEnum,
  enum_d9cba076fca539106791a4f46d198c7fcfbdb779 as RecordTypeEnum,
} from 'cwl-ts-auto';
import fsExtra from 'fs-extra';
import { cloneDeep } from 'lodash-es';
import { v4 } from 'uuid';
import { Builder } from './builder.js';
import { LoadingContext, RuntimeContext, getDefault } from './context.js';

import {
  CommandInputParameter,
  CommandInputRecordField,
  CommandOutputRecordField,
  Directory,
  File,
  IOType,
  Tool,
  ArrayType,
  RecordType,
  EnumType,
} from './cwltypes.js';
import { ValidationException, WorkflowException } from './errors.js';

import { needs_parsing } from './expression.js';
import { isdir, isfile, removeIgnorePermissionError, removeSyncIgnorePermissionError } from './fileutils.js';
import { FormatGraph } from './formatgraph.js';
import { _logger } from './loghandler.js';

import { convertDictToFileDirectory } from './main.js';
import { MapperEnt, PathMapper } from './pathmapper.js';
import { SecretStore } from './secrets.js';
import { LazyStaging } from './staging.js';
import { StdFsAccess } from './stdfsaccess.js';

import { compareInputBinding, CommandLineBinded, type ToolRequirement } from './types.js';
import {
  type CWLObjectType,
  type CWLOutputType,
  type JobsGeneratorType,
  type OutputCallbackType,
  aslist,
  get_listing,
  normalizeFilesDirs,
  random_outdir,
  getRequirement,
  adjustDirObjs,
  uriFilePath,
  fileUri,
  ensureWritable,
  isString,
  visitFileDirectory,
  visitFile,
  isFile,
} from './utils.js';
import { validate } from './validate.js';

export function shortname(inputid: string): string {
  try {
    const parsedUrl = new URL(inputid);
    if (parsedUrl.hash) {
      const sn = parsedUrl.hash.split('/').pop();
      if (sn.startsWith('#')) {
        return sn.substring(1);
      } else {
        return sn;
      }
    }
    return parsedUrl.pathname.split('/').pop() || '';
  } catch {
    return inputid.split('/').pop();
  }
}
interface StageFilesOptions {
  ignore_writable?: boolean;
  symlink?: boolean;
  fix_conflicts?: boolean;
  secret_store?: SecretStore;
}
export function stage_files_for_outputs(
  pathmapper: PathMapper,
  stage_func?: (src: string, dest: string) => void,
  { ignore_writable = false, symlink = true, fix_conflicts = false }: StageFilesOptions = {},
): void {
  let items: [string, MapperEnt][] = symlink ? pathmapper.items_exclude_children() : pathmapper.items();
  const targets: { [key: string]: MapperEnt } = {};

  for (const [key, entry] of items) {
    if (!entry.type.includes('File')) continue;
    if (!targets[entry.target]) {
      targets[entry.target] = entry;
    } else if (targets[entry.target].resolved !== entry.resolved) {
      if (fix_conflicts) {
        let i = 2;
        let tgt = `${entry.target}_${i}`;
        while (targets[tgt]) {
          i++;
          tgt = `${entry.target}_${i}`;
        }
        targets[tgt] = pathmapper.update(key, entry.resolved, tgt, entry.type, entry.staged);
      } else {
        throw new Error(
          `File staging conflict, trying to stage both ${targets[entry.target].resolved} and ${
            entry.resolved
          } to the same target ${entry.target}`,
        );
      }
    }
  }

  items = symlink ? pathmapper.items_exclude_children() : pathmapper.items();

  for (const [key, entry] of items) {
    if (!entry.staged) continue;

    const targetDir = path.dirname(entry.target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    if ((entry.type === 'File' || entry.type === 'Directory') && fs.existsSync(entry.resolved)) {
      if (symlink) {
        fs.symlinkSync(entry.resolved, entry.target);
      } else if (stage_func) {
        stage_func(entry.resolved, entry.target);
      }
    } else if (entry.type === 'Directory' && !fs.existsSync(entry.target) && entry.resolved.startsWith('_:')) {
      fs.mkdirSync(entry.target, { recursive: true });
    } else if (entry.type === 'WritableFile' && !ignore_writable) {
      fs.copyFileSync(entry.resolved, entry.target);
      ensureWritable(entry.target);
    } else if (entry.type === 'WritableDirectory' && !ignore_writable) {
      if (entry.resolved.startsWith('_:')) {
        fs.mkdirSync(entry.target, { recursive: true });
      } else {
        fsExtra.copySync(entry.resolved, entry.target);
        ensureWritable(entry.target, true);
      }
    } else if (entry.type === 'CreateFile' || entry.type === 'CreateWritableFile') {
      const content = entry.resolved;
      fs.writeFileSync(entry.target, content, { mode: entry.type === 'CreateFile' ? 0o400 : 0o600 });
      if (entry.type === 'CreateWritableFile') {
        ensureWritable(entry.target);
      }
      pathmapper.update(key, entry.target, entry.target, entry.type, entry.staged);
    }
  }
}

export function stage_files(
  staging: LazyStaging,
  pathmapper: PathMapper,
  stage_func?: (src: string, dest: string) => void,
  { ignore_writable = false, symlink = true, fix_conflicts = false }: StageFilesOptions = {},
): void {
  let items: [string, MapperEnt][] = symlink ? pathmapper.items_exclude_children() : pathmapper.items();
  const targets: { [key: string]: MapperEnt } = {};

  for (const [key, entry] of items) {
    if (!entry.type.includes('File')) continue;
    if (!targets[entry.target]) {
      targets[entry.target] = entry;
    } else if (targets[entry.target].resolved !== entry.resolved) {
      if (fix_conflicts) {
        let i = 2;
        let tgt = `${entry.target}_${i}`;
        while (targets[tgt]) {
          i++;
          tgt = `${entry.target}_${i}`;
        }
        targets[tgt] = pathmapper.update(key, entry.resolved, tgt, entry.type, entry.staged);
      } else {
        throw new Error(
          `File staging conflict, trying to stage both ${targets[entry.target].resolved} and ${
            entry.resolved
          } to the same target ${entry.target}`,
        );
      }
    }
  }

  items = symlink ? pathmapper.items_exclude_children() : pathmapper.items();

  for (const [key, entry] of items) {
    if (!entry.staged) continue;

    const targetDir = path.dirname(entry.target);
    staging.mkdirSync(targetDir, true);
    if (entry.type === 'File' || entry.type === 'Directory') {
      if (symlink) {
        staging.symlinkSync(entry.resolved, entry.target);
      } else if (stage_func) {
        stage_func(entry.resolved, entry.target);
      }
    } else if (entry.type === 'Directory' && entry.resolved.startsWith('_:')) {
      staging.mkdirSync(entry.target, true);
    } else if (entry.type === 'WritableFile' && !ignore_writable) {
      staging.copyFileSync(entry.resolved, entry.target, { ensureWritable: true });
    } else if (entry.type === 'WritableDirectory' && !ignore_writable) {
      if (entry.resolved.startsWith('_:')) {
        staging.mkdirSync(entry.target, true);
      } else {
        staging.copyFileSync(entry.resolved, entry.target, { ensureWritable: true });
      }
    } else if (entry.type === 'CreateFile' || entry.type === 'CreateWritableFile') {
      const content = entry.resolved;
      staging.writeFileSync(entry.target, content, entry.type === 'CreateFile' ? 0o400 : 0o600, {
        ensureWritable: entry.type === 'CreateWritableFile',
      });
      pathmapper.update(key, entry.target, entry.target, entry.type, entry.staged);
    }
  }
}
function commonPrefix(paths: string[]): string {
  if (paths.length === 0) return '';

  const sortedPaths = paths.slice().sort();
  const firstPath = sortedPaths[0];
  const lastPath = sortedPaths[sortedPaths.length - 1];

  for (let i = 0; i < firstPath.length; i++) {
    if (firstPath[i] !== lastPath[i]) {
      return firstPath.substring(0, i);
    }
  }

  return firstPath;
}
class DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  constructor(name: string, path: string, isDir: boolean) {
    this.name = name;
    this.path = path;
    this.isDir = isDir;
  }
}
function scandir(dir: string): DirEntry[] {
  const entries = fs.readdirSync(dir);
  return entries.map((entry) => {
    const entryPath = path.join(dir, entry);
    const stat = fs.statSync(entryPath);
    return new DirEntry(entry, entryPath, stat.isDirectory());
  });
}
export async function relocateOutputs(
  outputObj: CWLObjectType,
  destination_path: string,
  source_directories: Set<string>,
  action: string,
  fs_access: StdFsAccess,
  compute_checksum = true,
): Promise<CWLObjectType> {
  adjustDirObjs(outputObj, (val) => get_listing(fs_access, val, true));

  if (!['move', 'copy'].includes(action)) {
    return outputObj;
  }

  function _relocate(src: string, dst: string): void {
    src = fs_access.realpath(src);
    dst = fs_access.realpath(dst);

    if (src === dst) {
      return;
    }

    let src_can_deleted = false;
    for (const p of source_directories) {
      const common = commonPrefix([p, src]);
      if (common === p) {
        src_can_deleted = true;
      }
    }

    const _action = action === 'move' && src_can_deleted ? 'move' : 'copy';
    if (_action === 'move') {
      _logger.debug(`Moving ${src} to ${dst}`);
      if (fs_access.isdir(src) && fs_access.isdir(dst)) {
        for (const dir_entry of scandir(src)) {
          _relocate(dir_entry.path, fs_access.join(dst, dir_entry.name));
        }
      } else {
        fsExtra.moveSync(src, dst, { overwrite: true });
      }
    } else if (_action === 'copy') {
      _logger.debug(`Copying ${src} to ${dst}`);
      if (fs_access.isdir(src)) {
        if (isdir(dst)) {
          removeSyncIgnorePermissionError(dst);
        } else if (isfile(dst)) {
          fs.unlinkSync(dst);
        }
        fsExtra.copySync(src, dst, { overwrite: true });
      } else {
        fsExtra.copySync(src, dst, { preserveTimestamps: true, overwrite: true });
      }
    }
  }

  function _realpath(ob: Directory | File): void {
    const location = ob.location;
    if (location.startsWith('file:')) {
      ob.location = fileUri(fs.realpathSync(uriFilePath(location)));
    } else if (location.startsWith('/')) {
      ob.location = fs.realpathSync(location);
    } else if (!location.startsWith('_:') && location.includes(':')) {
      ob.location = fileUri(fs_access.realpath(location));
    }
  }
  const outfiles: (File | Directory)[] = [];
  visitFileDirectory(outputObj, (v) => outfiles.push(v));
  visitFileDirectory(outfiles, _realpath);
  const pm = new PathMapper(outfiles, '', destination_path, false);
  stage_files_for_outputs(pm, _relocate, { symlink: false, fix_conflicts: true });

  function _check_adjust(a_file: File | Directory): void {
    a_file.location = fileUri(pm.mapper(a_file.location)?.target ?? '');
    if (a_file['contents']) {
      a_file['contents'] = undefined;
    }
  }

  visitFileDirectory(outputObj, _check_adjust);

  if (compute_checksum) {
    const promises: Promise<void>[] = [];
    visitFile(outputObj, (vals) => promises.push(compute_checksums(fs_access, vals)));
    await Promise.all(promises);
  }
  return outputObj;
}
export async function cleanIntermediate(output_dirs: Iterable<string>): Promise<void> {
  for (const a of output_dirs) {
    if (fs.existsSync(a)) {
      _logger.debug(`Removing intermediate output directory ${a}`);
      await removeIgnorePermissionError(a);
    }
  }
}

export function add_sizes(fsaccess: StdFsAccess, obj: File): void {
  if (obj.location) {
    try {
      if (!obj.size) {
        obj.size = fsaccess.size(String(obj.location));
      }
    } catch {}
  } else if (obj.contents) {
    obj.size = obj.contents.length;
  }
  // best effort
}
function fill_in_defaults(inputs: CommandInputParameter[], job: CWLObjectType): void {
  for (let e = 0; e < inputs.length; e++) {
    const inp = inputs[e];
    const fieldname = shortname(inp.id);
    if (job[fieldname] != null) {
      continue;
    } else if (job[fieldname] == null && inp.default_ !== undefined) {
      job[fieldname] = cloneDeep(inp.default_);
    } else if (job[fieldname] == null && aslist(inp.type).includes('null')) {
      job[fieldname] = null;
    } else {
      throw new WorkflowException(`Missing required input parameter '${fieldname}'`);
    }
  }
}
function avroizeType(fieldType: IOType | null, namePrefix = '') {
  if (Array.isArray(fieldType)) {
    for (let i = 0; i < fieldType.length; i++) {
      avroizeType(fieldType[i], namePrefix);
    }
  } else if (fieldType instanceof Object) {
    const fieldTypeName = fieldType['type'];
    if (fieldTypeName === EnumType || fieldTypeName === RecordType) {
      if (!('name' in fieldType)) {
        const r = v4();
        // eslint-disable-next-line
        fieldType['name'] = namePrefix + r;
      }
    }

    if (fieldType.type === RecordType) {
      for (const field of fieldType.fields) {
        avroizeType(field.type, namePrefix);
      }
    } else if (fieldType.type === ArrayType) {
      avroizeType(fieldType.items, namePrefix);
    }
  }
}

const _VAR_SPOOL_ERROR = `
    Non-portable reference to /var/spool/cwl detected: '{}'.
    To fix, replace /var/spool/cwl with $(runtime.outdir) or add
    DockerRequirement to the 'requirements' section and declare
    'dockerOutputDirectory: /var/spool/cwl'.
`;

function var_spool_cwl_detector(obj: unknown, _item: unknown = null, obj_key: unknown = null): boolean {
  let r = false;
  if (typeof obj === 'string') {
    if (obj.includes('var/spool/cwl') && obj_key != 'dockerOutputDirectory') {
      _logger.warn(new Error(_VAR_SPOOL_ERROR.replace('{}', obj)));
      r = true;
    }
  } else if (obj instanceof Object) {
    for (const [mkey, mvalue] of Object.entries(obj)) {
      r = var_spool_cwl_detector(mvalue as CWLOutputType, obj, mkey) || r;
    }
  } else if (obj instanceof Array) {
    for (const [lkey, lvalue] of obj.entries()) {
      r = var_spool_cwl_detector(lvalue as CWLOutputType, obj, lkey) || r;
    }
  }
  return r;
}

async function eval_resource(builder: Builder, resource_req: string | number): Promise<string | number | null> {
  if (typeof resource_req === 'string' && needs_parsing(resource_req)) {
    const result = await builder.do_eval(resource_req);
    if (typeof result === 'number' && !Number.isInteger(result)) {
      throw new WorkflowException(
        `Floats are not valid in resource requirement expressions prior 
                 to CWL v1.2: ${resource_req} returned ${result}.`,
      );
    }
    if (typeof result === 'string' || typeof result === 'number' || result === null) {
      return result as string | number | null;
    }
    throw new WorkflowException(
      `Got incorrect return type ${typeof result} from resource expression evaluation of ${resource_req}.`,
    );
  }
  return resource_req;
}
// Threshold where the "too many files" warning kicks in
const FILE_COUNT_WARNING = 5000;
export abstract class Process {
  metadata: CWLObjectType;
  tool: Tool;
  requirements: ToolRequirement = [];
  hints: ToolRequirement = [];
  original_requirements: ToolRequirement;
  original_hints: ToolRequirement;
  formatgraph: FormatGraph;
  schemaDefs: {
    [key: string]:
      | cwlTsAuto.CommandInputArraySchema
      | cwlTsAuto.CommandInputEnumSchema
      | cwlTsAuto.CommandInputRecordSchema;
  };
  inputs_record_schema: { name: string; type: { type: RecordTypeEnum; fields: CommandInputRecordField[] } };
  outputs_record_schema: { name: string; type: { type: RecordTypeEnum; fields: CommandOutputRecordField[] } };
  container_engine: 'docker' | 'podman' | 'singularity';
  constructor(toolpath_object: Tool) {
    this.tool = toolpath_object;
  }
  init(loadingContext: LoadingContext) {
    this.metadata = getDefault(loadingContext.metadata, {});

    this.requirements = getDefault(loadingContext.requirements, []);
    const tool_requirements = this.tool.requirements || [];

    if (tool_requirements === undefined) {
      throw new ValidationException(
        "If 'requirements' is present then it must be a list or map/dictionary, not empty.",
      );
    }

    this.requirements = this.requirements.concat(tool_requirements);

    if (!this.tool.id) {
      this.tool['id'] = `_:${v4()}`;
    }

    this.hints = [...getDefault(loadingContext.hints, [])];
    const tool_hints = this.tool.hints || [];

    if (tool_hints === null) {
      throw new ValidationException("If 'hints' is present then it must be a list or map/dictionary, not empty.");
    }

    this.hints.push(...tool_hints);
    this.original_requirements = this.requirements;
    this.original_hints = this.hints;
    if (loadingContext.formatGraph) {
      this.formatgraph = loadingContext.formatGraph;
    }

    // this.checkRequirements(this.tool as any, supportedProcessRequirements);
    // this.validate_hints(undefined, this.tool['hints'] || [], getDefault(loadingContext.strict, false));

    this.schemaDefs = {};

    const [sd, _] = getRequirement(this, cwlTsAuto.SchemaDefRequirement);

    if (sd) {
      const sdtypes = sd.types;
      avroizeType(sdtypes);
      for (const t of sdtypes) {
        this.schemaDefs[t.name] = t;
      }
    }
    // Build record schema from inputs

    this.inputs_record_schema = {
      name: 'inputs_record_schema',
      type: {
        type: RecordType,
        fields: [],
      },
    };
    this.outputs_record_schema = {
      name: 'outputs_record_schema',
      type: {
        type: RecordType,
        fields: [],
      },
    };

    for (const i of this.tool.inputs) {
      const c = cloneDeep(i);
      if (!c.type) {
        throw new Error(`Missing 'type' in parameter '${c.name}'`);
      }

      if (c.default_ && !aslist(c.type).includes('null')) {
        const nullable: IOType = ['null'];
        nullable.push(...aslist(c.type));
        c.type = nullable;
      }

      avroizeType(c.type, c.name);
      this.inputs_record_schema.type.fields.push(c as CommandInputRecordField);
    }
    for (const i of this.tool.outputs) {
      const c = cloneDeep(i);
      if (!c.type) {
        throw new Error(`Missing 'type' in parameter '${c.name}'`);
      }

      avroizeType(c.type, c.name);

      this.outputs_record_schema.type.fields.push(c as CommandOutputRecordField);
    }
    this.container_engine = 'docker';
    if (loadingContext.podman) {
      this.container_engine = 'podman';
    } else if (loadingContext.singularity) {
      this.container_engine = 'singularity';
    }

    const [dockerReq, is_req] = getRequirement(this, cwlTsAuto.DockerRequirement);

    if (dockerReq && dockerReq.dockerOutputDirectory && is_req) {
      _logger.warn(
        "When 'dockerOutputDirectory' is declared, DockerRequirement should go in the 'requirements' section, not 'hints'.",
      );
    }

    if (dockerReq && is_req !== undefined && dockerReq.dockerOutputDirectory === '/var/spool/cwl') {
      if (is_req) {
        // In this specific case, it is legal to have /var/spool/cwl, so skip the check.
      } else {
        // Must be a requirement
        var_spool_cwl_detector(this.tool);
      }
    } else {
      var_spool_cwl_detector(this.tool);
    }
  }
  getRequirement<T>(cls: new (any) => T): [T | undefined, boolean] {
    if (this.requirements) {
      const req = this.requirements.find((item) => item instanceof cls);
      if (req) {
        return [req as T, true];
      }
    }
    if (this.hints) {
      const req = this.hints.find((item) => item['class'] === cls.name);

      if (req) {
        // eslint-disable-next-line new-cap
        return [new cls(req), false];
      }
    }
    return [undefined, false];
  }
  // Remaining code skipped as it involves missing functions or types. The conversion follows the same pattern.
  async _init_job(joborder: CWLObjectType, runtime_context: RuntimeContext): Promise<Builder> {
    const job = { ...joborder };

    const fs_access = new StdFsAccess(runtime_context.basedir);

    const [load_listing_req] = getRequirement(this.tool, cwlTsAuto.LoadListingRequirement);

    const load_listing = load_listing_req != null ? load_listing_req.loadListing : cwlTsAuto.LoadListingEnum.NO_LISTING;
    // Validate job order
    try {
      fill_in_defaults(this.tool.inputs, job);
      convertDictToFileDirectory(job);
      normalizeFilesDirs(job);
      const schema = this.inputs_record_schema;
      if (schema == null) {
        throw new WorkflowException(`Missing input record schema`);
      }
      validate(schema.type, job, false);

      if (load_listing != cwlTsAuto.LoadListingEnum.NO_LISTING) {
        get_listing(fs_access, job, load_listing === LoadListingEnum.DEEP_LISTING);
      }

      visitFile(job, (x): void => add_sizes(fs_access, x));

      if (load_listing == LoadListingEnum.DEEP_LISTING) {
        this.tool.inputs.forEach((inparm) => {
          const k = shortname(inparm.id);
          if (!(k in job)) {
            return;
          }
          const v = job[k];
          let dircount = 0;
          let filecount = 0;

          visitFileDirectory(v, (x) => (isFile(x) ? filecount++ : dircount++));
          if (dircount == 0) {
            return;
          }
          if (filecount[0] > FILE_COUNT_WARNING) {
            _logger.warn(`Recursive directory listing has resulted in a large number of File objects (${filecount[0]}) passed to the input parameter '${k}'.  This may negatively affect workflow performance and memory use.

If this is a problem, use the hint 'cwltool:LoadListingRequirement' with "shallow_listing" or "no_listing" to change the directory listing behavior:

$namespaces:
  cwltool: "http://commonwl.org/cwltool#"
hints:
  cwltool:LoadListingRequirement:
    loadListing: shallow_listing
`);
          }
        });
      }
    } catch (err) {
      if (err instanceof ValidationException || err instanceof WorkflowException) {
        throw err;
      } else {
        throw err;
      }
    }

    const files: (File | Directory)[] = [];
    const bindings: CommandLineBinded[] = [];
    let outdir = '';
    let tmpdir = '';
    let stagedir = '';

    const [docker_req] = getRequirement(this.tool, cwlTsAuto.DockerRequirement);
    let default_docker: string | undefined = undefined;

    if (docker_req == null && runtime_context.default_container) {
      default_docker = runtime_context.default_container;
    }

    if ((docker_req || default_docker) && runtime_context.use_container) {
      if (docker_req != null) {
        const dockerOutputDirectory = docker_req['dockerOutputDirectory'];
        if (
          dockerOutputDirectory &&
          typeof dockerOutputDirectory === 'string' &&
          dockerOutputDirectory.startsWith('/')
        ) {
          outdir = dockerOutputDirectory;
        } else {
          outdir = String(dockerOutputDirectory || runtime_context.docker_outdir || random_outdir());
        }
      } else if (default_docker != null) {
        outdir = runtime_context.docker_outdir || random_outdir();
      }
      tmpdir = runtime_context.docker_tmpdir || '/tmp';
      stagedir = runtime_context.docker_stagedir || '/var/lib/cwl';
    } else {
      if (this.tool instanceof cwlTsAuto.CommandLineTool) {
        outdir = fs_access.realpath(runtime_context.getOutdir());
        tmpdir = fs_access.realpath(runtime_context.getTmpdir());
        stagedir = fs_access.realpath(runtime_context.getStagedir());
      }
    }
    // let cwl_version: string = <string> this.metadata[];
    const builder: Builder = new Builder(
      job,
      files,
      bindings,
      this.schemaDefs,
      this.requirements,
      this.hints,
      {},
      this.formatgraph,
      StdFsAccess,
      fs_access,
      runtime_context.eval_timeout,
      runtime_context.debug,
      runtime_context.js_console,
      runtime_context.force_docker_pull,
      load_listing,
      outdir,
      tmpdir,
      stagedir,
      'unknown',
      this.container_engine,
    );
    const bs = await builder.bind_input(this.inputs_record_schema, job, runtime_context.toplevel ?? false);
    bindings.push(...bs);

    if (this.tool.baseCommand) {
      aslist(this.tool.baseCommand).forEach((command, index) => {
        bindings.push({ positions: [-1000000, index], datum: command });
      });
    }

    if (this.tool.arguments_) {
      for (let i = 0; i < this.tool.arguments_.length; i++) {
        const arg = this.tool.arguments_[i];
        if (isString(arg)) {
          if (arg.includes('$(') || arg.includes('${')) {
            const cm = {
              positions: [0, i],
              valueFrom: arg,
            };
            bindings.push(cm);
          } else {
            const cm = {
              positions: [0, i],
              datum: arg,
            };
            bindings.push(cm);
          }
        } else {
          const arg2 = CommandLineBinded.fromBinding(arg);
          if (arg.position) {
            let position = arg.position;
            if (typeof position === 'string') {
              position = (await builder.do_eval(position)) as number;
              if (!position) {
                position = 0;
              }
            }
            arg2.positions = [position, i];
          } else {
            arg2.positions = [0, i];
          }
          bindings.push(arg2);
        }
      }
    }

    bindings.sort(compareInputBinding);

    if (this.tool['class'] !== 'Workflow') {
      builder.resources = await this.evalResources(builder, runtime_context);
    }
    return builder;
  }
  async evalResources(builder: Builder, runtimeContext: RuntimeContext): Promise<{ [key: string]: number }> {
    let [resourceReq] = getRequirement(this.tool, cwlTsAuto.ResourceRequirement);

    if (resourceReq === undefined) {
      resourceReq = new cwlTsAuto.ResourceRequirement({});
    }

    const ram = 256;

    const request: { [key: string]: number } = {
      coresMin: 1,
      coresMax: 1,
      ramMin: ram,
      ramMax: ram,
      tmpdirMin: 1024,
      tmpdirMax: 1024,
      outdirMin: 1024,
      outdirMax: 1024,
    };

    const rsca: string[] = ['cores', 'ram', 'tmpdir', 'outdir'];
    for (const rsc of rsca) {
      let mn: string | number | null = null;
      let mx: string | number | null = null;
      if (resourceReq[`${rsc}Min`]) {
        mn = await eval_resource(builder, resourceReq[`${rsc}Min`]);
      }
      if (resourceReq[`${rsc}Max`]) {
        mx = await eval_resource(builder, resourceReq[`${rsc}Max`]);
      }
      if (mn === null) {
        mn = mx;
      } else if (mx === null) {
        mx = mn;
      }

      if (mn !== null) {
        if (typeof mn === 'string') {
          throw new ValidationException(`${rsc}Min must be a number, not a string`);
        }
        if (typeof mx === 'string') {
          throw new ValidationException(`${rsc}Max must be a number, not a string`);
        }
        request[`${rsc}Min`] = mn;
        request[`${rsc}Max`] = mx;
      }
    }

    const request_evaluated = request;
    if (runtimeContext.select_resources !== undefined) {
      return runtimeContext.select_resources(request_evaluated, runtimeContext);
    }

    const defaultReq: { [key: string]: number } = {
      cores: request_evaluated['coresMin'],
      ram: Math.ceil(request_evaluated['ramMin']),
      tmpdirSize: Math.ceil(request_evaluated['tmpdirMin']),
      outdirSize: Math.ceil(request_evaluated['outdirMin']),
    };

    return defaultReq;
  }

  abstract job(
    job_order: CWLObjectType,
    output_callbacks: OutputCallbackType | null,
    runtimeContext: RuntimeContext,
  ): JobsGeneratorType;

  toString(): string {
    // eslint-disable-next-line
    return `${this.constructor.name}: ${this.tool['id']}`;
  }
}
const _names: Set<string> = new Set();
export function uniquename(stem: string, names?: Set<string>): string {
  if (!names) {
    names = _names;
  }
  let c = 1;
  let u = stem;
  while (names.has(u)) {
    c += 1;
    u = `${stem}_${c}`;
  }
  names.add(u);
  return u;
}

export async function compute_checksums(fsAccess: StdFsAccess, fileobj: File): Promise<void> {
  if (!fileobj.checksum) {
    const checksum = crypto.createHash('sha1');
    const location = fileobj.location;

    const fileHandle = await fsAccess.open(location, 'r');
    let contents = await fileHandle.readFile();

    while (contents.length > 0) {
      checksum.update(contents);
      contents = await fileHandle.readFile();
    }

    await fileHandle.close();

    // eslint-disable-next-line require-atomic-updates
    fileobj.checksum = `sha1$${checksum.digest('hex')}`;
    // eslint-disable-next-line require-atomic-updates
    fileobj.size = fsAccess.size(location);
  }
}
