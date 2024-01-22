import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DockerRequirement, ShellCommandRequirement } from 'cwl-ts-auto';
import { v4 as uuidv4 } from 'uuid';
import { OutputBinding, OutputSecondaryFile } from './JobExecutor.js';
import { Builder } from './builder.js';
import { OutputPortsType } from './collect_outputs.js';
import { RuntimeContext } from './context.js';
import {
  CommandOutputParameter,
  Directory,
  File,
  SecondaryFileSchema,
  Tool,
  isCommandOutputRecordSchema,
} from './cwltypes.js';
import { UnsupportedRequirement, ValueError, WorkflowException } from './errors.js';
import { removeIgnorePermissionError } from './fileutils.js';
import { _logger } from './loghandler.js';
import { MakePathMapper, MapperEnt, PathMapper } from './pathmapper.js';
import { stage_files } from './process.js';
import { SecretStore } from './secrets.js';
import { getServer } from './server/server.js';
import { LazyStaging } from './staging.js';
import {
  type CWLObjectType,
  type OutputCallbackType,
  createTmpDir,
  getRequirement,
  str,
  quote,
  aslist,
  isStringOrStringArray,
} from './utils.js';

function relink_initialworkdir_lazy(
  staging: LazyStaging,
  pathmapper: PathMapper,
  host_outdir: string,
  container_outdir: string,
  inplace_update = false,
) {
  for (const [_key, vol] of pathmapper.items_exclude_children()) {
    if (!vol.staged) {
      continue;
    }
    if (
      ['File', 'Directory'].includes(vol.type) ||
      (inplace_update && ['WritableFile', 'WritableDirectory'].includes(vol.type))
    ) {
      if (!vol.target.startsWith(container_outdir)) {
        continue;
      }
      const host_outdir_tgt = path.join(host_outdir, vol.target.substr(container_outdir.length + 1));
      staging.relink(vol.resolved, host_outdir_tgt);
    }
  }
}

export async function _job_popen(
  staging: LazyStaging,
  commands: string[],
  stdin_path: string | undefined,
  stdout_path: string | undefined,
  stderr_path: string | undefined,
  env: { [key: string]: string },
  cwd: string,
  builder: Builder,
  outputBindings: OutputBinding[],
  fileitems: MapperEnt[],
  generatedlist: MapperEnt[],
  make_job_dir: () => string,
  inplace_update: boolean,
  timelimit: number | undefined = undefined,
): Promise<[number, boolean, OutputPortsType]> {
  const id = uuidv4();
  const server = getServer();
  server.addBuilder(id, builder);
  return server.execute(id, {
    id,
    staging: staging.commands,
    commands,
    stdin_path,
    stdout_path,
    stderr_path,
    env,
    cwd,
    builderOutdir: builder.outdir,
    outputBindings,
    fileitems,
    generatedlist,
    timelimit,
    inplace_update,
  });
}
type CollectOutputsType = (
  str: string,
  int: number,
  isCwlOutput: boolean,
  results: OutputPortsType,
) => Promise<CWLObjectType>; // Assuming functools.partial as any
export abstract class JobBase {
  builder: Builder;
  staging: LazyStaging = new LazyStaging();
  base_path_logs: string;
  joborder: CWLObjectType;
  make_path_mapper: MakePathMapper;
  tool: Tool;
  name: string;
  stdin?: string;
  stderr?: string;
  stdout?: string;
  successCodes: number[];
  temporaryFailCodes: number[];
  permanentFailCodes: number[];
  command_line: string[];
  pathmapper: PathMapper;
  generatemapper?: PathMapper;
  collect_outputs?: CollectOutputsType;
  output_callback?: OutputCallbackType;
  outdir: string;
  tmpdir: string;
  environment: { [key: string]: string };
  generatefiles: Directory = { listing: [], basename: '', class: 'Directory' };
  stagedir?: string;
  inplace_update: boolean;
  prov_obj?: any; // ProvenanceProfile;
  parent_wf?: any; // ProvenanceProfile;
  timelimit?: number;
  networkaccess: boolean;
  mpi_procs?: number;

