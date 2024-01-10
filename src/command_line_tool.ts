import * as path from 'node:path';
import * as cwl from 'cwl-ts-auto';
import { cloneDeep } from 'lodash-es';
import { v4 as uuidv4 } from 'uuid';

import { Builder } from './builder.js';
import { collect_output_ports } from './collect_outputs.js';
import { LoadingContext, RuntimeContext, getDefault } from './context.js';
import { CommandInputParameter, CommandOutputParameter, Directory, File, Tool } from './cwltypes.js';
import { DockerCommandLineJob, PodmanCommandLineJob } from './docker.js';
import { UnsupportedRequirement, WorkflowException } from './errors.js';
import { pathJoin } from './fileutils.js';
import { CommandLineJob, JobBase } from './job.js';
import { _logger } from './loghandler.js';
import { convertObjectToFileDirectory } from './main.js';
import { PathMapper } from './pathmapper.js';
import { Process, shortname, uniquename } from './process.js';
import { type ToolRequirement } from './types.js';
import {
  type CWLObjectType,
  type CWLOutputType,
  type JobsGeneratorType,
  type OutputCallbackType,
  aslist,
  isString,
  normalizeFilesDirs,
  quote,
  getRequirement,
  josonStringifyLikePython,
  visitFileDirectory,
  str,
  isDirectory,
  isFileOrDirectory,
  isFile,
} from './utils.js';

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
  }

  async run(runtimeContext: RuntimeContext, tmpdir_lock: any | null = null) {
    try {
      normalizeFilesDirs(this.builder.job);
      const ev = await this.builder.do_eval(this.script);
      normalizeFilesDirs(ev);

      if (this.output_callback) {
        this.output_callback(ev as CWLObjectType, 'success');
      }
    } catch (err) {
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
    yield job;
  }
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
            if (isFileOrDirectory(entry2)) {
              results.push(entry2);
            } else {
              fail = `an array with an item ('${str(entry2)}') that is not a File nor a Directory object.`;
            }
          }
        } else {
          if (isFileOrDirectory(entry)) {
            results.push(entry);
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
      } else if (t instanceof cwl.File || t instanceof cwl.Directory) {
        ls.push(convertObjectToFileDirectory(t));
      } else if (isString(t)) {
        const initwd_item = await builder.do_eval(t);
        if (!initwd_item) {
          continue;
        }
        for (const item of aslist(initwd_item)) {
          if (isFileOrDirectory(item)) {
            ls.push(item);
          } else {
            ls.push(item as Dirent);
          }
        }
      } else {
        const dirent: Dirent = t;
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
          const filelist = entry.every(isFileOrDirectory);
          if (filelist) {
            if (dirent.entryname) {
              throw new WorkflowException("'entryname' is invalid when 'entry' returns list of File or Directory");
            }
            for (const e of entry) {
              e.writable = t['writable'] || false;
              ls.push(e);
            }
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
        entry.dirname = dirname;
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
  async handle_tool_time_limit(builder: Builder, j: JobBase): Promise<void> {
    const [timelimit, _] = getRequirement(this, cwl.ToolTimeLimit);
    if (timelimit == undefined) {
      return;
    }

    const limit_field = timelimit.timelimit;
    let timelimit_eval: number | undefined = undefined;
    if (typeof limit_field === 'string') {
      const time_eval = await builder.do_eval(limit_field);
      if (time_eval) {
        if (typeof time_eval === 'number') {
          timelimit_eval = time_eval;
        } else {
          throw new WorkflowException(
            `'timelimit' expression must evaluate to a long/int. Got 
                ${str(time_eval)} for expression ${limit_field}.`,
          );
        }
      }
    } else if (typeof limit_field === 'number') {
      timelimit_eval = limit_field;
    }
    if (typeof timelimit_eval !== 'number' || timelimit_eval < 0) {
      throw new WorkflowException(`timelimit must be an integer >= 0, got: ${timelimit_eval}`);
    }
    j.timelimit = timelimit_eval;
  }

  async handle_network_access(builder: Builder, j: JobBase): Promise<void> {
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
                Got ${str(networkaccess_eval)} for expression ${networkaccess_field}.`,
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
  async handle_env_var(builder: Builder): Promise<Record<string, string>> {
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
              `Got ${str(env_value_eval)} for expression ${env_value_field}.`,
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
  async setup_command_line(builder: Builder, j: JobBase) {
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

  async setup_std_io(builder: Builder, j: JobBase, reffiles: (File | Directory)[]): Promise<void> {
    if (this.tool.stdin) {
      const stdin_eval = await builder.do_eval(this.tool['stdin']);
      if (!(typeof stdin_eval === 'string' || stdin_eval === null)) {
        throw new Error(
          `'stdin' expression must return a string or null. Got ${str(stdin_eval)} for ${this.tool['stdin']}.`,
        );
      }
      j.stdin = stdin_eval as string;
      if (j.stdin) {
        reffiles.push({ class: 'File', path: j.stdin });
      }
    }

    if (this.tool.stderr) {
      const stderr_eval = await builder.do_eval(this.tool.stderr);
      if (typeof stderr_eval !== 'string') {
        throw new Error(
          `'stderr' expression must return a string. Got ${str(stderr_eval)} for ${this.tool['stderr']}.`,
        );
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
        throw new Error(
          `'stdout' expression must return a string. Got ${str(stdout_eval)} for ${this.tool['stdout']}.`,
        );
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
    output_callbacks: OutputCallbackType | null,
    runtimeContext: RuntimeContext,
  ): AsyncGenerator<JobBase> {
    // const [workReuse] = getRequirement(this.tool, cwl.WorkReuse);
    // const enableReuse = workReuse ? workReuse.enableReuse : true;

    const jobname = uniquename(runtimeContext.name || shortname(this.tool.id || 'job'));
    // cache not supported currently
    // if (runtimeContext.cachedir && enableReuse) {
    //   output_callbacks = this.cache_context(runtimeContext);
    //   if (output_callbacks) {
    //     return;
    //   }
    // }
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
          builder.pathmapper.files().reduce((obj, p) => {
            obj[p] = builder.pathmapper.mapper(p);
            return obj;
          }, {}),
          null,
          4,
        )}`,
      );
    }

    await this.setup_std_io(builder, j, reffiles);

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

    await this.handle_tool_time_limit(builder, j);

    await this.handle_network_access(builder, j);

    const required_env = await this.handle_env_var(builder);
    j.prepare_environment(runtimeContext, required_env);

    await this.setup_command_line(builder, j);

    j.pathmapper = builder.pathmapper;
    j.collect_outputs = async (outdir, rcode, fileMap) =>
      collect_output_ports(
        this.tool.outputs,
        this.outputs_record_schema.type.fields,
        builder,
        outdir,
        rcode,
        fileMap,
        jobname,
      );
    j.output_callback = output_callbacks;

    // this.handle_mpi_require(runtimeContext, builder, j, debug);
    yield j;
  }
}
