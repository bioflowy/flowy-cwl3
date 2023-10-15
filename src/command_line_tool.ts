import * as path from 'node:path';
import cwlTsAuto, {
  CommandOutputBinding,
  Directory,
  Dirent,
  DockerRequirement,
  File,
  InitialWorkDirRequirement,
  InplaceUpdateRequirement,
  WorkReuse,
} from 'cwl-ts-auto';
import { Builder, contentLimitRespectedReadBytes, substitute } from './builder.js';
import { LoadingContext, RuntimeContext, getDefault } from './context.js';
import { DockerCommandLineJob, PodmanCommandLineJob } from './docker.js';
import { UnsupportedRequirement, ValidationException, WorkflowException } from './errors.js';
import { pathJoin } from './fileutils.js';
import { CommandLineJob, JobBase } from './job.js';
import { _logger } from './loghandler.js';
import { convertFileDirectoryToDict } from './main.js';
import { PathMapper } from './pathmapper.js';
import { Process, compute_checksums, shortname, uniquename } from './process.js';
import { StdFsAccess } from './stdfsaccess.js';
import { type ToolRequirement } from './types.js';
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
  josonStringifyLikePython,
  isStringOrStringArray,
} from './utils.js';
import { validate } from './validate.js';
import { CommandInputParameter, CommandOutputParameter, Tool } from './cwltypes.js';
import { collect_output_ports } from './collect_outputs.js';
export class ExpressionJob {
  builder: Builder;
  script: string;
  output_callback: OutputCallbackType | null;
  requirements: ToolRequirement;
  hints: ToolRequirement;
  outdir: string | null;
  tmpdir: string | null;
  prov_obj: any | null;