  constructor(
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
  ) {
    this.builder = builder;
    this.joborder = joborder;
    // TODO
    this.base_path_logs = '/tmp';
    this.stdin = undefined;
    this.stderr = undefined;
    this.stdout = undefined;
    this.successCodes = [];
    this.temporaryFailCodes = [];
    this.permanentFailCodes = [];
    this.tool = tool;
    this.name = name;
    this.command_line = [];
    this.pathmapper = new PathMapper([], '', '');
    this.make_path_mapper = make_path_mapper;
    this.generatemapper = undefined;
    this.collect_outputs = undefined;
    this.output_callback = undefined;
    this.outdir = '';
    this.tmpdir = '';
    this.environment = {};
    this.inplace_update = false;
    this.prov_obj = undefined;
    this.parent_wf = undefined;
    this.timelimit = undefined;
    this.networkaccess = false;
    this.mpi_procs = undefined;
  }

  toString(): string {
    return `CommandLineJob(${this.name})`;
  }
  abstract run(runtimeContext: RuntimeContext): void;

  _setup(runtimeContext: RuntimeContext): void {
    // cuda not supported now
    // let cuda_req;
    // [cuda_req, _] = this.builder.get_requirement("http://commonwl.org/cwltool#CUDARequirement");
    // if (cuda_req) {
    //     let count = cuda_check(cuda_req, Math.ceil(this.builder.resources["cudaDeviceCount"]));
    //     if (count === 0) throw new WorkflowException("Could not satisfy CUDARequirement");
    // }
    if (!fs.existsSync(this.outdir)) fs.mkdirSync(this.outdir, { recursive: true });

    const is_streamable = (file: string): boolean => {
      if (!runtimeContext.streaming_allowed) return false;
      for (const inp of Object.values(this.joborder)) {
        if (typeof inp === 'object' && inp['location'] == file) return inp['streamable'];
      }
      return false;
    };

    for (const knownfile of this.pathmapper.files()) {
      const p = this.pathmapper.mapper(knownfile);
      if (p.type == 'File' && p.resolved.startsWith('file:/') && !fs.existsSync(p.resolved) && p.staged) {
        if (!(is_streamable(knownfile) && fs.statSync(p.resolved).isFIFO())) {
          throw new WorkflowException(
            `Input file ${knownfile} (at ${
              this.pathmapper.mapper(knownfile).resolved
            }) not found or is not a regular file.`,
          );
        }
      }
    }

    if (this.generatefiles.listing) {
      runtimeContext.outdir = this.outdir;
      this.generatemapper = this.make_path_mapper(
        this.generatefiles.listing,
        this.builder.outdir,
        runtimeContext,
        false,
      );
      // if (_logger.isEnabledFor(logging.DEBUG)) {
      //     _logger.debug(
      //         "[job %s] initial work dir %s",
      //         this.name,
      //         JSON.stringify({ p: this.generatemapper.mapper(p) for(p of this.generatemapper.files()) }, null, 4),
      //     );
      // }
    }
    this.base_path_logs = runtimeContext.set_log_dir(this.outdir, runtimeContext.log_dir, this.name);
  }
  async _execute(
    runtime: string[],
    env: { [id: string]: string },
    runtimeContext: RuntimeContext,
    monitor_function: ((popen: any) => void) | null = null,
  ) {
    const scr = getRequirement(this.tool, ShellCommandRequirement)[0];

    const shouldquote = scr !== null;
    // TODO mpi not supported
    // if (this.mpi_procs) {
    //   const menv = runtimeContext.mpi_config;
    //   const mpi_runtime = [menv.runner, menv.nproc_flag, this.mpi_procs.toString(), ...menv.extra_flags];
    //   runtime = [...mpi_runtime, ...runtime];
    //   menv.pass_through_env_vars(env);
    //   menv.set_env_vars(env);
    // }
    const command_line = runtime
      .concat(this.command_line)
      .map((arg) => (shouldquote ? quote(arg.toString()) : arg.toString())) // TODO
      .join(' \\\n');
    const tmp2 = [
      this.stdin ? ` < ${this.stdin}` : '',
      this.stdout ? ` > ${path.join(this.base_path_logs, this.stdout)}` : '',
      this.stderr ? ` 2> ${path.join(this.base_path_logs, this.stderr)}` : '',
    ];
    _logger.info(`[job ${this.name}] %${this.outdir}$ ${command_line} ${tmp2[0]} ${tmp2[1]} ${tmp2[2]}`);
    let outputs: any = {};
    let processStatus = '';
    try {
      let stdin_path: string | undefined;
      if (this.stdin !== undefined) {
        const rmap = this.pathmapper.reversemap(this.stdin);
        if (rmap === undefined) {
          throw new WorkflowException(`${this.stdin} missing from pathmapper`);
        } else {
          stdin_path = rmap[1];
        }
      }

      const stderr_stdout_log_path = (
        base_path_logs: string,
        stderr_or_stdout: string | undefined,
      ): string | undefined => {
        if (stderr_or_stdout !== undefined) {
          const abserr = path.join(base_path_logs, stderr_or_stdout);
          const dnerr = path.dirname(abserr);
          if (dnerr && !fs.existsSync(dnerr)) {
            fs.mkdirSync(dnerr, { recursive: true });
          }
          return abserr;
        }
        return undefined;
      };

      const stderr_path = stderr_stdout_log_path(this.base_path_logs, this.stderr);
      const stdout_path = stderr_stdout_log_path(this.base_path_logs, this.stdout);
      let commands = runtime.concat(this.command_line).map((x) => x.toString());
      if (runtimeContext.secret_store !== undefined) {
        commands = runtimeContext.secret_store.retrieve(commands as any) as string[];
        env = runtimeContext.secret_store.retrieve(env as any) as { [id: string]: string };
      }
      const fileitems: MapperEnt[] = [];
      if (this.builder.pathmapper) {
        for (const [_, item] of this.builder.pathmapper.items()) {
          fileitems.push(item);
        }
      }
      const generatedlist: MapperEnt[] = [];
      if (this.generatefiles.listing) {
        if (this.generatemapper) {
          generatedlist.push(...this.generatemapper.items_exclude_children().map(([_key, value]) => value));
        } else {
          throw new ValueError(`'listing' in self.generatefiles but no generatemapper was setup.`);
        }
      }
      const outputBindings = await createOutputBinding(this.tool.outputs, this.builder);
      const [rcode, isCwlOutput, fileMap] = await _job_popen(
        this.staging,
        commands,
        stdin_path,
        stdout_path,
        stderr_path,
        env,
        this.outdir,
        this.builder,
        outputBindings,
        fileitems,
        generatedlist,
        () => runtimeContext.createOutdir(),
        this.inplace_update,
        this.timelimit,
      );
      if (this.successCodes.includes(rcode)) {
        processStatus = 'success';
      } else if (this.temporaryFailCodes.includes(rcode)) {
        processStatus = 'temporaryFail';
      } else if (this.permanentFailCodes.includes(rcode)) {
        processStatus = 'permanentFail';
      } else if (rcode === 0) {
        processStatus = 'success';
      } else {
        processStatus = 'permanentFail';
      }

      if (processStatus !== 'success') {
        if (rcode < 0) {
          _logger.warn(`[job ${this.name}] was terminated by signal:`);
        } else {
          _logger.warn(`[job ${this.name}] exited with status: ${rcode}`);
        }
      }

      runtimeContext.log_dir_handler(this.outdir, this.base_path_logs, stdout_path, stderr_path);
      outputs = await this.collect_outputs(this.outdir, rcode, isCwlOutput, fileMap);
      // outputs = bytes2str_in_dicts(outputs);
      // } catch (e) {
      //     if (e.errno == 2) {
      //         if (runtime) {
      //             _logger.error(`'${runtime[0]}' not found: ${e}`);
      //         } else {
      //             _logger.error(`'${this.command_line[0]}' not found: ${e}`);
      //         }
      //     } else {
      //         new Error("Exception while running job");

      //     }
      //     processStatus = "permanentFail";
    } catch (err) {
      if (err instanceof Error) {
        _logger.error(`[job ${this.name}] Job error${err.message}\n${err.stack}`);
      }
      processStatus = 'permanentFail';
    }
    //  catch {
    //     _logger.exception("Exception while running job");
    //     processStatus = "permanentFail";
    // }
    if (
      runtimeContext.research_obj !== undefined &&
      this.prov_obj !== undefined &&
      runtimeContext.process_run_id !== undefined
    ) {
      // creating entities for the outputs produced by each step (in the provenance document)
      this.prov_obj.record_process_end(String(this.name), runtimeContext.process_run_id, outputs, new Date());
    }
    if (processStatus !== 'success') {
      _logger.warn(`[job ${this.name}] completed ${processStatus}`);
    } else {
      _logger.info(`[job ${this.name}] completed ${processStatus}`);
    }

    if (_logger.isDebugEnabled()) {
      _logger.debug(`[job ${this.name}] outputs ${JSON.stringify(outputs, null, 4)}`);
    }

    if (this.generatemapper !== null && runtimeContext.secret_store !== null) {
      // TODO
      // Delete any runtime-generated files containing secrets.
      // for (let _, p of Object.entries(this.generatemapper)) {
      //     if (p.type === "CreateFile") {
      //         if (runtimeContext.secret_store.has_secret(p.resolved)) {
      //             let host_outdir = this.outdir;
      //             let container_outdir = this.builder.outdir;
      //             let host_outdir_tgt = p.target;
      //             if (p.target.startsWith(container_outdir + "/")) {
      //                 host_outdir_tgt = path.join(
      //                     host_outdir, p.target.slice(container_outdir.length + 1)
      //                 );
      //             }
      //             fs.unlinkSync(host_outdir_tgt);
      //         }
      //     }
      // }
    }

    if (runtimeContext.workflow_eval_lock === null) {
      throw new Error('runtimeContext.workflow_eval_lock must not be None');
    }

    if (this.output_callback) {
      this.output_callback(outputs, processStatus);
    }

    if (runtimeContext.rm_tmpdir && this.stagedir !== undefined && fs.existsSync(this.stagedir)) {
      _logger.debug(`[job ${this.name}] Removing input staging directory ${this.stagedir}`);
      await removeIgnorePermissionError(this.stagedir);
    }

    if (runtimeContext.rm_tmpdir) {
      _logger.debug(`[job ${this.name}] Removing temporary directory ${this.tmpdir}`);
      await removeIgnorePermissionError(this.tmpdir);
    }
  }
  abstract _required_env(): Record<string, string>;

