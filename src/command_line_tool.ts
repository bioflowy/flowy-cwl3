import * as path from 'node:path';
import cwlTsAuto, { DockerRequirement, InplaceUpdateRequirement, WorkReuse } from 'cwl-ts-auto';
import { Builder, contentLimitRespectedRead, substitute } from './builder.js';
import { LoadingContext, RuntimeContext, getDefault } from './context.js';
import { DockerCommandLineJob, PodmanCommandLineJob } from './docker.js';
import { UnsupportedRequirement, ValidationException, WorkflowException } from './errors.js';
import { CommandLineJob, JobBase } from './job.js';
import { _logger } from './loghandler.js';
import { PathMapper } from './pathmapper.js';
import { Process, compute_checksums, shortname, uniquename } from './process.js';
import { StdFsAccess } from './stdfsaccess.js';
import type { CommandOutputParameter, Tool } from './types.js';
import {
  type CWLObjectType,
  type CWLOutputType,
  type JobsGeneratorType,
  type MutableMapping,
  type OutputCallbackType,
  adjustFileObjs,
  aslist,
  fileUri,
  get_listing,
  isString,
  normalizeFilesDirs,
  quote,
  splitext,
  uriFilePath,
  visit_class,
  getRequirement,
  type JobsType,
} from './utils.js';
class PathCheckingMode {
  static STRICT = new RegExp('^[w.+,-:@]^\u2600-\u26FFU0001f600-U0001f64f]+$');
  static RELAXED = new RegExp('.*');
}
export class ExpressionJob {
  builder: Builder;
  script: string;
  output_callback: OutputCallbackType | null;
  requirements: CWLObjectType[];
  hints: CWLObjectType[];
  outdir: string | null;
  tmpdir: string | null;
  prov_obj: any | null;

  constructor(
    builder: Builder,
    script: string,
    output_callback: OutputCallbackType | null,
    requirements: CWLObjectType[],
    hints: CWLObjectType[],
    outdir: string | null = null,
    tmpdir: string | null = null,
  ) {
    this.builder = builder;
    this.requirements = requirements;
    this.hints = hints;
    this.output_callback = output_callback;
    this.outdir = outdir;
    this.tmpdir = tmpdir;
    this.script = script;
    this.prov_obj = null;
  }

  async run(runtimeContext: RuntimeContext, tmpdir_lock: any | null = null) {
    try {
      normalizeFilesDirs(this.builder.job);
      const ev = await this.builder.do_eval(this.script);
      normalizeFilesDirs(ev as any);

      if (this.output_callback) {
        this.output_callback(ev as CWLObjectType, 'success');
      }
    } catch (err: any) {
      _logger.warn('Failed to evaluate expression:\n%s', err.toString(), { exc_info: runtimeContext.debug });

      if (this.output_callback) {
        this.output_callback({}, 'permanentFail');
      }
    }
  }
}
export class ExpressionTool extends Process {
  declare tool: cwlTsAuto.ExpressionTool;
  constructor(tool: cwlTsAuto.ExpressionTool, loadingContext: LoadingContext) {
    super(tool, loadingContext);
    this.tool = tool;
  }
  async *job(
    job_order: CWLObjectType,
    output_callbacks: OutputCallbackType | null,
    runtimeContext: RuntimeContext,
  ): JobsGeneratorType {
    const builder = await this._init_job(job_order, runtimeContext);
    const job = new ExpressionJob(builder, this.tool['expression'], output_callbacks, this.requirements, this.hints);
    job.prov_obj = runtimeContext.prov_obj;
    yield job;
  }
}

function remove_path(f: CWLObjectType): void {
  if ('path' in f) {
    delete f['path'];
  }
}
function revmap_file(builder: Builder, outdir: string, f: CWLObjectType): CWLObjectType | null {
  if (outdir.startsWith('/')) {
    outdir = fileUri(outdir);
  }
  if (f.hasOwnProperty('location') && !f.hasOwnProperty('path')) {
    const location: string = f['location'] as string;
    if (location.startsWith('file://')) {
      f['path'] = uriFilePath(location);
    } else {
      f['location'] = builder.fs_access.join(outdir, f['location'] as string);
      return f;
    }
  }
  if (f.hasOwnProperty('dirname')) {
    delete f['dirname'];
  }
  if (f.hasOwnProperty('path')) {
    const path1 = builder.fs_access.join(builder.outdir, f['path'] as string);
    const uripath = fileUri(path1);
    delete f['path'];
    if (!f.hasOwnProperty('basename')) {
      f['basename'] = path.basename(path1);
    }
    if (!builder.pathmapper) {
      throw new Error("Do not call revmap_file using a builder that doesn't have a pathmapper.");
    }
    const revmap_f = builder.pathmapper.reversemap(path1);
    if (revmap_f && !builder.pathmapper.mapper(revmap_f[0]).type.startsWith('Writable')) {
      f['location'] = revmap_f[1];
    } else if (uripath == outdir || uripath.startsWith(outdir + path.sep) || uripath.startsWith(`${outdir}/`)) {
      f['location'] = uripath;
    } else if (
      path1 == builder.outdir ||
      path1.startsWith(builder.outdir + path.sep) ||
      path1.startsWith(`${builder.outdir}/`)
    ) {
      const joined_path = builder.fs_access.join(
        outdir,
        encodeURIComponent(path1.substring(builder.outdir.length + 1)),
      );
      f['location'] = joined_path;
    } else {
      throw new WorkflowException(
        `Output file path ${path1} must be within designated output directory ${builder.outdir} or an input file pass through.`,
      );
    }
    return f;
  }
  throw new WorkflowException(`Output File object is missing both 'location' and 'path' fields: ${f}`);
}
function make_path_mapper(
  reffiles: CWLObjectType[],
  stagedir: string,
  runtimeContext: RuntimeContext,
  separateDirs: boolean,
): PathMapper {
  return new PathMapper(reffiles, runtimeContext.basedir, stagedir, separateDirs);
}

export class CallbackJob {
  job: any;
  output_callback: any | null;
  cachebuilder: any;
  outdir: string;
  prov_obj: any | null;

  constructor(job: any, output_callback: any | null, cachebuilder: any, jobcache: string) {
    this.job = job;
    this.output_callback = output_callback;
    this.cachebuilder = cachebuilder;
    this.outdir = jobcache;
    this.prov_obj = null;
  }

