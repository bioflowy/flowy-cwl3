import * as crypto from 'node:crypto';
import path from 'node:path';
import cwlTsAuto, { CommandOutputBinding } from 'cwl-ts-auto';
import { CommandLineTool, ExpressionTool } from './command_line_tool.js';
import type { LoadingContext } from './context.js';
import { ValidationException } from './errors.js';
import type { Process } from './process.js';
import { filePathToURI } from './utils.js';
import { Workflow } from './workflow.js';

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
  let url = '';
  if (path.isAbsolute(tool_path)) {
    url = filePathToURI(tool_path);
    const baseuri = filePathToURI(path.dirname(tool_path));
    loadingContext.baseuri = baseuri;
  } else {
    url = `${loadingContext.baseuri}/${tool_path}`;
  }
  const doc = await cwlTsAuto.loadDocument(url, loadingContext.baseuri);
  if (doc instanceof cwlTsAuto.CommandLineTool) {
    _convert_stdstreams_to_files(doc);
    const t = new CommandLineTool(doc);
    t.init(loadingContext);
    return [t, 'successed'];
  } else if (doc instanceof cwlTsAuto.ExpressionTool) {
    const t = new ExpressionTool(doc);
    t.init(loadingContext);
    return [t, 'successed'];
  } else if (doc instanceof cwlTsAuto.Workflow) {
    doc.outputs.forEach((output) => {
      const base = output.id.split('#')[0];
      const id = output.outputSource.slice(output.id.length + 1) as string;
      output.outputSource = `${base}#${id}`;
    });
    const t = new Workflow(doc);
    await t.init(loadingContext);
    return [t, 'successed'];
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
