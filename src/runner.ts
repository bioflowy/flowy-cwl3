import { setTimeout } from 'node:timers/promises';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import { main } from './main.js';

export async function run(): Promise<number> {
  // NOTE: ここでちょっと待機しておかないと、vscode のデバッグ機能で実行したときに、
  // 後続の行に仕掛けた breakpoint で止まってくれない。おそらく source map の読み込みが
  // 終わる前に、後続の行に到達してしまい、breakpoint が効かなくなっているのだと思う...
  await setTimeout(1000);

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
