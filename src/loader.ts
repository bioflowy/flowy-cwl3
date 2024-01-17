import * as crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cwlTsAuto, { CommandOutputBinding, Directory } from 'cwl-ts-auto';
import { Dictionary } from 'cwl-ts-auto/dist/util/Dict.js';
import { LoadingOptions } from 'cwl-ts-auto/dist/util/LoadingOptions.js';
import { CommandLineTool, ExpressionTool } from './command_line_tool.js';
import type { LoadingContext } from './context.js';
import { ValidationException } from './errors.js';
import type { Process } from './process.js';
import { S3Fetcher } from './s3util.js';
import { filePathToURI } from './utils.js';
import { Workflow, default_make_tool } from './workflow.js';

function sha1(data: string): string {
  const hash = crypto.createHash('sha1');
  hash.update(data);
  return hash.digest('hex');
}
export async function load_tool(tool_path: string, loadingContext: LoadingContext) {
  const doc = await cwlTsAuto.loadDocument(tool_path);
  return doc;
}
export async function loadDocument(
  tool_path: string,
  loadingContext: LoadingContext,
): Promise<[Process | undefined, string]> {
  let tool_file_path = tool_path;
  if (tool_file_path.includes('#')) {
    tool_file_path = tool_file_path.split('#')[0];
  }
  if (tool_file_path.startsWith('file://')) {
    tool_file_path = fileURLToPath(tool_file_path);
  }
  const doc = await cwlTsAuto.loadDocument(tool_file_path, loadingContext.baseuri, loadingContext.loadingOptions);
  if (doc instanceof Array) {
    let tool_id = tool_path;
    if (!(tool_id.startsWith('file://') || tool_id.startsWith('s3:/'))) {
      if (!path.isAbsolute(tool_id)) {
        tool_id = path.join(process.cwd(), tool_id);
      }
      tool_id = filePathToURI(tool_id);
    }

    for (let index = 0; index < doc.length; index++) {
      if (doc[index].id === tool_id) {
        return [await default_make_tool(doc[index], loadingContext), 'success'];
      }
    }
    for (let index = 0; index < doc.length; index++) {
      if (doc[index].id.endsWith('#main')) {
        return [await default_make_tool(doc[index], loadingContext), 'success'];
      }
    }
  } else {
    return [await default_make_tool(doc, loadingContext), 'success'];
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