  _preserve_environment_on_containers_warning(varname?: Iterable<string>): void {
    // By default, don't do anything; ContainerCommandLineJob below
    // will issue a warning.
  }

  prepare_environment(runtimeContext: any, envVarReq: Record<string, string>): void {
    // Start empty
    const env: Record<string, string> = {};

    // Preserve any env vars
    if (runtimeContext.preserve_entire_environment) {
      this._preserve_environment_on_containers_warning();
      Object.assign(env, process.env);
    } else if (runtimeContext.preserve_environment) {
      this._preserve_environment_on_containers_warning(runtimeContext.preserve_environment);
      for (const key of runtimeContext.preserve_environment) {
        if (process.env[key]) {
          env[key] = process.env[key];
        } else {
          console.warn(`Attempting to preserve environment variable ${key} which is not present`);
        }
      }
    }

    // Set required env vars
    Object.assign(env, this._required_env());

    // Apply EnvVarRequirement
    Object.assign(env, envVarReq);

    // Set on ourselves
    this.environment = env;
  }
  process_monitor(sproc: any): void {
    // TODO
    // let monitor = psutil.Process(sproc.pid);
    // let memory_usage: (number | null)[] = [null];
    // let get_tree_mem_usage = function(memory_usage: (number | null)[]) {
    //     let children = monitor.children();
    //     try {
    //         let rss = monitor.memory_info().rss;
    //         while (children.length) {
    //             rss += children.reduce((sum, process) => sum + process.memory_info().rss, 0);
    //             children = [].concat(...children.map(process => process.children()));
    //         }
    //         if (memory_usage[0] === null || rss > memory_usage[0]) {
    //             memory_usage[0] = rss;
    //         }
    //     } catch (e) {
    //         if (e instanceof psutil.NoSuchProcess) {
    //             mem_tm.cancel();
    //         }
    //     }
    // };
    // let mem_tm = new Timer(1, get_tree_mem_usage, memory_usage);
    // mem_tm.daemon = true;
    // mem_tm.start();
    // sproc.wait();
    // mem_tm.cancel();
    // if (memory_usage[0] !== null) {
    //     _logger.info("[job ${this.name}] Max memory used: ${Math.round(memory_usage[0] / (2**20))}MiB");
    // } else {
    //     _logger.debug('Could not collect memory usage, job ended before monitoring began.');
    // }
  }
}
async function createOutputBinding(outputs: CommandOutputParameter[], builder: Builder): Promise<OutputBinding[]> {
  const outputBindings: OutputBinding[] = [];
  for (const output of outputs) {
    const outputType = output.type;
    if (isCommandOutputRecordSchema(outputType)) {
      const obs = await createOutputBinding(outputType.fields, builder);
      outputBindings.push(...obs);
    }
    if (output.outputBinding) {
      const globpatterns: string[] = [];
      for (const glob of aslist(output.outputBinding.glob)) {
        const gb = await builder.do_eval(glob);
        if (gb) {
          if (isStringOrStringArray(gb)) {
            globpatterns.push(...aslist(gb));
          } else {
            throw new WorkflowException(
              'Resolved glob patterns must be strings or list of strings, not ' +
                `${str(gb)} from ${str(output.outputBinding.glob)}`,
            );
          }
        }
      }
      const binding: OutputBinding = {
        name: output.name,
        glob: globpatterns,
        secondaryFiles: aslist(output.secondaryFiles).map(convertSecondaryFiles),
        outputEval: output.outputBinding.outputEval,
        loadListing: output.outputBinding.loadListing,
        loadContents: output.outputBinding.loadContents ?? false,
      };
      outputBindings.push(binding);
    }
  }
  return outputBindings;
}
function convertSecondaryFiles(file: SecondaryFileSchema): OutputSecondaryFile {
  if (typeof file.required === 'string') {
    return { pattern: file.pattern, requiredString: file.required };
  } else if (typeof file.required === 'boolean') {
    return { pattern: file.pattern, requiredBoolean: file.required };
  } else {
    return { pattern: file.pattern };
  }
}

