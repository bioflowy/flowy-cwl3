import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import SuperJSON from 'superjson';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import type { AppRouter } from '../router/router.js';
export interface Args {
  tool_path: string;
  job_path?: string;
  outdir?: string;
  quiet?: boolean;
}

export async function main(args: Args): Promise<number> {
  const trpc = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: 'http://localhost:3000/trpc',
      }),
    ],
    transformer: SuperJSON,
  });
  const [output, status] = await trpc.executeJob.query({
    tool_path: args.tool_path,
    job_path: args.job_path,
    clientWorkDir: process.cwd(),
  });
  if (status === 'success') {
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return new Promise((resolve) => {
      process.stdout.end(() => {
        resolve(0);
      });
    });
  } else {
    return 1;
  }
}

export async function executeClient() {
  // MEMO: ↓この行に breakpoint を仕掛けて、デバッグ実行してみよう。
  // eslint-disable-next-line no-console
  const arg = yargs(hideBin(process.argv))
    .command('$0 <tool_path> [job_path]', 'execute cwl workflow')
    .positional('tool_path', {
      description: 'Path to cwl file',
      type: 'string',
    })
    .positional('job_path', {
      description: 'job file path',
      type: 'string',
    })
    .option('outdir', {
      alias: 'o',
      description: 'Output directory',
      type: 'string',
    })
    .option('quiet', {
      alias: 'q',
      description: 'supress log output',
      type: 'boolean',
    })
    .help()
    .parseSync();
  return main(arg);
}