  run(runtimeContext: any, tmpdir_lock: any | null = null): void {
    if (this.output_callback) {
      this.output_callback(
        this.job.collect_output_ports(
          this.job.tool['outputs'],
          this.cachebuilder,
          this.outdir,
          runtimeContext.compute_checksum != null ? runtimeContext.compute_checksum : true,
        ),
        'success',
      );
    }
  }
}
function checkAdjust(acceptRe: any, builder: Builder, fileO: CWLObjectType): CWLObjectType {
  if (!builder.pathmapper) {
    throw new Error("Do not call check_adjust using a builder that doesn't have a pathmapper.");
  }
  const path1 = builder.pathmapper.mapper(fileO['location'] as string).target;
  fileO['path'] = path1;
  let basename = fileO['basename'];
  const dn = path.dirname(path1);
  const bn = path.basename(path1);
  if (fileO['dirname'] !== dn) {
    fileO['dirname'] = dn.toString();
  }
  if (basename !== bn) {
    fileO['basename'] = basename = bn.toString();
  }
  if (fileO['class'] === 'File') {
    const ne = path.extname(basename);
    const nr = path.basename(basename, ne);
    if (fileO['nameroot'] !== nr) {
      fileO['nameroot'] = nr.toString();
    }
    if (fileO['nameext'] !== ne) {
      fileO['nameext'] = ne.toString();
    }
  }
  // TODO
  // if (!acceptRe.test(basename)) {
  //     throw new Error(
  //         `Invalid filename: ${fileO['basename']} contains illegal characters`
  //     );
  // }
  return fileO;
}

function checkValidLocations(fsAccess: StdFsAccess, ob: CWLObjectType): void {
  const location = ob['location'] as string;
  if (location.startsWith('_:')) {
    return;
  }
  if (ob['class'] === 'File' && !fsAccess.isfile(location)) {
    throw new Error(`Does not exist or is not a File: '${location}'`);
  }
  if (ob['class'] === 'Directory' && !fsAccess.isdir(location)) {
    throw new Error(`Does not exist or is not a Directory: '${location}'`);
  }
}

interface OutputPortsType {
  [key: string]: CWLOutputType | undefined;
}

class ParameterOutputWorkflowException extends WorkflowException {
  constructor(msg: string, port: CWLObjectType, kwargs: any) {
    super(`Error collecting output for parameter '${port['id']}': ${msg}`);
  }
}
const MPIRequirementName = 'http://commonwl.org/cwltool#MPIRequirement';
export class CommandLineTool extends Process {
  declare tool: cwlTsAuto.CommandLineTool;
  prov_obj: any; // placeholder type
  path_check_mode: any; // placeholder type

  constructor(toolpath_object: cwlTsAuto.CommandLineTool, loadingContext: any) {
    // placeholder types
    super(toolpath_object, loadingContext);
    this.tool = toolpath_object;
    this.prov_obj = loadingContext.prov_obj;
    this.path_check_mode = loadingContext.relax_path_checks ? PathCheckingMode.RELAXED : PathCheckingMode.STRICT;
  }

  make_job_runner(
    runtimeContext: RuntimeContext,
  ): (
    builder: Builder,
    joborder: CWLObjectType,
    make_path_mapper: (param1: CWLObjectType[], param2: string, param3: RuntimeContext, param4: boolean) => PathMapper,
    tool: Tool,
    name: string,
  ) => JobBase {
    // placeholder types
    let [dockerReq, dockerRequired] = getRequirement(this.tool, cwlTsAuto.DockerRequirement);
    if (!dockerReq && runtimeContext.use_container) {
      if (runtimeContext.find_default_container) {
        const default_container = runtimeContext.find_default_container(this);
        if (default_container) {
          dockerReq = new cwlTsAuto.DockerRequirement({
            dockerPull: default_container,
          });
          this.requirements.unshift(dockerReq);
          dockerRequired = true;
        }
      }
    }
    if (dockerReq && runtimeContext.use_container) {
      // if(runtimeContext.singularity){
      //     return SingularityCommandLineJob
      // }else if(runtimeContext.user_space_docker_cmd){
      //     return UDockerCommandLineJob
      // }
      if (runtimeContext.podman) {
        return (builder, joborder, make_path_mapper, tool, name) =>
          new PodmanCommandLineJob(builder, joborder, make_path_mapper, tool, name);
      }
      return (builder, joborder, make_path_mapper, tool, name) =>
        new DockerCommandLineJob(builder, joborder, make_path_mapper, tool, name);
    }
    if (dockerRequired)
      throw new UnsupportedRequirement(
        '--no-container, but this CommandLineTool has ' + "DockerRequirement under 'requirements'.",
      );
    return (builder, joborder, make_path_mapper, tool, name) =>
      new CommandLineJob(builder, joborder, make_path_mapper, tool, name);
  }

