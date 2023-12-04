import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cwlTsAuto from 'cwl-ts-auto';
import fsExtra from 'fs-extra/esm';
import yaml from 'js-yaml';
import { LoadingContext, RuntimeContext } from './context.js';
import { Directory, File } from './cwltypes.js';
import { SingleJobExecutor } from './executors.js';
import { loadDocument } from './loader.js';
import { _logger } from './loghandler.js';
import { shortname, type Process, add_sizes } from './process.js';
import { SecretStore } from './secrets.js';
import { getServer } from './server.js';
import {
  type CWLObjectType,
  normalizeFilesDirs,
  filePathToURI,
  type CWLOutputType,
  trim_listing,
  isString,
  visitFileDirectory,
  isFile,
  isFileOrDirectory,
} from './utils.js';
import { default_make_tool } from './workflow.js';

function parseFile(filePath: string): object | null {
  const extname = path.extname(filePath).toLowerCase();

  if (!fs.existsSync(filePath)) {
    throw new Error('File does not exist.');
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  switch (extname) {
    case '.json':
      return JSON.parse(content);
    case '.yaml':
    case '.yml':
      return yaml.load(content) as object;
    default:
      throw new Error('Unsupported file type.');
  }
}
function convertToAbsPath(filePath: string, inputBaseDir: string): string {
  if (!filePath) {
    return filePath;
  }
  let inputBaseDirUrl = filePathToURI(inputBaseDir);
  if (!inputBaseDirUrl.endsWith('/')) {
    inputBaseDirUrl = `${inputBaseDirUrl}/`;
  }
  if (!filePath.startsWith('/')) {
    return `${inputBaseDirUrl}${filePath}`;
  }
  if (!filePath.startsWith('file://')) {
    filePath = pathToFileURL(filePath).toString();
  }
  return filePath;
}
function load_job_order(basedir: string | undefined, job_order_file: string): [CWLObjectType | null, string] {
  let job_order_object = null;

  // if (args.job_order.length == 1 && args.job_order[0][0] != '-') {
  //   job_order_file = args.job_order[0];
  // } else if (args.job_order.length == 1 && args.job_order[0] == '-') {
  //   const yaml = yaml_no_ts();
  //   job_order_object = yaml.load(stdin);
  //   [job_order_object, _] = loader.resolve_all(job_order_object, `${file_uri(os.getcwd())}/`);
  // } else {
  //   job_order_file = null;
  // }

  let input_basedir;
  if (job_order_object != null) {
    input_basedir = basedir ? basedir : process.cwd();
  } else if (job_order_file != null) {
    input_basedir = basedir ? basedir : path.resolve(path.dirname(job_order_file));
    const fileData = parseFile(job_order_file);
    job_order_object = fileData;
  }

  if (job_order_object == null) {
    input_basedir = basedir ? basedir : process.cwd();
  }
  function _normalizeFileDir(val: File | Directory) {
    if (val.location) {
      val.location = convertToAbsPath(val.location, input_basedir);
    }
    if (val.path) {
      val.path = convertToAbsPath(val.path, input_basedir);
    }
  }
  visitFileDirectory(job_order_object, _normalizeFileDir);
  if (job_order_object != null && !(job_order_object instanceof Object)) {
    _logger.error(
      'CWL input object at %s is not formatted correctly, it should be a ' +
        'JSON/YAML dictionary, not %s.\n' +
        'Raw input object:\n%s',
      job_order_file || 'stdin',
      typeof job_order_object,
      job_order_object,
    );
    throw Error('error');
  }

  return [job_order_object, input_basedir];
}
export const convertObjectToFileDirectory = (obj: unknown): File | Directory | undefined => {
  if ('object' !== typeof obj) {
    return undefined;
  }
  if (obj instanceof cwlTsAuto.File) {
    return {
      class: 'File',
      location: obj.location,
      basename: obj.basename,
      dirname: obj.dirname,
      checksum: obj.checksum,
      size: obj.size,
      secondaryFiles: (obj.secondaryFiles || []).map(convertObjectToFileDirectory),
      format: obj.format,
      path: obj.path,
      contents: obj.contents,
    };
  } else if (obj instanceof cwlTsAuto.Directory) {
    return {
      class: 'Directory',
      location: obj.location,
      path: obj.path,
      basename: obj.basename,
      listing: (obj.listing || []).map(convertObjectToFileDirectory),
    };
  }
  return undefined;
};
export function convertDictToFileDirectory<T>(obj: T): T {
  if (isFileOrDirectory(obj)) {
    return obj;
  } else if (obj instanceof Array) {
    return obj.map(convertDictToFileDirectory) as T;
  } else if (obj instanceof Object) {
    const rslt = convertObjectToFileDirectory(obj);
    if (rslt) {
      return rslt as T;
    } else {
      for (const key of Object.keys(obj)) {
        obj[key] = convertDictToFileDirectory(obj[key]);
      }
      return obj;
    }
  }
  return obj;
}

function init_job_order(
  job_order_object: CWLObjectType | null,
  process: Process,
  input_basedir,
  tool_file_path,
  runtime_context: RuntimeContext | null = null,
): CWLObjectType {
  if (!job_order_object) {
    job_order_object = { id: tool_file_path };
  }
  for (const inp of process.tool.inputs) {
    if (inp.default_ && (!job_order_object || !job_order_object[shortname(inp.id)])) {
      if (!job_order_object) job_order_object = {};
      job_order_object[shortname(inp.id)] = convertDictToFileDirectory(inp.default_);
    }
  }

  const namespaces = process.tool.loadingOptions.namespaces;
  const fs_access = runtime_context.make_fs_access(input_basedir);
  function path_to_loc(p: File | Directory): void {
    if (!p.location && p.path) {
      p.location = p.path;
    }
    if (isFile(p)) {
      add_sizes(fs_access, p);
      if (namespaces) {
        const format = p.format;
        if (isString(format)) {
          const [id, rest] = format.split(':');
          if (namespaces[id]) {
            p.format = namespaces[id] + rest;
          }
        }
      }
    } else {
      trim_listing(p);
    }
  }
  visitFileDirectory(job_order_object, path_to_loc);
  normalizeFilesDirs(job_order_object);

  if ('cwl:tool' in job_order_object) delete job_order_object['cwl:tool'];
  if ('id' in job_order_object) delete job_order_object['id'];
  return job_order_object;
}
function loadData(filePath: string): any {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} dosen't exists`);
  }
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const fileExtention = path.extname(filePath);
  switch (fileExtention) {
    case '.json':
      return JSON.parse(fileContent);
    case '.yaml':
    case '.yml':
      return yaml.load(fileContent);
    default:
      throw new Error(`Unexpected file extention ${fileExtention}`);
  }
}
export async function exec(
  runtimeContext: RuntimeContext,
  tool_path: string,
  job_path?: string,
): Promise<[CWLOutputType, string]> {
  const loadingContext = new LoadingContext({});
  loadingContext.construct_tool_object = default_make_tool;
  if (!path.isAbsolute(tool_path)) {
    tool_path = path.join(runtimeContext.clientWorkDir, tool_path);
  }
  if (job_path && !path.isAbsolute(job_path)) {
    job_path = path.join(runtimeContext.clientWorkDir, job_path);
  }
  _logger.info(`tool_path=${tool_path}`);
  _logger.info(`job_path=${job_path}`);
  const [tool] = await loadDocument(tool_path, loadingContext);
  const jo = load_job_order(undefined, job_path);
  const job_order_object = jo[0];
  let input_basedir = jo[1];
  if (job_order_object == null) {
    input_basedir = path.dirname(tool_path);
  }
  _logger.info(`outdir=${runtimeContext.outdir}`);
  const initialized_job_order = init_job_order(job_order_object, tool, input_basedir, tool_path, runtimeContext);
  runtimeContext.basedir = input_basedir;
  const process_executor = new SingleJobExecutor();
  const [out, status] = await process_executor.execute(tool, initialized_job_order, runtimeContext);
  return [out, status];
}
