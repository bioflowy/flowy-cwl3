import { initTRPC } from '@trpc/server';
import SuperJSON from 'superjson';
import { z } from 'zod';
import { RuntimeContext } from '../context.js';
import { exec } from '../main.js';
import { SharedFileSystem } from './config.js';
import { getServerConfig } from './server.js';

export const ExecuteJobInputSchema = z.object({
  tool_path: z.string(),
  job_path: z.string().optional(),
  outdir: z.string().optional(),
  basedir: z.string().optional(),
  clientWorkDir: z.string(),
  move_output: z.enum(['copy', 'leave', 'move']).optional(),
});
export const t = initTRPC.create({ transformer: SuperJSON });
export const appRouter = t.router({
  executeJob: t.procedure.input(ExecuteJobInputSchema).query(async ({ input }) => {
    const runtimeContext = new RuntimeContext({
      clientWorkDir: input.clientWorkDir,
      outdir: input.outdir ? input.outdir : input.clientWorkDir,
      move_output: input.move_output,
      sharedFileSystem: getServerConfig().sharedFileSystem,
    });
    if (input.basedir) {
      runtimeContext.basedir = input.basedir;
    }
    const [result, status] = await exec(runtimeContext, input.tool_path, input.job_path);
    return [result, status]; // input type is string
  }),
});
// export type definition of API
export type AppRouter = typeof appRouter;
