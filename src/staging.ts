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
export interface RelinkCommand {
  command: 'relink';
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
export type StagingCommand = WriteFileContentCommand | SymlinkCommand | CopyCommand | MkdirCommand | RelinkCommand;
export class LazyStaging {
  relink(resolved: string, host_outdir_tgt: string) {
    this.commands.push({ command: 'relink', resolved, target: host_outdir_tgt });
  }
  commands: StagingCommand[] = [];
  writeFileSync(
    target: string,
    content: string,
    mode: number,
    options: { ensureWritable: boolean } = { ensureWritable: false },
  ) {
    this.commands.push({ command: 'writeFileContent', target, content, mode, options });
  }
  copyFileSync(resolved: string, target: string, options: { ensureWritable: boolean } = { ensureWritable: false }) {
    this.commands.push({ command: 'copy', resolved, target, options });
  }
  mkdirSync(targetDir: string, recursive: boolean = false) {
    this.commands.push({ command: 'mkdir', resolved: targetDir, recursive });
  }
  symlinkSync(resolved: string, target: string) {
    this.commands.push({ command: 'symlink', resolved, target });
  }
}