export class CommandLineJob extends JobBase {
  async run(runtimeContext: RuntimeContext, tmpdir_lock?: any): Promise<void> {
    if (tmpdir_lock) {
      // assuming tmpdir_lock has a context equivalent
      tmpdir_lock.run(() => {
        if (!fs.existsSync(this.tmpdir)) {
          fs.mkdirSync(this.tmpdir, { recursive: true });
        }
      });
    } else {
      if (!fs.existsSync(this.tmpdir)) {
        fs.mkdirSync(this.tmpdir, { recursive: true });
      }
    }

    this._setup(runtimeContext);

    stage_files(this.staging, this.pathmapper, null, {
      ignore_writable: true,
      symlink: true,
      secret_store: runtimeContext.secret_store,
    });
    if (this.generatemapper) {
      stage_files(this.staging, this.generatemapper, null, {
        ignore_writable: this.inplace_update,
        symlink: true,
        secret_store: runtimeContext.secret_store,
      });
      relink_initialworkdir_lazy(
        this.staging,
        this.generatemapper,
        this.outdir,
        this.builder.outdir,
        this.inplace_update,
      );
    }

    const monitor_function = this.process_monitor.bind(this);

    await this._execute([], this.environment, runtimeContext, monitor_function);
  }

  _required_env(): { [key: string]: string } {
    const env: { [key: string]: string } = {};
    env['HOME'] = this.outdir;
    env['TMPDIR'] = this.tmpdir;
    env['PATH'] = process.env['PATH'];
    for (const extra of ['SYSTEMROOT', 'QEMU_LD_PREFIX']) {
      if (extra in process.env) {
        env[extra] = process.env[extra];
      }
    }
    return env;
  }
}

