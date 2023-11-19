import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { Stream } from 'node:stream';
import * as cwl from 'cwl-ts-auto';
import fsExtra from 'fs-extra/esm';
import { cloneDeep } from 'lodash-es';
import { contentLimitRespectedReadBytes, substitute } from './builder.js';
import { File, Directory, OutputBinding } from './cwltypes.js';
import { WorkflowException } from './errors.js';
import { removeIgnorePermissionError } from './fileutils.js';
import { MapperEnt } from './pathmapper.js';
import { compute_checksums } from './process.js';
import { StagingCommand } from './staging.js';
import { StdFsAccess } from './stdfsaccess.js';
import {
  CWLOutputType,
  aslist,
  ensureWritable,
  fileUri,
  get_listing,
  isDirectory,
  isFile,
  splitext,
  str,
  uriFilePath,
} from './utils.js';

type Evaluator = (id: string, ex: CWLOutputType | undefined, context) => Promise<CWLOutputType>;
export interface JobExec {
  id: string;
  staging: StagingCommand[];
  commands: string[];
  stdin_path: string | undefined;
  stdout_path: string | undefined;
  stderr_path: string | undefined;
  evaluator: Evaluator;
  env: { [key: string]: string };
  /**
   *
   */
  cwd: string;
  /**
   *
   */
  builderOutdir: string;
  timelimit: number | undefined;
  outputBindings: OutputBinding[];
  vols: MapperEnt[];
  inplace_update: boolean;
}
async function prepareStagingDir(StagingCommand: StagingCommand[]): Promise<void> {
  for (const command of StagingCommand) {
    switch (command.command) {
      case 'writeFileContent': {
        if (!fs.existsSync(command.target)) {
          fs.writeFileSync(command.target, command.content, { mode: command.mode });
          if (command.options.ensureWritable) {
            ensureWritable(command.target);
          }
        }
        break;
      }
      case 'symlink': {
        const c = command;
        if (!fs.existsSync(c.target) && fs.existsSync(c.resolved)) {
          await fs.promises.symlink(c.resolved, c.target);
        }
        break;
      }
      case 'mkdir': {
        const c = command;
        if (!fs.existsSync(c.resolved)) {
          await fs.promises.mkdir(c.resolved, { recursive: c.recursive });
        }
        break;
      }
      case 'copy': {
        const c = command;
        if (!fs.existsSync(c.target)) {
          await fsExtra.copy(c.resolved, c.target);
          if (c.options.ensureWritable) {
            ensureWritable(c.target);
          }
        }
        break;
      }
      case 'relink': {
        const c = command;
        const resolved = c.resolved;
        const host_outdir_tgt = c.target;
        const stat = fs.existsSync(host_outdir_tgt) ? fs.lstatSync(host_outdir_tgt) : undefined;
        if (stat && (stat.isSymbolicLink() || stat.isFile())) {
          // eslint-disable-next-line no-useless-catch
          try {
            await fs.promises.unlink(host_outdir_tgt);
          } catch (e) {
            if (!(e.code !== 'EPERM' || e.code !== 'EACCES')) throw e;
          }
        } else if (stat && stat.isDirectory() && !resolved.startsWith('_:')) {
          await removeIgnorePermissionError(host_outdir_tgt);
        }
        if (!resolved.startsWith('_:')) {
          try {
            fs.symlinkSync(resolved, host_outdir_tgt);
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
          }
        }
        break;
      }
      default:
        throw new Error(`Unknown staging command: ${str(command)}`);
    }
  }
}
function revmap_file(
  builderOutdir: string,
  outdir: string,
  f: File | Directory,
  fs_access: StdFsAccess,
): File | Directory | null {
  if (outdir.startsWith('/')) {
    outdir = fileUri(outdir);
  }
  if (f.location && !f.path) {
    const location: string = f.location;
    if (location.startsWith('file://')) {
      f.path = uriFilePath(location);
    } else {
      f.location = fs_access.join(outdir, f.location);
      return f;
    }
  }
  if (f['dirname']) {
    delete f['dirname'];
  }
  if (f.path) {
    const path1 = fs_access.join(builderOutdir, f.path);
    const uripath = fileUri(path1);
    f.path = undefined;
    if (!f.basename) {
      f.basename = path.basename(path1);
    }
    // if (!builder.pathmapper) {
    //   throw new Error("Do not call revmap_file using a builder that doesn't have a pathmapper.");
    // }
    // const revmap_f = builder.pathmapper.reversemap(path1);
    // if (revmap_f && !builder.pathmapper.mapper(revmap_f[0]).type.startsWith('Writable')) {
    //   // If the file is not writable, then we need to copy it to the output directory
    //   f.location = revmap_f[1];
    // } else
    if (uripath == outdir || uripath.startsWith(outdir + path.sep) || uripath.startsWith(`${outdir}/`)) {
      f.location = uripath;
    } else if (
      path1 == builderOutdir ||
      path1.startsWith(builderOutdir + path.sep) ||
      path1.startsWith(`${builderOutdir}/`)
    ) {
      const path2 = path1
        .substring(builderOutdir.length + 1)
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      const joined_path = fs_access.join(outdir, path2);
      f.location = joined_path;
    } else {
      throw new WorkflowException(
        `Output file path ${path1} must be within designated output directory ${builderOutdir} or an input file pass through.`,
      );
    }
    return f;
  }
  throw new WorkflowException(`Output File object is missing both 'location' and 'path' fields: ${str(f)}`);
}

