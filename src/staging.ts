export interface WriteFileContentCommand {
  command: 'writeFileContent';
  target: string;
  content: string;
  mode: number;
  options: { ensureWritable: boolean };
}
export interface SymlinkCommand {
  command: 'symlink';
  resolved: string;
  target: string;
}
export interface CopyCommand {
  command: 'copy';
  resolved: string;
  target: string;
  options: { ensureWritable: boolean };
}
export interface MkdirCommand {
  command: 'mkdir';
  resolved: string;
  recursive: boolean;
}
export type StagingCommand = WriteFileContentCommand | SymlinkCommand | CopyCommand | MkdirCommand;
export interface Staging {
  writeFileSync(target: string, content: string, mode: number, options: { ensureWritable: boolean }): Promise<void>;
  copyFileSync(resolved: string, target: string, options: { ensureWritable: boolean }): Promise<void>;
  mkdirSync(targetDir: string, recursive: boolean): Promise<void>;
  symlinkSync(resolved: string, target: string): Promise<void>;
}
export class LazyStaging implements Staging {
  commands: StagingCommand[] = [];
  writeFileSync(
    target: string,
    content: string,
    mode: number,
    options: { ensureWritable: boolean } = { ensureWritable: false },
  ): Promise<void> {
    this.commands.push({ command: 'writeFileContent', target, content, mode, options });
    return Promise.resolve();
  }
  copyFileSync(
    resolved: string,
    target: string,
    options: { ensureWritable: boolean } = { ensureWritable: false },
  ): Promise<void> {
    this.commands.push({ command: 'copy', resolved, target, options });
    return Promise.resolve();
  }
  mkdirSync(targetDir: string, recursive: boolean = false): Promise<void> {
    this.commands.push({ command: 'mkdir', resolved: targetDir, recursive });
    return Promise.resolve();
  }
  symlinkSync(resolved: string, target: string): Promise<void> {
    this.commands.push({ command: 'symlink', resolved, target });
    return Promise.resolve();
  }
}
import * as fs from 'fs';
export class immediateStaging implements Staging {
  commands: StagingCommand[] = [];
  writeFileSync(target: string, content: string, mode: number): Promise<void> {
    if (!fs.existsSync(target)) {
      return fs.promises.writeFile(target, content, { mode });
    }
    return Promise.resolve();
  }
  copyFileSync(resolved: string, target: string): Promise<void> {
    if (!fs.existsSync(target)) {
      return fs.promises.copyFile(resolved, target);
    }
    return Promise.resolve();
  }
  async mkdirSync(targetDir: string, recursive: boolean = false): Promise<void> {
    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive });
    }
    return Promise.resolve();
  }
  symlinkSync(resolved: string, target: string): Promise<void> {
    if (!fs.existsSync(target)) {
      return fs.promises.symlink(resolved, target);
    }
    return Promise.resolve();
  }
}