  constructor(
    builder: Builder,
    script: string,
    output_callback: OutputCallbackType | null,
    requirements: ToolRequirement,
    hints: ToolRequirement,
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
  override init(loadContent: LoadingContext) {
    for (const i of this.tool.inputs) {
      const c: CommandInputParameter = i;
      c.name = shortname(i.id);
    }
    for (const i of this.tool.outputs) {
      const c: CommandOutputParameter = i;
      c.name = shortname(i.id);
    }
    super.init(loadContent);
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
function checkAdjust(acceptRe: RegExp, builder: Builder, fileO: CWLObjectType): CWLObjectType {
  if (!builder.pathmapper) {
    throw new Error("Do not call check_adjust using a builder that doesn't have a pathmapper.");
  }
  const m = builder.pathmapper.mapper(fileO['location'] as string);
  const path1 = m.target;
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
  if (!acceptRe.test(basename)) {
    throw new Error(`Invalid filename: ${fileO['basename']} contains illegal characters`);
  }
  return fileO;
}

class PathCheckingMode {
  /**
   * What characters are allowed in path names.
   * We have the strict (default) mode and the relaxed mode.
   */

  static STRICT = new RegExp('^[w.+,-:@]^\u2600-\u26FFU0001f600-U0001f64f]+$');
  /**
   * Accepts names that contain one or more of the following:
   *   - `\w`: unicode word characters
   *          this includes most characters that can be part of a word in any
   *          language, as well as numbers and the underscore
   *   - `.`: a literal period
   *   - `+`: a literal plus sign
   *   - `,`: a literal comma
   *   - `-`: a literal minus sign
   *   - `:`: a literal colon
   *   - `@`: a literal at-symbol
   *   - `]`: a literal end-square-bracket
   *   - `^`: a literal caret symbol
   *   - `\u2600-\u26FF`: matches a single character in the range between ☀ (index 9728) and ⛿ (index 9983)
   *   - `\U0001f600-\U0001f64f`: matches a single character in the range between 😀 (index 128512) and 🙏 (index 128591)
   * Note: the following characters are intentionally not included:
   * 1. reserved words in POSIX: `!`, `{`, `}`
   * 2. POSIX metacharacters listed in the CWL standard as okay to reject: `|`,
   *    `&`, `;`, `<`, `>`, `(`, `)`, `$`, ````, `"`, `'`,
   *    <space>, <tab>, <newline>.
   * 3. POSIX path separator: `\`
   * 4. Additional POSIX metacharacters: `*`, `?`, `[`, `#`, `˜`,
   *    `=`, `%`.
   * TODO: switch to https://pypi.org/project/regex/ and use
   * `\p{Extended_Pictographic}` instead of the manual emoji ranges
   */

  static RELAXED = new RegExp('.*');
  /** Accept anything. */
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
  path_check_mode: RegExp; // placeholder type
  override init(loadContent: LoadingContext) {
    this.path_check_mode = loadContent.relax_path_checks ? PathCheckingMode.RELAXED : PathCheckingMode.STRICT;
    for (const i of this.tool.inputs) {
      const c: CommandInputParameter = i;
      c.name = shortname(i.id);
    }
    for (const i of this.tool.outputs) {
      const c: CommandOutputParameter = i;
      c.name = shortname(i.id);
    }
    super.init(loadContent);
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
      this.updatePathmap(pathJoin(outdir, fn['basename'] as string), pathmap, ls);
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
    initialWorkdir: InitialWorkDirRequirement,
    builder: Builder,
    classic_dirent: boolean,
  ): Promise<CWLObjectType[]> {
    const ls: CWLObjectType[] = [];

    for (const t of aslist(initialWorkdir.listing)) {
      if (t instanceof Dirent) {
        const entry_field: string = t.entry;
        const entry = await builder.do_eval(entry_field, undefined, false, false);
        if (entry === null) {
          /**
           * * If the value is an expression that evaluates to `null`,
           * nothing is added to the designated output directory, the entry
           * has no effect.
           */
          continue;
        }
        if (entry instanceof Array) {
          let filelist = true;
          for (const e of entry) {
            if (!(e instanceof Object) || !['File', 'Directory'].includes(e['class'])) {
              filelist = false;
              break;
            }
          }
          if (filelist) {
            if (t.entryname) {
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

        if (['File', 'Directory'].includes(entry['class'])) {
          et['entry'] = entry;
        } else {
          if (typeof entry === 'string') {
            et['entry'] = entry;
          } else {
            if (classic_dirent) {
              throw new WorkflowException(
                `'entry' expression resulted in something other than number, object or array besides a single File or Dirent object. In CWL v1.2+ this would be serialized to a JSON object. However this is a document. If that is the desired result then please consider using 'cwl-upgrader' to upgrade your document to CWL version 1.2. Result of ${entry_field} was ${entry}.`,
              );
            }
            et['entry'] = josonStringifyLikePython(entry);
          }
        }

        if (t.entryname) {
          const entryname_field = t.entryname;
          if (entryname_field.includes('${') || entryname_field.includes('$(')) {
            const en = await builder.do_eval(t.entryname);
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
      } else if (isString(t)) {
        const initwd_item = await builder.do_eval(t);
        if (!initwd_item) {
          continue;
        }
        if (initwd_item instanceof Array) {
          ls.push(...(initwd_item as CWLObjectType[]));
        } else {
          ls.push(initwd_item as CWLObjectType);
        }
      } else {
        if (Array.isArray(t)) {
          for (const f of t) {
            ls.push(convertFileDirectoryToDict(f));
          }
        } else {
          ls.push(convertFileDirectoryToDict(t));
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
        if (t3['entryname']) {
          t2entry['basename'] = t3['entryname'];
        }
        t2entry['writable'] = t3['writable'];
        ls[i] = t3['entry'] as CWLObjectType;
      } else {
        ls[i] = t2['entry'] as CWLObjectType;
      }
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
      if (!t3['basename']) continue;
      const basename = path.normalize(t3['basename'] as string);
      t3['basename'] = basename;
      if (basename.startsWith('../')) {
        throw new WorkflowException(
          `Name ${basename} at index ${i} of listing is invalid, ` + `cannot start with '../'`,
        );
      }
      if (basename.startsWith('/')) {
        const [req, is_req] = this.getRequirement(DockerRequirement);
        if (is_req !== true) {
          throw new WorkflowException(
            `Name ${basename} at index ${i} of listing is invalid, ` +
              `name can only start with '/' when DockerRequirement is in 'requirements'.`,
          );
        }
      }
    }
  }

  setup_output_items(initialWorkdir: cwlTsAuto.InitialWorkDirRequirement, builder: Builder, ls: CWLObjectType[]): void {
    for (const entry of ls) {
      if (entry['basename']) {
        const basename = entry['basename'] as string;
        entry['dirname'] = pathJoin(builder.outdir, path.dirname(basename));
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
        checkAdjust(this.path_check_mode, builder, val),
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
      ls = await this.evaluate_listing_expr_or_dirent(initialWorkdir, builder, classic_dirent);
    }

    this.check_output_items(initialWorkdir, ls);

    this.check_output_items2(initialWorkdir, ls, 'cwl_version', debug);

    j.generatefiles['listing'] = ls;
    this.setup_output_items(initialWorkdir, builder, ls);
  }
  cache_context(runtimeContext: RuntimeContext): (arg1: CWLObjectType, arg2: string) => void {
    return (arg1: CWLObjectType, arg2: string) => {};
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
  async handle_tool_time_limit(builder: Builder, j: JobBase, debug: boolean): Promise<void> {
    const [timelimit, _] = getRequirement(this, cwlTsAuto.ToolTimeLimit);
    if (timelimit == undefined) {
      return;
    }

    const limit_field = timelimit.timelimit;
    if (typeof limit_field === 'string') {
      let timelimit_eval = await builder.do_eval(limit_field);
      if (timelimit_eval && typeof timelimit_eval !== 'number') {
        throw new WorkflowException(
          `'timelimit' expression must evaluate to a long/int. Got 
                ${timelimit_eval} for expression ${limit_field}.`,
        );
      } else {
        timelimit_eval = limit_field;
      }
      if (typeof timelimit_eval !== 'number' || timelimit_eval < 0) {
        throw new WorkflowException(`timelimit must be an integer >= 0, got: ${timelimit_eval}`);
      }
      j.timelimit = timelimit_eval;
    } else {
      j.timelimit = limit_field;
    }
  }

  async handle_network_access(builder: Builder, j: JobBase, debug: boolean): Promise<void> {
    const [networkaccess, _] = getRequirement(this.tool, cwlTsAuto.NetworkAccess);
    if (networkaccess == null) {
      return;
    }
    let networkaccess_eval: CWLOutputType = undefined;
    const networkaccess_field = networkaccess.networkAccess;
    if (typeof networkaccess_field === 'string') {
      networkaccess_eval = await builder.do_eval(networkaccess_field);
      if (typeof networkaccess_eval !== 'boolean') {
        throw new WorkflowException(
          `'networkAccess' expression must evaluate to a bool. 
                Got ${networkaccess_eval} for expression ${networkaccess_field}.`,
        );
      }
    } else {
      networkaccess_eval = networkaccess_field;
    }
    if (typeof networkaccess_eval !== 'boolean') {
      throw new WorkflowException(`networkAccess must be a boolean, got: ${networkaccess_eval}.`);
    }
    j.networkaccess = networkaccess_eval;
  }
  async handle_env_var(builder: Builder, debug: boolean): Promise<any> {
    const [evr, _] = getRequirement(this, cwlTsAuto.EnvVarRequirement);
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
        const env_value_eval = await builder.do_eval(env_value_field);
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

    const _check_adjust = (val) => checkAdjust(this.path_check_mode, builder, val);

    visit_class([builder.files, builder.bindings], ['File', 'Directory'], _check_adjust);

    await this._initialworkdir(j, builder);

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

    await this.handle_tool_time_limit(builder, j, debug);

    await this.handle_network_access(builder, j, debug);

    const required_env = await this.handle_env_var(builder, debug);
    j.prepare_environment(runtimeContext, required_env);

    await this.setup_command_line(builder, j, debug);

    j.pathmapper = builder.pathmapper;
    j.collect_outputs = async (outdir, rcode, filemap) =>
      collect_output_ports(
        this.tool.outputs,
        builder,
        outdir,
        rcode,
        filemap,
        getDefault(runtimeContext.compute_checksum, true),
        jobname,
        readers,
      );
    j.output_callback = output_callbacks;

    this.handle_mpi_require(runtimeContext, builder, j, debug);
    yield j;
  }
}