const CONTROL_CODE_RE = '\\x1b\\[[0-9;]*[a-zA-Z]';

export abstract class ContainerCommandLineJob extends JobBase {
  static readonly CONTAINER_TMPDIR: string = '/tmp';

  abstract get_from_requirements(
    r: any,
    pull_image: boolean,
    force_pull: boolean,
    tmp_outdir_prefix: string,
  ): Promise<string | undefined>;

  abstract create_runtime(env: { [key: string]: string }, runtime_context: RuntimeContext): [string[], string | null];

  abstract append_volume(runtime: string[], source: string, target: string, writable: boolean): void;

  abstract add_file_or_directory_volume(runtime: string[], volume: MapperEnt, host_outdir_tgt: string | null): void;

  abstract add_writable_file_volume(
    runtime: string[],
    volume: MapperEnt,
    host_outdir_tgt: string | undefined,
    tmpdir_prefix: string,
  ): void;

  abstract add_writable_directory_volume(
    runtime: string[],
    volume: MapperEnt,
    host_outdir_tgt: string | undefined,
    tmpdir_prefix: string,
  ): void;

  override _preserve_environment_on_containers_warning(varnames: string[] = []) {
    let flags: string;
    if (varnames.length === 0) {
      flags = '--preserve-entire-environment';
    } else {
      flags = `--preserve-environment={${varnames.join(', ')}}`;
    }

    console.warn(
      `You have specified ${flags} while running a container which will override variables set in the container. This may break the container, be non-portable, and/or affect reproducibility.`,
    );
  }
  create_file_and_add_volume(
    runtime: string[],
    volume: MapperEnt,
    host_outdir_tgt: string,
    secret_store: SecretStore,
    tmpdir_prefix: string,
  ): string {
    let new_file = '';
    if (!host_outdir_tgt) {
      new_file = path.join(createTmpDir(tmpdir_prefix), path.basename(volume.target));
    }
    const writable = volume.type === 'CreateWritableFile';
    let contents = volume.resolved;
    if (secret_store) {
      contents = secret_store.retrieve(volume.resolved) as string;
    }
    const dirname = path.dirname(host_outdir_tgt || new_file);
    this.staging.mkdirSync(dirname, true);
    this.staging.writeFileSync(host_outdir_tgt || new_file, contents, 0o755, { ensureWritable: writable });
    if (!host_outdir_tgt) {
      this.append_volume(runtime, new_file, volume.target, writable);
    }
    return host_outdir_tgt || new_file;
  }
  add_volumes(
    pathmapper: PathMapper,
    runtime: string[],
    tmpdir_prefix: string,
    secret_store: SecretStore, // TODO SecretStore | null = null,
    any_path_okay = false,
  ): void {
    const container_outdir = this.builder.outdir;
    for (const [key, vol] of [...pathmapper.items().filter((itm) => itm[1].staged)]) {
      let host_outdir_tgt: string | undefined = undefined;
      if (vol.target.startsWith(`${container_outdir}/`)) {
        host_outdir_tgt = path.join(this.outdir, vol.target.slice(container_outdir.length + 1));
      }
      if (!host_outdir_tgt && !any_path_okay) {
        throw new WorkflowException(
          `No mandatory DockerRequirement, yet path is outside ` +
            `the designated output directory, also know as ` +
            `${runtime.join(', ')}: ${str(vol)}`,
        );
      }
      if (vol.type === 'File' || vol.type === 'Directory') {
        this.add_file_or_directory_volume(runtime, vol, host_outdir_tgt);
      } else if (vol.type === 'WritableFile') {
        this.add_writable_file_volume(runtime, vol, host_outdir_tgt, tmpdir_prefix);
      } else if (vol.type === 'WritableDirectory') {
        this.add_writable_directory_volume(runtime, vol, host_outdir_tgt, tmpdir_prefix);
      } else if (['CreateFile', 'CreateWritableFile'].includes(vol.type)) {
        const new_path = this.create_file_and_add_volume(runtime, vol, host_outdir_tgt, secret_store, tmpdir_prefix);
        pathmapper.update(key, new_path, vol.target, vol.type, vol.staged);
      }
    }
  }
  async run(runtimeContext: RuntimeContext, tmpdir_lock?: any): Promise<void> {
    const debug = runtimeContext.debug;
    if (tmpdir_lock) {
      tmpdir_lock(() => {
        if (!fs.existsSync(this.tmpdir)) {
          fs.mkdirSync(this.tmpdir);
        }
      });
    } else {
      if (!fs.existsSync(this.tmpdir)) {
        fs.mkdirSync(this.tmpdir);
      }
    }

    const [docker_req, docker_is_req] = getRequirement(this.tool, DockerRequirement);
    let img_id: any = undefined;
    const user_space_docker_cmd = runtimeContext.user_space_docker_cmd;
    if (docker_req !== undefined && user_space_docker_cmd) {
      if (docker_req.dockerImageId) {
        img_id = docker_req.dockerImageId;
      } else if (docker_req.dockerPull) {
        img_id = String(docker_req.dockerPull);
        const cmd = [user_space_docker_cmd, 'pull', img_id];
        _logger.info(String(cmd));
        // TODO
        // try {
        //     process.check_call(cmd, sys.stderr)
        // } catch (exc: any) {
        //     throw new WorkflowException(
        //         `Either Docker container ${img_id} is not available with  user space docker implementation ${user_space_docker_cmd}  or ${user_space_docker_cmd} is missing or broken.`
        //     );
        // }
      } else {
        throw new WorkflowException(
          "Docker image must be specified as 'dockerImageId' or 'dockerPull' when using user space implementations of Docker",
        );
      }
    } else {
      try {
        if (docker_req !== undefined && runtimeContext.use_container) {
          img_id = await this.get_from_requirements(
            docker_req,
            runtimeContext.pull_image,
            runtimeContext.force_docker_pull,
            runtimeContext.tmp_outdir_prefix,
          );
        }
        if (docker_req !== undefined && img_id === undefined && runtimeContext.use_container) {
          throw new Error('Docker image not available');
        }
        if (this.prov_obj !== undefined && img_id !== undefined && runtimeContext.process_run_id !== undefined) {
          const container_agent = this.prov_obj.document.agent(uuidv4, {
            'prov:type': 'SoftwareAgent',
            'cwlprov:image': img_id,
            'prov:label': `Container execution of image ${img_id}`,
          });
          this.prov_obj.document.wasAssociatedWith(runtimeContext.process_run_id, container_agent);
        }
      } catch (err) {
        const container = runtimeContext.singularity ? 'Singularity' : 'Docker';
        _logger.debug(`${container} error`, err);
        if (docker_is_req) {
          throw new UnsupportedRequirement(`${container} is required to run this tool: ${String(err)}`);
        } else {
          throw new WorkflowException(
            `${container} is not available for this tool, try --no-container to disable ${container}, or install a user space Docker replacement like uDocker with --user-space-docker-cmd.: ${err}`,
          );
        }
      }
    }

    this._setup(runtimeContext);

    const env = { ...process.env };
    const [runtime, cidfile] = this.create_runtime(env as { [key: string]: string }, runtimeContext);

    runtime.push(String(img_id));
    let monitor_function: Function | null = null;
    if (cidfile) {
      monitor_function = (process: any) =>
        this.docker_monitor(
          cidfile,
          runtimeContext.tmpdir_prefix,
          !runtimeContext.cidfile_dir,
          runtimeContext.podman ? 'podman' : 'docker',
          process,
        );
    } else if (runtimeContext.user_space_docker_cmd) {
      monitor_function = this.process_monitor;
    }
    await this._execute(runtime, env as { [key: string]: string }, runtimeContext, monitor_function as any);
  }
  docker_monitor(
    cidfile: string,
    tmpdir_prefix: string,
    cleanup_cidfile: boolean,
    docker_exe: string,
    process: any,
  ): void {
    let cid: string | null = null;
    while (!cid) {
      // sleep(1);
      if (process.returncode !== null) {
        if (cleanup_cidfile) {
          try {
            fs.unlinkSync(cidfile);
          } catch (exc) {
            _logger.warn(`Ignored error cleaning up ${docker_exe} cidfile: ${exc}`);
          }
          return;
        }
      }
      try {
        cid = fs.readFileSync(cidfile, 'utf8').trim();
      } catch {
        cid = null;
      }
    }
    const max_mem = os.totalmem();
    // const [tmp_dir, tmp_prefix] = path.parse(tmpdir_prefix);
    // const stats_file = tmp.fileSync({ prefix: tmp_prefix, dir: tmp_dir });
    const stats_file_name = 'stats_file.name';
    try {
      const stats_file_handle = fs.createWriteStream(stats_file_name, { flags: 'w' });
      const cmds = [docker_exe, 'stats'];
      if (!docker_exe.includes('podman')) {
        cmds.push('--no-trunc');
      }
      cmds.push('--format', '{{.MemPerc}}', cid);
      const stats_proc = cp.spawn(cmds[0], cmds.slice(1), {
        stdio: [
          'ignore', // Use parent's stdin for child
          stats_file_handle, // Pipe child's stdout to file
          'ignore', // Pipe child's stderr to null
        ],
      });
      process.wait();
      stats_proc.kill();
    } catch (exc) {
      _logger.warn('Ignored error with %s stats: %s', docker_exe, exc);
      return;
    }
    let max_mem_percent = 0;
    let mem_percent = 0;
    const stats = fs.readFileSync(stats_file_name).toString().split('\n');
    for (const line of stats) {
      if (!line) {
        break;
      }
      try {
        mem_percent = parseFloat(line.replace(CONTROL_CODE_RE, '').replace('%', ''));
        if (mem_percent > max_mem_percent) {
          max_mem_percent = mem_percent;
        }
      } catch (exc) {
        _logger.debug('%s stats parsing error in line %s: %s', docker_exe, line, exc);
      }
    }
    _logger.info(`[job ${this.name}] Max memory used: ${Math.floor(((max_mem_percent / 100) * max_mem) / 2 ** 20)}MiB`);
    if (cleanup_cidfile) {
      fs.unlinkSync(cidfile);
    }
  }
}
