import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
extendZodWithOpenApi(z);
// WriteFileContentCommand
export const StagingCommandNameSchema = z
  .enum(['writeFileContent', 'relink', 'symlink', 'copy', 'mkdir'])
  .openapi('StagingCommandName');
export const StagingCommandSchema = z
  .object({
    command: StagingCommandNameSchema,
    target: z.string().optional(),
    resolved: z.string().optional(),
    content: z.string().optional(),
    mode: z.number().int().optional(),
    ensureWritable: z.boolean().optional(),
    recursive: z.boolean().optional(),
  })
  .openapi('StagingCommand');

export type StagingCommand = z.infer<typeof StagingCommandSchema>;

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
    this.commands.push({ command: 'writeFileContent', target, content, mode, ensureWritable: options.ensureWritable });
  }
  copyFileSync(resolved: string, target: string, options: { ensureWritable: boolean } = { ensureWritable: false }) {
    this.commands.push({ command: 'copy', resolved, target, ensureWritable: options.ensureWritable });
  }
  mkdirSync(targetDir: string, recursive: boolean = false) {
    this.commands.push({ command: 'mkdir', resolved: targetDir, recursive });
  }
  symlinkSync(resolved: string, target: string) {
    this.commands.push({ command: 'symlink', resolved, target });
  }
}