  updatePathmap(outdir: string, pathmap: PathMapper, fn: CWLObjectType): void {
    if (!(fn instanceof Object)) {
      throw new WorkflowException(`Expected File or Directory object, was ${typeof fn}`);
    }
    const basename = fn['basename'] as string;
    if ('location' in fn) {
      const location = fn['location'] as string;
      if (pathmap.contains(location)) {
        pathmap.update(
          location,
          pathmap.mapper(location).resolved,
          path.join(outdir, basename),
          `${fn['writable'] ? 'Writable' : ''}${fn['class']}`,
          false,
        );
      }
    }
    for (const sf of (fn['secondaryFiles'] || []) as CWLObjectType[]) {
      this.updatePathmap(outdir, pathmap, sf);
    }
    for (const ls of (fn['listing'] || []) as CWLObjectType[]) {
      this.updatePathmap(path.join(outdir, fn['basename'] as string), pathmap, ls);
    }
  }
  async evaluate_listing_string(
    initialWorkdir: any,
    builder: Builder,
    classic_dirent: any,
    classic_listing: any,
    debug: any,
  ): Promise<CWLObjectType[]> {
    const ls_evaluated = await builder.do_eval(initialWorkdir['listing']);
    let fail: any = false;
    let fail_suffix = '';
    if (!(ls_evaluated instanceof Array)) {
      fail = ls_evaluated;
    } else {
      const ls_evaluated2 = ls_evaluated as any[];
      for (const entry of ls_evaluated2) {
        if (entry == null) {
          if (classic_dirent) {
            fail = entry;
            fail_suffix =
              " Dirent.entry cannot return 'null' before CWL v1.2. Please consider using 'cwl-upgrader' to upgrade your document to CWL version v1.2.";
          }
        } else if (entry instanceof Array) {
          if (classic_listing) {
            throw new WorkflowException(
              "InitialWorkDirRequirement.listing expressions cannot return arrays of Files or Directories before CWL v1.1. Please considering using 'cwl-upgrader' to upgrade your document to CWL v1.1' or later.",
            );
          } else {
            for (const entry2 of entry) {
              if (!(entry2 instanceof Object && (('class' in entry2 && entry2['class'] == 'File') || 'Directory'))) {
                fail = `an array with an item ('${entry2}') that is not a File nor a Directory object.`;
              }
            }
          }
        } else if (
          !(
            entry instanceof Object &&
            (('class' in entry && (entry['class'] == 'File' || 'Directory')) || 'entry' in entry)
          )
        ) {
          fail = entry;
        }
      }
    }
    if (fail !== false) {
      let message =
        "Expression in a 'InitialWorkdirRequirement.listing' field must return a list containing zero or more of: File or Directory objects; Dirent objects";
      if (classic_dirent) {
        message += '. ';
      } else {
        message += '; null; or arrays of File or Directory objects. ';
      }
      message += `Got ${fail} among the results from `;
      message += `${initialWorkdir['listing'].trim()}.${fail_suffix}`;
      throw new WorkflowException(message);
    }
    return ls_evaluated as CWLObjectType[];
  }
  async evaluate_listing_expr_or_dirent(
    initialWorkdir: any,
    builder: Builder,
    classic_dirent: any,
    classic_listing: any,
    debug: any,
  ): Promise<CWLObjectType[]> {
    const ls: CWLObjectType[] = [];

    for (const t of initialWorkdir['listing'] as (string | CWLObjectType)[]) {
      if (t instanceof Object && 'entry' in t) {
        const entry_field: string = t['entry'] as string;
        const entry = await builder.do_eval(entry_field, false);
        if (entry === null) {
          continue;
        }
        if (entry instanceof Array) {
          if (classic_listing) {
            throw new WorkflowException(
              "'entry' expressions are not allowed to evaluate " +
                'to an array of Files or Directories until CWL ' +
                "v1.2. Consider using 'cwl-upgrader' to upgrade " +
                'your document to CWL version 1.2.',
            );
          }
          let filelist = true;
          for (const e of entry) {
            if (!(e instanceof Object) || !['File', 'Directory'].includes(e['class'])) {
              filelist = false;
              break;
            }
          }
          if (filelist) {
            if ('entryname' in t) {
              throw new WorkflowException("'entryname' is invalid when 'entry' returns list of File or Directory");
            }
            for (const e of entry) {
              const ec: CWLObjectType = e as CWLObjectType;
              ec['writable'] = t['writable'] || false;
            }
            ls.push(...(entry as CWLObjectType[]));
            continue;
          }
        }
        const et: CWLObjectType = {} as CWLObjectType;

        if (entry instanceof Object && ['File', 'Directory'].includes(entry['class'])) {
          et['entry'] = entry as CWLOutputType;
        } else {
          if (typeof entry === 'string') {
            et['entry'] = entry;
          } else {
            if (classic_dirent) {
              throw new WorkflowException(
                `'entry' expression resulted in something other than number, object or array besides a single File or Dirent object. In CWL v1.2+ this would be serialized to a JSON object. However this is a document. If that is the desired result then please consider using 'cwl-upgrader' to upgrade your document to CWL version 1.2. Result of ${entry_field} was ${entry}.`,
              );
            }
            et['entry'] = JSON.stringify(entry, null, '');
          }
        }

        if (t.hasOwnProperty('entryname')) {
          const entryname_field = t['entryname'] as string;
          if (entryname_field.includes('${') || entryname_field.includes('$(')) {
            const en = await builder.do_eval(t['entryname'] as string);
            if (typeof en !== 'string') {
              throw new WorkflowException(
                `'entryname' expression must result a string. Got ${en} from ${entryname_field}`,
              );
            }
            et['entryname'] = en;
          } else {
            et['entryname'] = entryname_field;
          }
        } else {
          et['entryname'] = undefined;
        }
        et['writable'] = t['writable'] || false;
        ls.push(et);
      } else {
        const initwd_item = await builder.do_eval(t);
        if (!initwd_item) {
          continue;
        }
        if (initwd_item instanceof Array) {
          ls.push(...(initwd_item as CWLObjectType[]));
        } else {
          ls.push(initwd_item as CWLObjectType);
        }
      }
    }
    return ls;
  }
  check_output_items(initialWorkdir: cwlTsAuto.InitialWorkDirRequirement, ls: CWLObjectType[]): void {
    for (let i = 0; i < ls.length; i++) {
      const t2 = ls[i];
      if (!(t2 instanceof Object)) {
        throw new WorkflowException(`Entry at index ${i} of listing is not a record, was ${typeof t2}`);
      }

      if (!('entry' in t2)) {
        continue;
      }

      // Dirent
      if (typeof t2['entry'] === 'string') {
        if (!t2['entryname']) {
          throw new WorkflowException(`Entry at index ${i} of listing missing entryname`);
        }
        ls[i] = {
          class: 'File',
          basename: t2['entryname'],
          contents: t2['entry'],
          writable: t2['writable'],
        };
        continue;
      }

      if (!(t2['entry'] instanceof Object)) {
        throw new WorkflowException(`Entry at index ${i} of listing is not a record, was ${typeof t2['entry']}`);
      }

      if (!['File', 'Directory'].includes(t2['entry']['class'])) {
        throw new WorkflowException(`Entry at index ${i} of listing is not a File or Directory object, was ${t2}`);
      }

      if (t2['entryname'] || t2['writable']) {
        const t3 = JSON.parse(JSON.stringify(t2));
        const t2entry = t3['entry'] as CWLObjectType;
        if (t3.get('entryname')) {
          t2entry['basename'] = t3['entryname'];
        }
        t2entry['writable'] = t3.get('writable');
      }

      ls[i] = t2['entry'] as CWLObjectType;
    }
  }
  check_output_items2(
    initialWorkdir: cwlTsAuto.InitialWorkDirRequirement,
    ls: CWLObjectType[],
    cwl_version: string,
    debug: boolean,
  ) {
    for (let i = 0; i < ls.length; i++) {
      const t3 = ls[i];
      if (!['File', 'Directory'].includes(t3['class'] as string)) {
        throw new WorkflowException(
          `Entry at index ${i} of listing is not a Dirent, File or ` + `Directory object, was ${t3}.`,
        );
      }
      if (!('basename' in t3)) continue;
      const basename = path.normalize(t3['basename'] as string);
      t3['basename'] = basename;
      if (basename.startsWith('../')) {
        throw new WorkflowException(
          `Name ${basename} at index ${i} of listing is invalid, ` + `cannot start with '../'`,
        );
      }
      // if (basename.startsWith("/")) {
      // if (cwl_version && ORDERED_VERSIONS.indexOf(cwl_version) < ORDERED_VERSIONS.indexOf("v1.2.0-dev4")) {
      // throw new WorkflowException(
      //     `Name ${basename!r} at index ${i} of listing is invalid, `+
      //     `paths starting with '/' are only permitted in CWL 1.2 ` +
      //     `and later. Consider changing the absolute path to a relative ` +
      //     `path, or upgrade the CWL description to CWL v1.2 using https://pypi.org/project/cwl-upgrader/`);
      //     }
      //     const [req, is_req] = this.get_requirement("DockerRequirement");
      //     if (is_req !== true) {
      //         throw new WorkflowException(
      //             `Name ${basename!r} at index ${i} of listing is invalid, ` +
      //             `name can only start with '/' when DockerRequirement is in 'requirements'.`);
      //     }
      // }
    }
  }
  setup_output_items(initialWorkdir: cwlTsAuto.InitialWorkDirRequirement, builder: Builder, ls: CWLObjectType[]): void {
    for (const entry of ls) {
      if ('basename' in entry) {
        const basename = entry['basename'] as string;
        entry['dirname'] = path.join(builder.outdir, path.dirname(basename));
        entry['basename'] = path.basename(basename);
      }
      normalizeFilesDirs(entry);
      this.updatePathmap((entry['dirname'] || builder.outdir) as string, builder.pathmapper, entry);
      if ('listing' in entry) {
        function remove_dirname(d: CWLObjectType): void {
          if ('dirname' in d) {
            delete d['dirname'];
          }
        }

        visit_class(entry['listing'], ['File', 'Directory'], remove_dirname);
      }

      visit_class([builder.files, builder.bindings], ['File', 'Directory'], (val) =>
        checkAdjust(this.path_check_mode.value, builder, val),
      );
    }
  }