export async function executeCommand({
  id,
  staging,
  builderOutdir,
  commands,
  stdin_path,
  stdout_path,
  stderr_path,
  env,
  cwd,
  timelimit,
  outputBindings,
  vols,
  inplace_update,
  evaluator,
}: JobExec): Promise<[number, { [key: string]: (File | Directory)[] }]> {
  await prepareStagingDir(staging);
  const rcode = await executeJob(commands, stdin_path, stdout_path, stderr_path, env, cwd, timelimit);
  await relink_initialworkdir(vols, cwd, builderOutdir, inplace_update);
  const fileMap: { [key: string]: (File | Directory)[] } = {};
  const fs_access = new StdFsAccess('');
  const revmap = (f) => revmap_file(builderOutdir, cwd, f, fs_access);
  const files = await globOutput(
    builderOutdir,
    {
      name: 'cwl.output.json',
      glob: ['cwl.output.json'],
      secondaryFiles: [],
    },
    cwd,
    true,
    revmap,
  );
  if (files.length > 0) {
    fileMap['cwl.output.json'] = files;
  }

  for (const outputBinding of outputBindings) {
    const files = await globOutput(builderOutdir, outputBinding, cwd, true, revmap);
    await collect_secondary_files(id, outputBinding, evaluator, files, new StdFsAccess(''), revmap);
    fileMap[outputBinding.name] = files;
  }
  return [rcode, fileMap];
}
async function relink_initialworkdir(
  vols: MapperEnt[],
  host_outdir: string,
  container_outdir: string,
  inplace_update = false,
): Promise<void> {
  for (const vol of vols) {
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
      const stat = fs.existsSync(host_outdir_tgt) ? fs.lstatSync(host_outdir_tgt) : undefined;
      if (stat && (stat.isSymbolicLink() || stat.isFile())) {
        // eslint-disable-next-line no-useless-catch
        try {
          await fs.promises.unlink(host_outdir_tgt);
        } catch (e) {
          if (!(e.code !== 'EPERM' || e.code !== 'EACCES')) throw e;
        }
      } else if (stat && stat.isDirectory() && !vol.resolved.startsWith('_:')) {
        await removeIgnorePermissionError(host_outdir_tgt);
      }
      if (!vol.resolved.startsWith('_:')) {
        try {
          fs.symlinkSync(vol.resolved, host_outdir_tgt);
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
        }
      }
    }
  }
}

