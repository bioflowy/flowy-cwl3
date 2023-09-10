import * as crypto from 'node:crypto';
import cwlTsAuto, { CommandOutputBinding } from 'cwl-ts-auto';
import { CommandLineTool, ExpressionTool } from './command_line_tool.js';
import type { LoadingContext } from './context.js';
import { ValidationException } from './errors.js';
import type { Process } from './process.js';

function sha1(data: string): string {
  const hash = crypto.createHash('sha1');
  hash.update(data);
  return hash.digest('hex');
}
export async function loadDocument(
  tool_path: string,
  loadingContext: LoadingContext,
): Promise<[Process | undefined, string]> {
  const doc = await cwlTsAuto.loadDocument(tool_path);
  if (doc instanceof cwlTsAuto.CommandLineTool) {
    _convert_stdstreams_to_files(doc);
    return [new CommandLineTool(doc, loadingContext), 'successed'];
  } else if (doc instanceof cwlTsAuto.ExpressionTool) {
    return [new ExpressionTool(doc, loadingContext), 'successed'];
  }
  return [undefined, 'failed'];
}

function _convert_stdstreams_to_files(tool: cwlTsAuto.CommandLineTool) {
  for (const out of tool.outputs) {
    for (const streamtype of ['stdout', 'stderr']) {
      if (out.type === streamtype) {
        if (out.outputBinding) {
          throw new ValidationException(`Not allowed to specify outputBinding when using ${streamtype} shortcut.`);
        }
        let filename = undefined;
        if (streamtype === 'stdout') {
          filename = tool.stdout;
        } else if (streamtype === 'stderr') {
          filename = tool.stderr;
        }
        if (!filename) {
          filename = sha1(JSON.stringify(tool));
        }
        if (streamtype === 'stdout') {
          tool.stdout = filename;
        } else if (streamtype === 'stderr') {
          tool.stderr = filename;
        }
        out.type = 'File';
        out.outputBinding = new CommandOutputBinding({ glob: filename });
      }
    }
  }
  for (const inp of tool.inputs) {
    if (inp.type === 'stdin') {
      if (inp.inputBinding) {
        throw new ValidationException('Not allowed to specify inputBinding when using stdin shortcut.');
      }
      if (tool.stdin) {
        throw new ValidationException('Not allowed to specify stdin path when using stdin type shortcut.');
      } else {
        tool.stdin = inp.id.split('#').pop()?.split('/').pop();
        inp.type = 'File';
      }
    }
  }
}