  async _initialworkdir(j: JobBase, builder: Builder): Promise<void> {
    const [initialWorkdir, _] = getRequirement(this.tool, cwlTsAuto.InitialWorkDirRequirement);
    if (initialWorkdir == undefined) {
      return;
    }
    const debug = _logger.isDebugEnabled();
    const classic_dirent = false;
    const classic_listing = false;

    let ls: CWLObjectType[] = [];
    if (typeof initialWorkdir.listing === 'string') {
      ls = await this.evaluate_listing_string(initialWorkdir, builder, classic_dirent, classic_listing, debug);
    } else {
      ls = await this.evaluate_listing_expr_or_dirent(initialWorkdir, builder, classic_dirent, classic_listing, debug);
    }

    this.check_output_items(initialWorkdir, ls);

    this.check_output_items2(initialWorkdir, ls, 'cwl_version', debug);

    j.generatefiles['listing'] = ls;
    this.setup_output_items(initialWorkdir, builder, ls);
  }
  cache_context(runtimeContext: RuntimeContext): (arg1: CWLObjectType, arg2: string) => void {
    return (arg1: CWLObjectType, arg2: string) => {
      console.log(arg2);
    };
    // TODO cache not implemented
    // let cachecontext = runtimeContext.copy();
    // cachecontext.outdir = "/out";
    // cachecontext.tmpdir = "/tmp"; // nosec
    // cachecontext.stagedir = "/stage";
    // let cachebuilder = this._init_job(job_order, cachecontext);
    // cachebuilder.pathmapper = new PathMapper(
    //     cachebuilder.files,
    //     runtimeContext.basedir,
    //     cachebuilder.stagedir,
    //     false
    // );
    // let _check_adjust = partial(check_adjust, this.path_check_mode.value, cachebuilder);
    // let _checksum = partial(
    //     compute_checksums,
    //     runtimeContext.make_fs_access(runtimeContext.basedir),
    // );
    // visit_class(
    //     [cachebuilder.files, cachebuilder.bindings],
    //     ["File", "Directory"],
    //     _check_adjust,
    // );
    // visit_class([cachebuilder.files, cachebuilder.bindings], ["File"], _checksum);
    // let cmdline = flatten(list(map(cachebuilder.generate_arg, cachebuilder.bindings)));
    // let [docker_req, ] = this.get_requirement("DockerRequirement");
    // let dockerimg;
    // if (docker_req !== undefined && runtimeContext.use_container) {
    //     dockerimg = docker_req["dockerImageId"] || docker_req["dockerPull"];
    // } else if (runtimeContext.default_container !== null && runtimeContext.use_container) {
    //     dockerimg = runtimeContext.default_container;
    // } else {
    //     dockerimg = null;
    // }
    // if (dockerimg !== null) {
    //     cmdline = ["docker", "run", dockerimg].concat(cmdline);
    //     // not really run using docker, just for hashing purposes
    // }
    // let keydict: { [key: string]: any } = {
    //     "cmdline": cmdline
    // };
    // for (let shortcut of ["stdin", "stdout", "stderr"]) {
    //     if (shortcut in this.tool) {
    //         keydict[shortcut] = this.tool[shortcut];
    //     }
    // }
    // let calc_checksum = (location: string): string | undefined => {
    //     for (let e of cachebuilder.files) {
    //         if (
    //             "location" in e &&
    //             e["location"] === location &&
    //             "checksum" in e &&
    //             e["checksum"] != "sha1$hash"
    //         ) {
    //             return e["checksum"] as string;
    //         }
    //     }
    //     return undefined;
    // }
    // let remove_prefix = (s: string, prefix: string): string => {
    //     return s.startsWith(prefix) ? s.slice(prefix.length) : s;
    // }
    // for (let [location, fobj] of Object.entries(cachebuilder.pathmapper)) {
    //     if (fobj.type === "File") {
    //         let checksum = calc_checksum(location);
    //         let fobj_stat = fs.statSync(fobj.resolved);
    //         let path = remove_prefix(fobj.resolved, runtimeContext.basedir + "/");
    //         if (checksum !== null) {
    //             keydict[path] = [fobj_stat.size, checksum];
    //         } else {
    //             keydict[path] = [
    //                 fobj_stat.size,
    //                 Math.round(fobj_stat.mtimeMs),
    //             ];
    //         }
    //     }
    // }
    // let interesting = new Set([
    //     "DockerRequirement",
    //     "EnvVarRequirement",
    //     "InitialWorkDirRequirement",
    //     "ShellCommandRequirement",
    //     "NetworkAccess",
    // ]);
    // for (let rh of [this.original_requirements, this.original_hints]) {
    //     for (let r of rh.slice().reverse()) {
    //         let cls = r["class"] as string
    //         if (interesting.has(cls) && !(cls in keydict)) {
    //             keydict[cls] = r;
    //         }
    //     }
    // }
    // let keydictstr = json_dumps(keydict, { separators: (",", ":"), sort_keys: true });
    // let cachekey = hashlib.md5(keydictstr.encode("utf-8")).hexdigest(); // nosec
    // _logger.debug(`[job ${jobname}] keydictstr is ${keydictstr} -> ${cachekey}`);
    // let jobcache = path.join(runtimeContext.cachedir, cachekey);
    // // Create a lockfile to manage cache status.
    // let jobcachepending = `${jobcache}.status`;
    // let jobcachelock = null;
    // let jobstatus = null;
    // // Opens the file for read/write, or creates an empty file.
    // jobcachelock = open(jobcachepending, "a+");
    // // get the shared lock to ensure no other process is trying
    // // to write to this cache
    // shared_file_lock(jobcachelock);
    // jobcachelock.seek(0);
    // jobstatus = jobcachelock.read();
    // if (os.path.isdir(jobcache) && jobstatus === "success") {
    //     if (docker_req && runtimeContext.use_container) {
    //         cachebuilder.outdir = runtimeContext.docker_outdir || random_outdir();
    //     } else {
    //         cachebuilder.outdir = jobcache;
    //     }
    //     _logger.info(`[job ${jobname}] Using cached output in ${jobcache}`);
    //     yield new CallbackJob(this, output_callbacks, cachebuilder, jobcache);
    //     // we're done with the cache so release lock
    //     jobcachelock.close();
    //     return null;
    // } else {
    //     _logger.info(`[job ${jobname}] Output of job will be cached in ${jobcache}`);
    //     // turn shared lock into an exclusive lock since we'll
    //     // be writing the cache directory
    //     upgrade_lock(jobcachelock);
    //     shutil.rmtree(jobcache, true);
    //     fs.makedir(jobcache);
    //     runtimeContext = runtimeContext.copy();
    //     runtimeContext.outdir = jobcache;
    //     let update_status_output_callback = (
    //         output_callbacks: OutputCallbackType,
    //         jobcachelock: TextIO,
    //         outputs: Optional[CWLObjectType],
    //         processStatus: string,
    //     ) => {
    //         // save status to the lockfile then release the lock
    //         jobcachelock.seek(0);
    //         jobcachelock.truncate();
    //         jobcachelock.write(processStatus);
    //         jobcachelock.close();
    //         output_callbacks(outputs, processStatus);
    //     }
    //     output_callbacks = partial(
    //         update_status_output_callback, output_callbacks, jobcachelock
    //     );
    //     return output_callbacks;
    // }
  }
  handle_tool_time_limit(builder: Builder, j: JobBase, debug: boolean): void {
    const [timelimit, _] = getRequirement(this.tool, cwlTsAuto.ToolTimeLimit);
    if (timelimit == undefined) {
      return;
    }

    const limit_field = timelimit.timelimit;
    if (typeof limit_field === 'string') {
      const timelimit_eval = builder.do_eval(limit_field);
      if (timelimit_eval && typeof timelimit_eval !== 'number') {
        throw new WorkflowException(
          `'timelimit' expression must evaluate to a long/int. Got 
                ${timelimit_eval} for expression ${limit_field}.`,
        );
      } else {
        const timelimit_eval = limit_field;
      }
      if (typeof timelimit_eval !== 'number' || timelimit_eval < 0) {
        throw new WorkflowException(`timelimit must be an integer >= 0, got: ${timelimit_eval}`);
      }
      j.timelimit = timelimit_eval;
    }
  }