export async function executeJob(
  commands: string[],
  stdin_path: string | undefined,
  stdout_path: string | undefined,
  stderr_path: string | undefined,
  env: { [key: string]: string },
  cwd: string,
  timelimit: number | undefined,
): Promise<number> {
  let stdin: number | Stream = process.stdin;
  let stdout: number | Stream = process.stderr;
  let stderr: number | Stream = process.stderr;

  if (stdin_path !== undefined) {
    stdin = fs.openSync(stdin_path, 'r');
  }
  if (stdout_path !== undefined) {
    stdout = fs.openSync(stdout_path, 'w');
  }
  if (stderr_path !== undefined) {
    stderr = fs.openSync(stderr_path, 'w');
  }
  const [cmd, ...args] = commands;
  return new Promise((resolve, reject) => {
    const child = cp.spawn(cmd, args, {
      cwd,
      env,
      stdio: [stdin, stdout, stderr],
      timeout: timelimit !== undefined ? timelimit * 1000 : undefined,
    });
    child.on('close', (code) => {
      resolve(code ?? -1);
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}
async function globOutput(
  builderOutdir: string,
  binding: OutputBinding,
  outdir: string,
  compute_checksum: boolean,
  revmap: (f: File | Directory) => void,
): Promise<(File | Directory)[]> {
  const r: (File | Directory)[] = [];
  const fs_access = new StdFsAccess('');

  try {
    for (let gb of binding.glob) {
      if (gb.startsWith(builderOutdir)) {
        gb = gb.substring(builderOutdir.length + 1);
      } else if (gb === '.') {
        gb = outdir;
      } else if (gb.startsWith('/')) {
        throw new WorkflowException("glob patterns must not start with '/'");
      }

      try {
        const prefix = fs_access.glob(outdir);
        const sorted_glob_result = fs_access.glob(fs_access.join(outdir, gb)).sort();

        r.push(
          ...sorted_glob_result.map((g): File | Directory => {
            const decoded_basename = path.basename(g);
            if (fs_access.isfile(g)) {
              const file: File = {
                class: 'File',
                location: g,
                path: fs_access.join(builderOutdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
                basename: decoded_basename,
                nameroot: splitext(decoded_basename)[0],
                nameext: splitext(decoded_basename)[1],
              };
              return file;
            } else {
              const directory: Directory = {
                class: 'Directory',
                location: g,
                path: fs_access.join(builderOutdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
                basename: decoded_basename,
              };
              return directory;
            }
          }),
        );
      } catch (e) {
        console.error('Unexpected error from fs_access');
        throw e;
      }
    }
    for (const files of r) {
      const rfile = cloneDeep(files);
      revmap(rfile);
      if (isDirectory(files)) {
        const ll = binding.loadListing;
        if (ll && ll !== cwl.LoadListingEnum.NO_LISTING) {
          get_listing(fs_access, files, ll === cwl.LoadListingEnum.DEEP_LISTING);
        }
      } else if (isFile(rfile) && isFile(files)) {
        if (binding.loadContents) {
          files.contents = await contentLimitRespectedReadBytes(rfile.location);
        }

        if (compute_checksum) {
          await compute_checksums(fs_access, rfile);
          files.checksum = rfile.checksum;
        }

        files.size = fs_access.size(rfile.location);
      }
    }
    return r;
  } catch (e) {
    throw e;
  }
}
async function collect_secondary_files(
  id: string,
  schema: OutputBinding,
  builder: Evaluator,
  result: (File | Directory)[],
  fs_access: StdFsAccess,
  revmap: (f: File | Directory) => void,
): Promise<void> {
  for (const primary of result) {
    if (primary instanceof Object) {
      if (!primary['secondaryFiles']) {
        primary['secondaryFiles'] = [];
      }
      const pathprefix = primary['path'].substring(0, primary['path'].lastIndexOf(path.sep) + 1);
      for (const sf of schema.secondaryFiles) {
        let sf_required: boolean;
        if (sf.required) {
          const sf_required_eval = await builder(id, sf.required, primary);
          if (!(typeof sf_required_eval === 'boolean' || sf_required_eval === null)) {
            throw new WorkflowException(
              `Expressions in the field 'required' must evaluate to a Boolean (true or false) or None. Got ${str(
                sf_required_eval,
              )} for ${sf.required}.`,
            );
          }
          sf_required = (sf_required_eval as boolean) || false;
        } else {
          sf_required = false;
        }

        let sfpath;
        if (sf.pattern.includes('$(') || sf.pattern.includes('${')) {
          sfpath = await builder(id, sf['pattern'], primary);
        } else {
          sfpath = substitute(primary['basename'], sf.pattern);
        }

        for (let sfitem of aslist(sfpath)) {
          if (!sfitem) {
            continue;
          }
          if (typeof sfitem === 'string') {
            sfitem = { path: pathprefix + sfitem };
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
