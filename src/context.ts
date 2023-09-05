import { PathMapper } from './pathmapper.js';
import { Process } from './process.js';
import { StdFsAccess } from './stdfsaccess.js';
import { DEFAULT_TMP_PREFIX, type CWLObjectType, mkdtemp, type CommentedMap } from './utils.js';

class ContextBase {
  constructor(kwargs: { [key: string]: any } | null = null) {
    if (kwargs) {
      for (const [k, v] of Object.entries(kwargs)) {
        if (this.hasOwnProperty(k)) {
          (this as any)[k] = v;
        }
      }
    }
  }
}

function make_tool_notimpl(toolpath_object: CommentedMap, loadingContext: LoadingContext): Process {
  throw new Error('Not implemented');
}

const default_make_tool = make_tool_notimpl;

function log_handler(
  outdir: string,
  base_path_logs: string,
  stdout_path: string | null,
  stderr_path: string | null,
): void {
  if (outdir != base_path_logs) {
    if (stdout_path) {
      const new_stdout_path = stdout_path.replace(base_path_logs, outdir);
      //            shutil.copy2(stdout_path, new_stdout_path);
    }
    if (stderr_path) {
      const new_stderr_path = stderr_path.replace(base_path_logs, outdir);
      //          shutil.copy2(stderr_path, new_stderr_path);
    }
  }
}

function set_log_dir(outdir: string, log_dir: string, subdir_name: string): string {
  if (log_dir === '') {
    return outdir;
  } else {
    return `${log_dir}/${subdir_name}`;
  }
}
export class LoadingContext extends ContextBase {
  debug = false;
  metadata: CWLObjectType = {};
  requirements: CWLObjectType[] | null = null;
  hints: CWLObjectType[] | null = null;
  disable_js_validation = false;
  js_hint_options_file: string | null = null;
  do_validate = true;
  enable_dev = false;
  strict = true;
  construct_tool_object = default_make_tool;
  orcid = '';
  cwl_full_name = '';
  host_provenance = false;
  user_provenance = false;
  prov_obj: any | null = null;
  do_update: boolean | null = null;
  jobdefaults: CommentedMap | null = null;
  doc_cache = true;
  relax_path_checks = false;
  singularity = false;
  podman = false;
  eval_timeout = 60;
  fast_parser = false;
  skip_resolve_all = false;
  skip_schemas = false;

  constructor(kwargs?: { [key: string]: any } | null) {
    super(kwargs);
  }

  copy(): LoadingContext {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
}
export class RuntimeContext extends ContextBase {
  outdir?: string = undefined;
  tmpdir = '';
  tmpdir_prefix: string = DEFAULT_TMP_PREFIX;
  tmp_outdir_prefix = '';
  stagedir = '';
  make_fs_access: StdFsAccess;
  user_space_docker_cmd?: string = undefined;
  secret_store?: any = undefined;
  no_read_only = false;
  custom_net?: string = undefined;
  no_match_user = false;
  preserve_environment?: string[] = undefined;
  preserve_entire_environment = false;
  use_container = true;
  force_docker_pull = false;
  rm_tmpdir = true;
  pull_image = true;
  rm_container = true;
  move_outputs: 'move' | 'leave' | 'copy' = 'move';
  log_dir = '';
  set_log_dir = set_log_dir;
  log_dir_handler = log_handler;
  streaming_allowed = false;

  singularity = false;
  podman = false;
  debug = false;
  compute_checksum = true;
  name = '';
  default_container?: string = undefined;
  find_default_container?: any = undefined;
  cachedir?: string = undefined;
  part_of = '';
  basedir = '';
  toplevel = false;
  mutation_manager?: any = undefined;
  path_mapper = PathMapper;
  builder?: any = undefined;
  docker_outdir = '';
  docker_tmpdir = '';
  docker_stagedir = '';
  js_console = false;
  job_script_provider?: any = undefined;
  select_resources?: any = undefined;
  eval_timeout = 60;
  postScatterEval?: any = undefined;
  on_error: 'stop' | 'continue' = 'stop';
  strict_memory_limit = false;
  strict_cpu_limit = false;
  cidfile_dir?: string = undefined;
  cidfile_prefix?: string = undefined;

  workflow_eval_lock?: any = undefined;
  research_obj?: any = undefined;
  orcid = '';
  cwl_full_name = '';
  process_run_id?: string = undefined;
  prov_obj?: any = undefined;
  default_stdout?: any = undefined;
  default_stderr?: any = undefined;

  constructor(kwargs?: any) {
    super(kwargs);
    if (this.tmp_outdir_prefix == '') {
      this.tmp_outdir_prefix = this.tmpdir_prefix;
    }
    this.make_fs_access = new StdFsAccess(this.basedir);
  }
  getOutdir(): string {
    if (this.outdir) {
      return this.outdir;
    }
    return this.createOutdir();
  }

  getTmpdir(): string {
    if (this.tmpdir) {
      return this.tmpdir;
    }
    return this.createTmpdir();
  }

  getStagedir(): string {
    if (this.stagedir) {
      return this.stagedir;
    }
    const [tmpDir, tmpPrefix] = this.tmpdir_prefix.split('/');
    return mkdtemp(tmpPrefix, tmpDir);
  }

  createTmpdir(): string {
    const [tmpDir, tmpPrefix] = this.tmpdir_prefix.split('/');
    return mkdtemp(tmpPrefix, tmpDir);
  }

  createOutdir(): string {
    const [outDir, outPrefix] = this.tmp_outdir_prefix.split('/');
    return mkdtemp(outPrefix, outDir);
  }

  copy(): RuntimeContext {
    return { ...this };
  }
}
export function getDefault(val: any, def: any): any {
  if (val === null) {
    return def;
  } else {
    return val;
  }
}