  handle_network_access(builder: Builder, j: JobBase, debug: boolean): void {
    const [networkaccess, _] = getRequirement(this.tool, cwlTsAuto.NetworkAccess);
    if (networkaccess == null) {
      return;
    }
    const networkaccess_field = networkaccess.networkAccess;
    if (typeof networkaccess_field === 'string') {
      const networkaccess_eval = builder.do_eval(networkaccess_field);
      if (typeof networkaccess_eval !== 'boolean') {
        throw new WorkflowException(
          `'networkAccess' expression must evaluate to a bool. 
                Got ${networkaccess_eval} for expression ${networkaccess_field}.`,
        );
      } else {
        const networkaccess_eval = networkaccess_field;
      }
      if (typeof networkaccess_eval !== 'boolean') {
        throw new WorkflowException(`networkAccess must be a boolean, got: ${networkaccess_eval}.`);
      }
      j.networkaccess = networkaccess_eval;
    }
  }
  handle_env_var(builder: Builder, debug: boolean): any {
    const [evr, _] = getRequirement(this.tool, cwlTsAuto.EnvVarRequirement);
    if (evr === undefined) {
      return {};
    }
    const required_env = {};
    const envDef = evr.envDef;
    for (let eindex = 0; eindex < envDef.length; eindex++) {
      const t3 = envDef[eindex];
      const env_value_field = t3.envValue;
      let env_value: string = t3.envValue;
      if (isString(env_value_field) && (env_value_field.includes('${') || env_value_field.includes('$('))) {
        const env_value_eval = builder.do_eval(env_value_field);
        if (typeof env_value_eval !== 'string') {
          throw new WorkflowException(
            "'envValue expression must evaluate to a str. " +
              `Got ${env_value_eval} for expression ${env_value_field}.`,
          );
        }
        env_value = env_value_eval;
      } else {
        env_value = env_value_field;
      }
      required_env[t3['envName']] = env_value;
    }
    return required_env;
  }
  async setup_command_line(builder: Builder, j: JobBase, debug: boolean) {
    const [shellcmd, _] = getRequirement(this.tool, cwlTsAuto.ShellCommandRequirement);
    if (shellcmd !== undefined) {
      let cmd: string[] = []; // type: List[str]
      for (const b of builder.bindings) {
        let arg = await builder.generate_arg(b);
        if (!(b.shellQuote === false)) {
          arg = aslist(arg).map((a) => quote(a));
        }
        cmd = [...cmd, ...aslist(arg)];
      }
      j.command_line = ['/bin/sh', '-c', cmd.join(' ')];
    } else {
      const cmd: string[] = [];
      for (let index = 0; index < builder.bindings.length; index++) {
        const element = builder.bindings[index];
        const a = await builder.generate_arg(element);
        const b = a.flat();
        cmd.push(...b);
      }
      j.command_line = cmd;
    }
  }

