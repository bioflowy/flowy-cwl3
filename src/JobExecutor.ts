import * as fs from 'node:fs';
import * as cp from 'node:child_process';
import {
  CopyCommand,
  MkdirCommand,
  RelinkCommand,
  StagingCommand,
  SymlinkCommand,
  WriteFileContentCommand,
} from './staging.js';
import { st } from 'rdflib';
import { CWLObjectType, CWLOutputType, aslist, ensureWritable, get_listing, splitext } from './utils.js';
import fsExtra from 'fs-extra/esm';
import { removeIgnorePermissionError } from './fileutils.js';
import { WorkflowException } from './errors.js';
import { JobOutputBinding } from './cwltypes.js';
import { StdFsAccess } from './stdfsaccess.js';
import { contentLimitRespectedReadBytes, substitute } from './builder.js';
import { compute_checksums } from './process.js';
import * as path from 'node:path';
export interface JobExec {
  staging: StagingCommand[];
  commands: string[];
  outdir: string;
  builderOutDir: string;
  stdin_path: string | undefined;
  stdout_path: string | undefined;
  stderr_path: string | undefined;
  env: { [key: string]: string };
  cwd: string;
  outputBinding: JobOutputBinding[];
  timelimit: number | undefined;
}
async function prepareStagingDir(StagingCommand: StagingCommand[]): Promise<void> {
  for (const command of StagingCommand) {
    switch (command.command) {
      case 'writeFileContent': {
        const c = command as WriteFileContentCommand;
        if (!fs.existsSync(command.target)) {
          fs.writeFileSync(command.target, command.content, { mode: command.mode });
          if (command.options.ensureWritable) {
            ensureWritable(command.target);
          }
        }
        break;
      }
      case 'symlink': {
        const c = command as SymlinkCommand;
        if (!fs.existsSync(c.target) && fs.existsSync(c.resolved)) {
          await fs.promises.symlink(c.resolved, c.target);
        }
        break;
      }
      case 'mkdir': {
        const c = command as MkdirCommand;
        if (!fs.existsSync(c.resolved)) {
          await fs.promises.mkdir(c.resolved, { recursive: c.recursive });
        }
        break;
      }
      case 'copy': {
        const c = command as CopyCommand;
        if (!fs.existsSync(c.target)) {
          await fsExtra.copy(c.resolved, c.target);
          if (c.options.ensureWritable) {
            ensureWritable(c.target);
          }
        }
        break;
      }
      case 'relink': {
        const c = command as RelinkCommand;
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
      }
    }
  }
}
async function glob_output(
  binding: JobOutputBinding,
  outdir: string,
  builderOutDir: string,
  fs_access: StdFsAccess,
  compute_checksum: boolean,
): Promise<[CWLObjectType[], string[]]> {
  const r: CWLObjectType[] = [];
  const globpatterns: string[] = [];

  try {
    for (let gb of aslist(binding.glob)) {
      if (gb.startsWith(builderOutDir)) {
        gb = gb.substring(builderOutDir.length + 1);
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
            return {
              location: g,
              path: fs_access.join(builderOutDir, decodeURIComponent(g.substring(prefix[0].length + 1))),
              basename: decoded_basename,
              nameroot: splitext(decoded_basename)[0],
              nameext: splitext(decoded_basename)[1],
              class: fs_access.isfile(g) ? 'File' : 'Directory',
            };
          }),
        );
      } catch (e) {
        console.error('Unexpected error from fs_access');
        throw e;
      }
    }

    for (const files of r) {
      // const rfile = { ...(files as any) };
      // revmap(rfile);
      if (files['class'] === 'Directory') {
        const ll = binding.loadListing;
        if (ll && ll !== 'no_listing') {
          get_listing(fs_access, files, ll === 'deep_listing');
        }
      } else {
        if (binding.loadContents) {
          const f: any = undefined;
          try {
            files['contents'] = await contentLimitRespectedReadBytes(files['location'] as string);
          } finally {
            if (f) {
              f.close();
            }
          }
        }

        if (compute_checksum) {
          await compute_checksums(fs_access, files as CWLObjectType);
          files['checksum'] = files['checksum'];
        }

        files['size'] = fs_access.size(files['location'] as string);
      }
    }

    return [r, globpatterns];
  } catch (e) {
    throw e;
  }
}
export type Evaluator = (pattern: string, primary: CWLObjectType) => Promise<CWLOutputType | null>;

async function collect_secondary_files(
  schema: JobOutputBinding,
  result: CWLObjectType | null,
  fs_access: StdFsAccess,
  evaluator: Evaluator,
): Promise<void> {
  for (const primary of aslist(result)) {
    if (primary instanceof Object) {
      if (!primary['secondaryFiles']) {
        primary['secondaryFiles'] = [];
      }
      const pathprefix = primary['path'].substring(0, primary['path'].lastIndexOf(path.sep) + 1);
      for (const sf of schema.secondaryFiles) {
        let sf_required = sf.required;

        let sfpath;
        if (sf.pattern.includes('$(') || sf.pattern.includes('${')) {
          sfpath = await evaluator(sf.pattern, primary as CWLObjectType);
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
          const original_sfitem = JSON.parse(JSON.stringify(sfitem));
          // if (!fs_access.exists(revmap(sfitem)['location']) && sf_required) {
          //   throw new WorkflowException(`Missing required secondary file '${original_sfitem['path']}'`);
          // }
          // if ('path' in sfitem && !('location' in sfitem)) {
          //   revmap(sfitem);
          // }
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
async function collect_outputs(
  outputBindings: JobOutputBinding[],
  outdir: string,
  builderOutDir: string,
  fs_access: StdFsAccess,
): Promise<{ [key: string]: CWLObjectType[] }> {
  const rmap: { [key: string]: CWLObjectType[] } = {};
  for (const binding of outputBindings) {
    const t = await glob_output(binding, outdir, builderOutDir, fs_access, true);
    rmap[binding.name] = t[0];
  }
  return rmap;
}

export async function executeJob({
  staging,
  commands,
  stdin_path,
  stdout_path,
  stderr_path,
  outputBinding,
  outdir,
  builderOutDir,
  env,
  cwd,
  timelimit,
}: JobExec): Promise<[number, { [key: string]: CWLObjectType[] }]> {
  await prepareStagingDir(staging);
  let stdin: any = 'pipe';
  let stdout: any = process.stderr;
  let stderr: any = process.stderr;

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
    child.on('close', async (code) => {
      const fs_access = new StdFsAccess(outdir);
      const r = await collect_outputs(outputBinding, outdir, builderOutDir, fs_access);

      resolve([code ?? -1, r]);
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}
