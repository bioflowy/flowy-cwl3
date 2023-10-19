import * as path from 'node:path';
import * as cwl from 'cwl-ts-auto';
import { cloneDeep } from 'lodash-es';
import { Builder, contentLimitRespectedReadBytes, substitute } from './builder.js';
import { LoadingContext, RuntimeContext, getDefault } from './context.js';
import {
  CommandInputParameter,
  CommandOutputBinding,
  CommandOutputParameter,
  Directory,
  File,
  Tool,
} from './cwltypes.js';
import { DockerCommandLineJob, PodmanCommandLineJob } from './docker.js';
import { UnsupportedRequirement, ValidationException, WorkflowException } from './errors.js';
import { pathJoin } from './fileutils.js';
import { CommandLineJob, JobBase } from './job.js';
import { _logger } from './loghandler.js';
import { convertDictToFileDirectory, convertObjectToFileDirectory } from './main.js';
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
  getRequirement,
  josonStringifyLikePython,
  isStringOrStringArray,
  visitFileDirectory,
  str,
  isDirectory,
  isFileOrDirectory,
  isFile,
} from './utils.js';
import { validate } from './validate.js';

interface Dirent {
  entryname?: string;
  entry?: string | File | Directory;
  writable?: boolean;
}

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
  declare tool: cwl.ExpressionTool;
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

