import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { S3 } from '@aws-sdk/client-s3';
import * as cwlTsAuto from 'cwl-ts-auto';
import { LoadingOptions } from 'cwl-ts-auto/dist/util/LoadingOptions.js';
import yaml from 'js-yaml';
import { getFileContentFromS3 } from './builder.js';
import { LoadingContext, RuntimeContext } from './context.js';
import { Directory, File } from './cwltypes.js';
import { SingleJobExecutor } from './executors.js';
import { loadDocument } from './loader.js';
import { _logger } from './loghandler.js';
import { shortname, type Process, add_sizes } from './process.js';
import { S3Fetcher, dirnames3 } from './s3util.js';
import { getServerConfig } from './server/server.js';
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
  pathJoin,
} from './utils.js';
import { default_make_tool } from './workflow.js';

async function parseFile(filePath: string): Promise<object | null> {
  const extname = path.extname(filePath).toLowerCase();

  let content = '';
  if (filePath.startsWith('s3:/')) {
    const serverConfig = getServerConfig();
    content = await getFileContentFromS3(serverConfig.sharedFileSystem, filePath);
  } else {
    if (!fs.existsSync(filePath)) {
      throw new Error('File does not exist.');
    }
    content = await fs.promises.readFile(filePath, 'utf-8');
  }

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
function isSupportedUrl(url: URL): boolean {
  return url.protocol === 'file:' || url.protocol === 's3:';
}
function convertToAbsPath(filePath: string, inputBaseUrl: URL): URL {
  if (isSupportedUrl(inputBaseUrl)) {
    throw new Error('Unsupported url protocol.');
  }
  if (!filePath.startsWith('/')) {
    return new URL(`${inputBaseUrl.toString()}${filePath}`);
  }
  if (!filePath.startsWith('file:/') || filePath.startsWith('s3:/')) {
    filePath = pathToFileURL(filePath).toString();
  }
  return new URL(filePathToURI(filePath));
}
async function load_job_order(job_order_file: string): Promise<[CWLObjectType | null, string]> {
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
    input_basedir = process.cwd();
  } else if (job_order_file != null) {
    if (job_order_file.startsWith('s3:/')) {
      input_basedir = dirnames3(job_order_file);
    } else {
      input_basedir = path.resolve(path.dirname(job_order_file));
    }
    const fileData = await parseFile(job_order_file);
    job_order_object = fileData;
  }

  if (job_order_object == null) {
    input_basedir = process.cwd();
  }
  function _normalizeFileDir(val: File | Directory) {
    if (val.location) {
      val.location = convertToAbsPath(val.location, input_basedir).toString();
    }
    if (val.path) {
      val.path = convertToAbsPath(val.path, input_basedir).toString();
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

async function init_job_order(
  job_order_object: CWLObjectType | null,
  process: Process,
  input_basedir,
  tool_file_path,
  runtime_context: RuntimeContext | null = null,
): Promise<CWLObjectType> {
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
  async function path_to_loc(p: File | Directory): Promise<void> {
    if (!p.location && p.path) {
      p.location = p.path;
    }
    if (isFile(p)) {
      await add_sizes(fs_access, p);
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
  const promises = [];
  visitFileDirectory(job_order_object, (p) => {
    promises.push(path_to_loc(p));
  });
  await Promise.all(promises);
  normalizeFilesDirs(job_order_object);

  if ('cwl:tool' in job_order_object) delete job_order_object['cwl:tool'];
  if ('id' in job_order_object) delete job_order_object['id'];
  return job_order_object;
}
export async function exec(
  runtimeContext: RuntimeContext,
  tool_path: string,
  job_path?: string,
): Promise<[CWLOutputType, string]> {
  const loadingContext = new LoadingContext({});
  loadingContext.construct_tool_object = default_make_tool;
  if (job_path && !path.isAbsolute(job_path)) {
    if (runtimeContext) job_path = pathJoin(runtimeContext.basedir, job_path);
  }
  _logger.info(`tool_path=${tool_path}`);
  _logger.info(`job_path=${job_path}`);
  loadingContext.baseuri = path.dirname(tool_path);
  const loadingOptions = new LoadingOptions({});
  loadingOptions.fetcher = new S3Fetcher();
  loadingContext.loadingOptions = loadingOptions;
  const [tool] = await loadDocument(tool_path, loadingContext);
  const jo = await load_job_order(job_path);
  const job_order_object = jo[0];
  let input_basedir = jo[1];
  if (job_order_object == null) {
    input_basedir = path.dirname(tool_path);
  }
  _logger.info(`outdir=${runtimeContext.outdir}`);
  runtimeContext.basedir = input_basedir;
  const initialized_job_order = await init_job_order(job_order_object, tool, input_basedir, tool_path, runtimeContext);
  const process_executor = new SingleJobExecutor();
  const [out, status] = await process_executor.execute(tool, initialized_job_order, runtimeContext);
  return [out, status];
}
