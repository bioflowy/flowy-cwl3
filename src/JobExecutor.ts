import * as fs from 'node:fs';
import * as cp from 'node:child_process';
import {
  CopyCommand,
  MkdirCommand,
  Staging,
  StagingCommand,
  SymlinkCommand,
  WriteFileContentCommand,
} from './staging.js';
import { st } from 'rdflib';
import { ensureWritable } from './utils.js';
import fsExtra from 'fs-extra/esm';
export interface JobExec {
  staging: StagingCommand[];
  commands: string[];
  stdin_path: string | undefined;
  stdout_path: string | undefined;
  stderr_path: string | undefined;
  env: { [key: string]: string };
  cwd: string;
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
        if (!fs.existsSync(c.target)) {
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
    }
  }
}
export async function executeJob({
  staging,
  commands,
  stdin_path,
  stdout_path,
  stderr_path,
  env,
  cwd,
  timelimit,
}: JobExec): Promise<number> {
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
    child.on('close', (code) => {
      resolve(code ?? -1);
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}