  handle_mpi_require(runtimeContext: RuntimeContext, builder: Builder, j: JobBase, debug: boolean) {
    // TODO mpi not implemented
    // let mpi;
    // [mpi, _] = this.get_requirement(MPIRequirementName);
    // if (mpi === null) {
    //     return;
    // }
    // let np = mpi.get("processes", runtimeContext.mpi_config.default_nproc);
    // if (typeof np === 'string') {
    //     let np_eval = builder.do_eval(np);
    //     if (typeof np_eval !== 'number') {
    //         throw new SourceLine(mpi, "processes", WorkflowException, debug).makeError(
    //         `${MPIRequirementName} needs 'processes' expression to ` +
    //         `evaluate to an int, got ${np_eval} for expression ${np}.`
    //         );
    //     }
    //     np = np_eval;
    // }
    // j.mpi_procs = np;
  }
  async setup_std_io(builder: any, j: any, reffiles: any[], debug: boolean): Promise<void> {
    if (this.tool.stdin) {
      const stdin_eval = await builder.do_eval(this.tool['stdin']);
      if (!(typeof stdin_eval === 'string' || stdin_eval === null)) {
        throw new Error(
          `'stdin' expression must return a string or null. Got ${stdin_eval} for ${this.tool['stdin']}.`,
        );
      }
      j.stdin = stdin_eval;
      if (j.stdin) {
        reffiles.push({ class: 'File', path: j.stdin });
      }
    }

    if (this.tool.stderr) {
      const stderr_eval = await builder.do_eval(this.tool.stderr);
      if (typeof stderr_eval !== 'string') {
        throw new Error(`'stderr' expression must return a string. Got ${stderr_eval} for ${this.tool['stderr']}.`);
      }
      j.stderr = stderr_eval;
      if (j.stderr) {
        if (path.isAbsolute(j.stderr) || j.stderr.includes('..')) {
          throw new Error(`stderr must be a relative path, got '${j.stderr}'`);
        }
      }
    }

    if (this.tool.stdout) {
      const stdout_eval = await builder.do_eval(this.tool.stdout);
      if (typeof stdout_eval !== 'string') {
        throw new Error(`'stdout' expression must return a string. Got ${stdout_eval} for ${this.tool['stdout']}.`);
      }
      j.stdout = stdout_eval;
      if (j.stdout) {
        if (path.isAbsolute(j.stdout) || j.stdout.includes('..') || !j.stdout) {
          throw new Error(`stdout must be a relative path, got '${j.stdout}'`);
        }
      }
    }
  }
  handleMutationManager(builder: Builder, j: JobBase): Record<string, CWLObjectType> | undefined {
    const readers: Record<string, CWLObjectType> = {};
    const muts: Set<string> = new Set();
    // TODO MutationManager is not implemented
    // if (builder.mutationManager === null) {
    //     return readers;
    // }

    // let registerMut = (f: CWLObjectType) => {
    //     let mm = builder.mutationManager as MutationManager;
    //     muts.add(f['location'] as string);
    //     mm.registerMutation(j.name, f);
    // }

    // let registerReader = (f: CWLObjectType) => {
    //     let mm = builder.mutationManager as MutationManager;
    //     if (!muts.has(f['location'] as string)) {
    //         mm.registerReader(j.name, f);
    //         readers[f['location'] as string] = JSON.parse(JSON.stringify(f));
    //     }
    // }

    // for (let li of j.generatefiles['listing']) {
    //     if (li.get('writable') && j.inplaceUpdate) {
    //         adjustFileObjs(li, registerMut)
    //         adjustDirObjs(li, registerMut)
    //     } else {
    //         adjustFileObjs(li, registerReader)
    //         adjustDirObjs(li, registerReader)
    //     }
    // }

    // adjustFileObjs(builder.files, registerReader);
    // adjustFileObjs(builder.bindings, registerReader);
    // adjustDirObjs(builder.files, registerReader);
    // adjustDirObjs(builder.bindings, registerReader);

    return readers;
  }
  async *job(
    job_order: CWLObjectType,
    output_callbacks: any | OutputCallbackType | null,
    runtimeContext: RuntimeContext,
  ): AsyncGenerator<JobBase> {
    const [workReuse] = getRequirement(this.tool, WorkReuse);
    const enableReuse = workReuse ? workReuse.enableReuse : true;

    const jobname = uniquename(runtimeContext.name || shortname(this.tool.id || 'job'));
    if (runtimeContext.cachedir && enableReuse) {
      output_callbacks = this.cache_context(runtimeContext);
      if (output_callbacks) {
        return;
      }
    }
    const builder = await this._init_job(job_order, runtimeContext);

    const reffiles = JSON.parse(JSON.stringify(builder.files));
    const mjr = this.make_job_runner(runtimeContext);
    const j = mjr(builder, builder.job, make_path_mapper, this.tool, jobname);

    j.prov_obj = this.prov_obj;

    j.successCodes = this.tool.successCodes || [];
    j.temporaryFailCodes = this.tool.temporaryFailCodes || [];
    j.permanentFailCodes = this.tool.permanentFailCodes || [];

    const debug = _logger.isDebugEnabled();

    if (debug) {
      _logger.debug(
        `[job ${j.name}] initializing from ${this.tool.id}${
          runtimeContext.part_of ? ` as part of ${runtimeContext.part_of}` : ''
        }`,
      );
      _logger.debug(`[job ${j.name}] ${JSON.stringify(builder.job, null, 4)}`);
    }
    builder.pathmapper = make_path_mapper(reffiles, builder.stagedir, runtimeContext, true);

    const _check_adjust = (val) => checkAdjust(this.path_check_mode.value, builder, val);

    visit_class([builder.files, builder.bindings], ['File', 'Directory'], _check_adjust);

    this._initialworkdir(j, builder);

    if (debug) {
      _logger.debug(
        `[job ${j.name}] path mappings is ${JSON.stringify(
          builder.pathmapper.files().reduce((obj: any, p: string) => {
            obj[p] = builder.pathmapper.mapper(p);
            return obj;
          }, {}),
          null,
          4,
        )}`,
      );
    }

    await this.setup_std_io(builder, j, reffiles, debug);

    if (debug) {
      _logger.debug(`[job ${j.name}] command line bindings is ${JSON.stringify(builder.bindings, null, 4)}`);
    }

    const [dockerReq] = getRequirement(this.tool, DockerRequirement);
    if (dockerReq && runtimeContext.use_container) {
      j.outdir = runtimeContext.getOutdir();
      j.tmpdir = runtimeContext.getTmpdir();
      j.stagedir = runtimeContext.createTmpdir();
    } else {
      j.outdir = builder.outdir;
      j.tmpdir = builder.tmpdir;
      j.stagedir = builder.stagedir;
    }

    const [inplaceUpdateReq, _] = getRequirement(this.tool, InplaceUpdateRequirement);
    if (inplaceUpdateReq) {
      j.inplace_update = inplaceUpdateReq['inplaceUpdate'];
    }
    normalizeFilesDirs(j.generatefiles);

    const readers = {}; // this.handle_mutation_manager(builder, j);

    this.handle_tool_time_limit(builder, j, debug);

    this.handle_network_access(builder, j, debug);

    const required_env = this.handle_env_var(builder, debug);
    j.prepare_environment(runtimeContext, required_env);

    await this.setup_command_line(builder, j, debug);

    j.pathmapper = builder.pathmapper;
    j.collect_outputs = async (outdir, rcode) =>
      this.collect_output_ports(
        this.tool.outputs,
        builder,
        outdir,
        rcode,
        getDefault(runtimeContext.compute_checksum, true),
        jobname,
        readers,
      );
    j.output_callback = output_callbacks;

    this.handle_mpi_require(runtimeContext, builder, j, debug);
    yield j;
  }
  async collect_output_ports(
    ports: CommandOutputParameter[] | Set<CWLObjectType>,
    builder: Builder,
    outdir: string,
    rcode: number,
    compute_checksum = true,
    jobname = '',
    readers: MutableMapping<CWLObjectType> | null = null,
  ): Promise<OutputPortsType> {
    let ret: OutputPortsType = {};
    const debug = _logger.isDebugEnabled();
    const cwl_version = 'v1.2';
    try {
      const fs_access = new builder.make_fs_access(outdir);
      const custom_output = fs_access.join(outdir, 'cwl.output.json');
      if (fs_access.exists(custom_output)) {
        const f = await fs_access.read(custom_output);
        ret = JSON.parse(f);
        if (debug) {
          _logger.debug(`Raw output from ${custom_output}: ${JSON.stringify(ret, null, 4)}`);
        }
      } else if (Array.isArray(ports)) {
        for (let i = 0; i < ports.length; i++) {
          const port = ports[i] as any;
          const fragment = shortname(port['id']);
          ret[fragment] = await this.collect_output(port, builder, outdir, fs_access, compute_checksum);
        }
      }
      if (ret) {
        const revmap = (val) => revmap_file(builder, outdir, val);
        // adjustDirObjs(ret, trim_listing);
        visit_class(ret, ['File', 'Directory'], revmap);
        visit_class(ret, ['File', 'Directory'], remove_path);
        normalizeFilesDirs(ret);
        visit_class(ret, ['File', 'Directory'], (val) => checkValidLocations(fs_access, val));

        if (compute_checksum) {
          adjustFileObjs(ret, async (val) => compute_checksums(fs_access, val));
        }
        // const expected_schema = ((this.names.get_name("outputs_record_schema", null)) as Schema);
        // validate_ex(
        //     expected_schema,
        //     ret,
        //     false,
        //     _logger_validation_warnings,
        //     INPUT_OBJ_VOCAB,
        // );
        if (ret && builder.mutation_manager) {
          adjustFileObjs(ret, builder.mutation_manager.set_generation);
        }
        return ret || {};
      }
    } catch (e) {
      if (e instanceof ValidationException) {
        throw new WorkflowException(`Error validating output record. ${e}\n in ${JSON.stringify(ret, null, 4)}`);
      }
      throw e;
    } finally {
      if (builder.mutation_manager && readers) {
        for (const r of Object.values(readers)) {
          builder.mutation_manager.release_reader(jobname, r);
        }
      }
    }
    return ret;
  }
  async glob_output(
    builder: Builder,
    binding,
    debug: boolean,
    outdir: string,
    fs_access: StdFsAccess,
    compute_checksum: boolean,
    revmap,
  ): Promise<[CWLOutputType[], string[]]> {
    const r: CWLOutputType[] = [];
    const globpatterns: string[] = [];

    if (!binding['glob']) {
      return [r, globpatterns];
    }

    try {
      for (let gb of aslist(binding['glob'])) {
        gb = await builder.do_eval(gb);
        if (gb) {
          let gb_eval_fail = false;
          if (typeof gb !== 'string') {
            if (Array.isArray(gb)) {
              for (const entry of gb) {
                if (typeof entry !== 'string') {
                  gb_eval_fail = true;
                }
              }
            } else {
              gb_eval_fail = true;
            }
          }

          if (gb_eval_fail) {
            throw new WorkflowException(
              'Resolved glob patterns must be strings or list of strings, not ' + `${gb} from ${binding['glob']!}`,
            );
          }

          globpatterns.push(...aslist(gb));
        }
      }

      for (let gb of globpatterns) {
        if (gb.startsWith(builder.outdir)) {
          gb = gb.substring(builder.outdir.length + 1);
        } else if (gb === '.') {
          gb = outdir;
        } else if (gb.startsWith('/')) {
          throw new WorkflowException("glob patterns must not start with '/'");
        }

        try {
          const prefix = fs_access.glob(outdir);
          const sorted_glob_result = fs_access.glob(fs_access.join(outdir, gb)).sort();

          r.push(
            ...sorted_glob_result.map((g) => ({
              location: g,
              path: fs_access.join(builder.outdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
              basename: g,
              nameroot: splitext(g)[0],
              nameext: splitext(g)[1],
              class: fs_access.isfile(g) ? 'File' : 'Directory',
            })),
          );
        } catch (e) {
          console.error('Unexpected error from fs_access');
          throw e;
        }
      }

      for (const files of r) {
        const rfile = { ...(files as any) };
        revmap(rfile);
        if (files['class'] === 'Directory') {
          const ll = binding['loadListing'] || builder.loadListing;
          if (ll && ll !== 'no_listing') {
            get_listing(fs_access, files, ll === 'deep_listing');
          }
        } else {
          if (binding['loadContents']) {
            let f: any = undefined;
            try {
              f = fs_access.open(rfile['location'] as string, 'rb');
              files['contents'] = contentLimitRespectedRead(f);
            } finally {
              if (f) {
                f.close();
              }
            }
          }

          if (compute_checksum) {
            await compute_checksums(fs_access, rfile);
          }

          files['size'] = fs_access.size(rfile['location'] as string);
        }
      }

      return [r, globpatterns];
    } catch (e) {
      throw e;
    }
  }
  async collect_secondary_files(
    schema: CommandOutputParameter,
    builder: Builder,
    result: CWLOutputType | null,
    debug: boolean,
    fs_access: StdFsAccess,
    revmap: any,
  ): Promise<void> {
    for (const primary of aslist(result)) {
      if (primary instanceof Object) {
        if (!primary['secondaryFiles']) {
          primary['secondaryFiles'] = [];
        }
        const pathprefix = primary['path'].substring(0, primary['path'].lastIndexOf(path.sep) + 1);
        for (const sf of aslist(schema.secondaryFiles)) {
          let sf_required: boolean;
          if ('required' in sf) {
            const sf_required_eval = await builder.do_eval(sf['required'], primary);
            if (!(typeof sf_required_eval === 'boolean' || sf_required_eval === null)) {
              throw new WorkflowException(
                `Expressions in the field 'required' must evaluate to a Boolean (true or false) or None. Got ${sf_required_eval} for ${sf['required']}.`,
              );
            }
            sf_required = (sf_required_eval as boolean) || false;
          } else {
            sf_required = false;
          }

          let sfpath;
          if (sf['pattern'].includes('$(') || sf['pattern'].includes('${')) {
            sfpath = builder.do_eval(sf['pattern'], primary);
          } else {
            sfpath = substitute(primary['basename'], sf['pattern']);
          }

          for (let sfitem of aslist(sfpath)) {
            if (!sfitem) {
              continue;
            }
            if (typeof sfitem === 'string') {
              sfitem = { path: pathprefix + sfitem };
            }
            const original_sfitem = JSON.parse(JSON.stringify(sfitem));
            if (!fs_access.exists(revmap(sfitem)['location']) && sf_required) {
              throw new WorkflowException(`Missing required secondary file '${original_sfitem['path']}'`);
            }
            if ('path' in sfitem && !('location' in sfitem)) {
              revmap(sfitem);
            }
            if (fs_access.isfile(sfitem['location'])) {
              sfitem['class'] = 'File';
              primary['secondaryFiles'].push(sfitem);
            } else if (fs_access.isdir(sfitem['location'])) {
              sfitem['class'] = 'Directory';
              primary['secondaryFiles'].push(sfitem);
            }
          }
        }
      }
    }
  }
  handle_output_format(schema: CommandOutputParameter, builder: Builder, result: CWLOutputType, debug: boolean): void {
    if (schema.format) {
      const format_field: string = schema.format;
      if (format_field.includes('$(') || format_field.includes('${')) {
        aslist(result).forEach((primary, index) => {
          const format_eval: any = builder.do_eval(format_field, primary);
          if (typeof format_eval !== 'string') {
            let message = `'format' expression must evaluate to a string. Got ${format_eval} from ${format_field}.`;
            if (Array.isArray(result)) {
              message += ` 'self' had the value of the index ${index} result: ${primary}.`;
            }
            throw new WorkflowException(message);
          }
          primary['format'] = format_eval;
        });
      } else {
        aslist(result).forEach((primary) => {
          primary['format'] = format_field;
        });
      }
    }
  }
  async collect_output(
    schema: CommandOutputParameter,
    builder: Builder,
    outdir: string,
    fs_access: StdFsAccess,
    compute_checksum = true,
  ): Promise<CWLOutputType | undefined> {
    const empty_and_optional = false;
    const debug = _logger.isDebugEnabled();
    let result: CWLOutputType | undefined = undefined;
    if (schema.outputBinding) {
      const binding = schema.outputBinding;
      const revmap = revmap_file.bind(null, builder, outdir);
      const [r, globpatterns] = await this.glob_output(
        builder,
        binding,
        debug,
        outdir,
        fs_access,
        compute_checksum,
        revmap,
      );
      let optional = false;
      let single = false;
      if (Array.isArray(schema.type)) {
        if (schema.type.includes('null')) {
          optional = true;
        }
        if (schema.type.includes('File') || schema.type.includes('Directory')) {
          single = true;
        }
      } else if (schema.type === 'File' || schema.type === 'Directory') {
        single = true;
      }
      if (binding.outputEval) {
        try {
          result = await builder.do_eval(binding.outputEval, { context: r });
        } catch (error) {
          // Log the error here
        }
      } else {
        result = r as CWLOutputType;
      }
      if (single) {
        try {
          if (!result && !optional) {
            throw new WorkflowException(`Did not find output file with glob pattern: ${globpatterns}.`);
          } else if (!result && optional) {
            // Do nothing
          } else if (Array.isArray(result)) {
            if (result.length > 1) {
              throw new WorkflowException('Multiple matches for output item that is a single file.');
            } else {
              result = result[0] as CWLOutputType;
            }
          }
        } catch (error) {
          // Log the error here
        }
      }
      if (schema.secondaryFiles) {
        await this.collect_secondary_files(schema, builder, result, debug, fs_access, revmap);
      }
      this.handle_output_format(schema, builder, result, debug);
      adjustFileObjs(result, revmap);
      if (!result && optional && ![0, ''].includes(result as string | number)) {
        return undefined;
      }
    }
    if (!result && !empty_and_optional && typeof schema.type === 'object' && schema.type['type'] === 'record') {
      const out = {};
      for (const field of schema['type']['fields'] as CWLObjectType[]) {
        out[shortname(field['name'] as string)] = this.collect_output(
          // todo
          field as unknown as CommandOutputParameter,
          builder,
          outdir,
          fs_access,
          compute_checksum,
        );
      }
      return out;
    }
    return result;
  }
}