function remove_path(f: File | Directory): void {
  if (f.path) {
    f.path = undefined;
  }
}
function revmap_file(builder: Builder, outdir: string, f: File | Directory): File | Directory | null {
  if (outdir.startsWith('/')) {
    outdir = fileUri(outdir);
  }
  if (f.location && !f.path) {
    const location: string = f.location;
    if (location.startsWith('file://')) {
      f.path = uriFilePath(location);
    } else {
      f.location = builder.fs_access.join(outdir, f.location);
      return f;
    }
  }
  if (f['dirname']) {
    delete f['dirname'];
  }
  if (f.path) {
    const path1 = builder.fs_access.join(builder.outdir, f.path);
    const uripath = fileUri(path1);
    f.path = undefined;
    if (!f.basename) {
      f.basename = path.basename(path1);
    }
    if (!builder.pathmapper) {
      throw new Error("Do not call revmap_file using a builder that doesn't have a pathmapper.");
    }
    const revmap_f = builder.pathmapper.reversemap(path1);
    if (revmap_f && !builder.pathmapper.mapper(revmap_f[0]).type.startsWith('Writable')) {
      f.location = revmap_f[1];
    } else if (uripath == outdir || uripath.startsWith(outdir + path.sep) || uripath.startsWith(`${outdir}/`)) {
      f.location = uripath;
    } else if (
      path1 == builder.outdir ||
      path1.startsWith(builder.outdir + path.sep) ||
      path1.startsWith(`${builder.outdir}/`)
    ) {
      const joined_path = builder.fs_access.join(
        outdir,
        encodeURIComponent(path1.substring(builder.outdir.length + 1)),
      );
      f.location = joined_path;
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
  reffiles: (File | Directory)[],
  stagedir: string,
  runtimeContext: RuntimeContext,
  separateDirs: boolean,
): PathMapper {
  return new PathMapper(reffiles, runtimeContext.basedir, stagedir, separateDirs);
}

function checkAdjust(acceptRe: RegExp, builder: Builder, fileO: File | Directory): File | Directory {
  if (!builder.pathmapper) {
    throw new Error("Do not call check_adjust using a builder that doesn't have a pathmapper.");
  }
  const m = builder.pathmapper.mapper(fileO.location);
  const path1 = m.target;
  fileO['path'] = path1;
  let basename = fileO['basename'];
  const dn = path.dirname(path1);
  const bn = path.basename(path1);
  if (fileO['dirname'] !== dn) {
    fileO['dirname'] = dn.toString();
  }
  if (basename !== bn) {
    basename = bn.toString();
    fileO.basename = basename;
  }
  if (isFile(fileO)) {
    const ne = path.extname(basename);
    const nr = path.basename(basename, ne);
    if (fileO.nameroot !== nr) {
      fileO.nameroot = nr.toString();
    }
    if (fileO.nameext !== ne) {
      fileO.nameext = ne.toString();
    }
  }
  if (!acceptRe.test(basename)) {
    throw new Error(`Invalid filename: ${fileO['basename']} contains illegal characters`);
  }
  return fileO;
}

function checkValidLocations(fsAccess: StdFsAccess, ob: Directory | File): void {
  const location = ob.location;
  if (location.startsWith('_:')) {
    return;
  }
  if (isFile(ob) && !fsAccess.isfile(location)) {
    throw new Error(`Does not exist or is not a File: '${location}'`);
  }
  if (isDirectory(ob) && !fsAccess.isdir(location)) {
    throw new Error(`Does not exist or is not a Directory: '${location}'`);
  }
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
  declare tool: cwl.CommandLineTool;
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
    make_path_mapper: (
      param1: (File | Directory)[],
      param2: string,
      param3: RuntimeContext,
      param4: boolean,
    ) => PathMapper,
    tool: Tool,
    name: string,
  ) => JobBase {
    // placeholder types
    let [dockerReq, dockerRequired] = getRequirement(this.tool, cwl.DockerRequirement);
    if (!dockerReq && runtimeContext.use_container) {
      if (runtimeContext.find_default_container) {
        const default_container = runtimeContext.find_default_container(this);
        if (default_container) {
          dockerReq = new cwl.DockerRequirement({
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
        '--no-container, but this CommandLineTool has ' + "cwl.DockerRequirement under 'requirements'.",
      );
    return (builder, joborder, make_path_mapper, tool, name) =>
      new CommandLineJob(builder, joborder, make_path_mapper, tool, name);
  }

  updatePathmap(outdir: string, pathmap: PathMapper, fn: File | Directory): void {
    if (!(fn instanceof Object)) {
      throw new WorkflowException(`Expected File or Directory object, was ${typeof fn}`);
    }
    const basename = fn.basename;
    if (fn.location) {
      const location = fn.location;
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
    if (isFile(fn)) {
      for (const sf of fn.secondaryFiles || []) {
        this.updatePathmap(outdir, pathmap, sf);
      }
    }
    if (isDirectory(fn)) {
      for (const ls of fn.listing || []) {
        this.updatePathmap(pathJoin(outdir, fn.basename), pathmap, ls);
      }
    }
  }
  async evaluate_listing_string(
    initialWorkdir: cwl.InitialWorkDirRequirement,
    listing: string,
    builder: Builder,
  ): Promise<(File | Directory | Dirent)[]> {
    const ls_evaluated = await builder.do_eval(listing);
    let fail: any = false;
    const fail_suffix = '';
    const results: (File | Directory | Dirent)[] = [];
    if (!(ls_evaluated instanceof Array)) {
      fail = ls_evaluated;
    } else {
      for (const entry of ls_evaluated) {
        if (entry == null) {
          // flowy_cwl only supports cwl1.2 or later, so no need to check classic_dirent
          // if (classic_dirent) {
          //   fail = entry;
          //   fail_suffix =
          //     " Dirent.entry cannot return 'null' before CWL v1.2. Please consider using 'cwl-upgrader' to upgrade your document to CWL version v1.2.";
          // }
        } else if (entry instanceof Array) {
          // flowy_cwl only supports cwl1.2 or later, so no need to check classic_listing
          // if (classic_listing) {
          //   throw new WorkflowException(
          //     "cwl.InitialWorkDirRequirement.listing expressions cannot return arrays of Files or Directories before CWL v1.1. Please considering using 'cwl-upgrader' to upgrade your document to CWL v1.1' or later.",
          //   );
          // }
          for (const entry2 of entry) {
            const result = convertObjectToFileDirectory(entry2);
            if (!result) {
              fail = `an array with an item ('${entry2}') that is not a File nor a Directory object.`;
            } else {
              results.push(result);
            }
          }
        } else {
          const rslt = convertObjectToFileDirectory(entry);
          if (rslt) {
            results.push(rslt);
          } else if (entry instanceof Object && 'entry' in entry) {
            results.push(entry as Dirent);
          } else {
            fail = entry;
          }
        }
      }
    }
    if (fail !== false) {
      let message =
        "Expression in a 'InitialWorkdirRequirement.listing' field must return a list containing zero or more of:" +
        ' File or Directory objects; Dirent objects; null; or arrays of File or Directory objects. ';
      message += `Got ${fail} among the results from `;
      message += `${str(initialWorkdir.listing)}.${fail_suffix}`;
      throw new WorkflowException(message);
    }
    return results;
  }
  async evaluate_listing_expr_or_dirent(
    initialWorkdir: cwl.InitialWorkDirRequirement,
    listing: (string | cwl.File | cwl.Directory | (cwl.File | cwl.Directory)[] | Dirent)[],
    builder: Builder,
  ): Promise<(File | Directory | Dirent)[]> {
    const ls: (File | Directory | Dirent)[] = [];

    for (const t of listing) {
      if (Array.isArray(t)) {
        ls.push(...t.map(convertObjectToFileDirectory));
      } else if (isFileOrDirectory(t)) {
        ls.push(convertObjectToFileDirectory(t));
      } else if (isString(t)) {
        const initwd_item = await builder.do_eval(t);
        if (!initwd_item) {
          continue;
        }
        for (const item of aslist(initwd_item)) {
          const rslt = convertObjectToFileDirectory(item);
          if (rslt) {
            ls.push(rslt);
          } else {
            ls.push({ ...rslt } as Dirent);
          }
        }
      } else {
        const dirent: Dirent = t as Dirent;
        const entry_field = dirent.entry;
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
            if (dirent.entryname) {
              throw new WorkflowException("'entryname' is invalid when 'entry' returns list of File or Directory");
            }
            for (const e of entry) {
              const ec: CWLObjectType = e as CWLObjectType;
              ec['writable'] = t['writable'] || false;
            }
            ls.push(convertDictToFileDirectory(entry));
            continue;
          }
        }
        const et: Dirent = {};
        if (isFileOrDirectory(entry)) {
          et.entry = entry;
        } else {
          if (typeof entry === 'string') {
            et.entry = entry;
          } else {
            et.entry = josonStringifyLikePython(entry);
          }
        }

        if (dirent.entryname) {
          const entryname_field = dirent.entryname;
          if (entryname_field.includes('${') || entryname_field.includes('$(')) {
            const en = await builder.do_eval(dirent.entryname);
            if (typeof en !== 'string') {
              throw new WorkflowException(
                `'entryname' expression must result a string. Got ${en} from ${entryname_field}`,
              );
            }
            et.entryname = en;
          } else {
            et.entryname = entryname_field;
          }
        } else {
          et.entryname = undefined;
        }
        et.writable = t['writable'] || false;
        ls.push(et);
      }
    }
    return ls;
  }
  check_output_items(
    initialWorkdir: cwl.InitialWorkDirRequirement,
    ls: (File | Directory | Dirent)[],
  ): (File | Directory)[] {
    const results: (File | Directory)[] = [];
    for (let i = 0; i < ls.length; i++) {
      const t2 = ls[i];
      if (isFileOrDirectory(t2)) {
        results.push(t2);
        continue;
      }

      // Dirent
      if (typeof t2.entry === 'string') {
        if (!t2.entryname) {
          throw new WorkflowException(`Entry at index ${i} of listing missing entryname`);
        }
        results.push({
          class: 'File',
          basename: t2.entryname,
          contents: t2.entry,
          writable: t2['writable'] || false,
        });
      } else {
        if (!(t2.entry instanceof Object)) {
          throw new WorkflowException(`Entry at index ${i} of listing is not a record, was ${typeof t2['entry']}`);
        }

        if (t2.entryname || t2.writable) {
          const t2entry = cloneDeep(t2.entry);
          if (t2.entryname) {
            t2entry.basename = t2.entryname;
          }
          t2entry.writable = t2.writable;
          results.push(t2entry);
        } else {
          ls.push(t2.entry);
        }
      }
    }
    return results;
  }
  check_output_items2(
    initialWorkdir: cwl.InitialWorkDirRequirement,
    ls: (File | Directory)[],
    cwl_version: string,
    debug: boolean,
  ) {
    for (let i = 0; i < ls.length; i++) {
      const t3 = ls[i];
      // if (!['File', 'Directory'].includes(t3['class'] as string)) {
      //   throw new WorkflowException(
      //     `Entry at index ${i} of listing is not a Dirent, File or ` + `Directory object, was ${t3}.`,
      //   );
      // }
      if (!t3.basename) continue;
      const basename = path.normalize(t3.basename);
      t3.basename = basename;
      if (basename.startsWith('../')) {
        throw new WorkflowException(
          `Name ${basename} at index ${i} of listing is invalid, ` + `cannot start with '../'`,
        );
      }
      if (basename.startsWith('/')) {
        const [req, is_req] = this.getRequirement(cwl.DockerRequirement);
        if (is_req !== true) {
          throw new WorkflowException(
            `Name ${basename} at index ${i} of listing is invalid, ` +
              `name can only start with '/' when cwl.DockerRequirement is in 'requirements'.`,
          );
        }
      }
    }
  }

  setup_output_items(initialWorkdir: cwl.InitialWorkDirRequirement, builder: Builder, ls: (File | Directory)[]): void {
    for (const entry of ls) {
      let dirname: string | undefined = undefined;
      if (entry.basename) {
        const basename = entry.basename;
        entry.basename = path.basename(basename);
        dirname = pathJoin(builder.outdir, path.dirname(basename));
        if (isFile(entry)) {
          entry.dirname = dirname;
        }
      }
      normalizeFilesDirs(entry);
      this.updatePathmap(dirname || builder.outdir, builder.pathmapper, entry);
      if (isDirectory(entry) && entry.listing) {
        function remove_dirname(d: Directory | File): void {
          if ('dirname' in d) {
            delete d['dirname'];
          }
        }

        visitFileDirectory(entry.listing, remove_dirname);
      }

      visitFileDirectory([builder.files, builder.bindings], (val) => checkAdjust(this.path_check_mode, builder, val));
    }
  }

  async _initialworkdir(j: JobBase, builder: Builder): Promise<void> {
    const [initialWorkdir, _] = getRequirement(this.tool, cwl.InitialWorkDirRequirement);
    if (initialWorkdir == undefined) {
      return;
    }
    const debug = _logger.isDebugEnabled();

    let ls: (File | Directory | Dirent)[] = [];
    const listing = initialWorkdir.listing;
    if (typeof listing === 'string') {
      ls = await this.evaluate_listing_string(initialWorkdir, listing, builder);
    } else {
      ls = await this.evaluate_listing_expr_or_dirent(initialWorkdir, listing, builder);
    }

    const ls2 = this.check_output_items(initialWorkdir, ls);

    this.check_output_items2(initialWorkdir, ls2, 'cwl_version', debug);

    j.generatefiles.listing = ls2;
    this.setup_output_items(initialWorkdir, builder, ls2);
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
    // let [docker_req, ] = this.get_requirement("cwl.DockerRequirement");
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
    //     "cwl.DockerRequirement",
    //     "EnvVarRequirement",
    //     "cwl.InitialWorkDirRequirement",
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
    const [timelimit, _] = getRequirement(this, cwl.ToolTimeLimit);
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
    const [networkaccess, _] = getRequirement(this.tool, cwl.NetworkAccess);
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
    const [evr, _] = getRequirement(this, cwl.EnvVarRequirement);
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
    const [shellcmd, _] = getRequirement(this.tool, cwl.ShellCommandRequirement);
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
    const [workReuse] = getRequirement(this.tool, cwl.WorkReuse);
    const enableReuse = workReuse ? workReuse.enableReuse : true;

    const jobname = uniquename(runtimeContext.name || shortname(this.tool.id || 'job'));
    if (runtimeContext.cachedir && enableReuse) {
      output_callbacks = this.cache_context(runtimeContext);
      if (output_callbacks) {
        return;
      }
    }
    const builder = await this._init_job(job_order, runtimeContext);

    const reffiles = cloneDeep(builder.files);
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

    visitFileDirectory([builder.files, builder.bindings], _check_adjust);

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

    const [dockerReq] = getRequirement(this.tool, cwl.DockerRequirement);
    if (dockerReq && runtimeContext.use_container) {
      j.outdir = runtimeContext.getOutdir();
      j.tmpdir = runtimeContext.getTmpdir();
      j.stagedir = runtimeContext.createTmpdir();
    } else {
      j.outdir = builder.outdir;
      j.tmpdir = builder.tmpdir;
      j.stagedir = builder.stagedir;
    }

    const [inplaceUpdateReq, _] = getRequirement(this.tool, cwl.InplaceUpdateRequirement);
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
    builder.resources['exitCode'] = rcode;

    try {
      const fs_access = new builder.make_fs_access(outdir);
      const custom_output = fs_access.join(outdir, 'cwl.output.json');
      if (fs_access.exists(custom_output)) {
        const f = await fs_access.read(custom_output);
        ret = JSON.parse(f);
        if (debug) {
          _logger.debug(`Raw output from ${custom_output}: ${JSON.stringify(ret, null, 4)}`);
        }
        convertDictToFileDirectory(ret);
      } else if (Array.isArray(ports)) {
        for (let i = 0; i < ports.length; i++) {
          const port = ports[i];
          const fragment = shortname(port.id);
          ret[fragment] = await this.collect_output(port, builder, outdir, fs_access, compute_checksum);
        }
      }
      if (ret) {
        const revmap = (val) => revmap_file(builder, outdir, val);
        // adjustDirObjs(ret, trim_listing);
        visitFileDirectory(ret, revmap);
        visitFileDirectory(ret, remove_path);
        normalizeFilesDirs(ret);
        visitFileDirectory(ret, (val) => checkValidLocations(fs_access, val));

        if (compute_checksum) {
          adjustFileObjs(ret, async (val) => compute_checksums(fs_access, val));
        }
        // const expected_schema = ((this.names.get_name("outputs_record_schema", null)) as Schema);
        validate(this.outputs_record_schema.type, ret, true);
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
    binding: CommandOutputBinding,
    debug: boolean,
    outdir: string,
    fs_access: StdFsAccess,
    compute_checksum: boolean,
    revmap,
  ): Promise<[CWLOutputType[], string[]]> {
    const r: CWLOutputType[] = [];
    const globpatterns: string[] = [];

    if (!binding.glob) {
      return [r, globpatterns];
    }

    try {
      for (const g of aslist(binding.glob)) {
        const gb = await builder.do_eval(g);
        if (gb) {
          const gb_eval_fail = false;
          if (isStringOrStringArray(gb)) {
            globpatterns.push(...aslist(gb));
          } else {
            throw new WorkflowException(
              'Resolved glob patterns must be strings or list of strings, not ' + `${gb} from ${binding.glob}`,
            );
          }
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
            ...sorted_glob_result.map((g) => {
              const decoded_basename = path.basename(g);
              return fs_access.isfile(g)
                ? {
                    class: 'File',
                    location: g,
                    path: fs_access.join(builder.outdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
                    basename: decoded_basename,
                    nameroot: splitext(decoded_basename)[0],
                    nameext: splitext(decoded_basename)[1],
                  }
                : {
                    class: 'Directory',
                    location: g,
                    path: fs_access.join(builder.outdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
                    basename: decoded_basename,
                  };
            }),
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
            const f: any = undefined;
            try {
              files['contents'] = await contentLimitRespectedReadBytes(rfile['location']);
            } finally {
              if (f) {
                f.close();
              }
            }
          }

          if (compute_checksum) {
            await compute_checksums(fs_access, rfile);
            files['checksum'] = rfile['checksum'];
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
          if (sf.required) {
            const sf_required_eval = await builder.do_eval(sf.required, primary);
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
            sfpath = await builder.do_eval(sf['pattern'], primary);
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
  async handle_output_format(schema: CommandOutputParameter, builder: Builder, result: CWLOutputType): Promise<void> {
    if (schema.format) {
      const format_field: string = schema.format;
      if (format_field.includes('$(') || format_field.includes('${')) {
        const results = aslist(result);
        for (let index = 0; index < results.length; index++) {
          const primary = results[index];
          const format_eval: any = await builder.do_eval(format_field, primary);
          if (typeof format_eval !== 'string') {
            let message = `'format' expression must evaluate to a string. Got ${format_eval} from ${format_field}.`;
            if (Array.isArray(result)) {
              message += ` 'self' had the value of the index ${index} result: ${primary}.`;
            }
            throw new WorkflowException(message);
          }
          primary['format'] = format_eval;
        }
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
        result = await builder.do_eval(binding.outputEval, r);
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
      await this.handle_output_format(schema, builder, result);
      adjustFileObjs(result, revmap);
      if (optional && (!result || (result instanceof Array && result.length === 0))) {
        return result === 0 || result === '' ? result : null;
      }
    }
    if (!result && !empty_and_optional && typeof schema.type === 'object' && schema.type['type'] === 'record') {
      const out = {};
      for (const field of schema['type']['fields'] as CWLObjectType[]) {
        out[shortname(field['name'] as string)] = await this.collect_output(
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
