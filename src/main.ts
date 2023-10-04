import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cwlTsAuto from 'cwl-ts-auto';
import fsExtra from 'fs-extra/esm';
import ivm from 'isolated-vm';
import yaml from 'js-yaml';
import jsYaml from 'js-yaml';
import { createLogger, format, transports } from 'winston';
import { CommandLineTool } from './command_line_tool.js';
import { LoadingContext, RuntimeContext } from './context.js';
import { SingleJobExecutor } from './executors.js';
import { loadDocument } from './loader.js';
import { _logger } from './loghandler.js';
import { shortname, type Process, add_sizes } from './process.js';
import { SecretStore } from './secrets.js';
import { StdFsAccess } from './stdfsaccess.js';
import {
  visit_class,
  type CWLObjectType,
  normalizeFilesDirs,
  urlJoin,
  filePathToURI,
  type CWLOutputType,
  trim_listing,
  adjustDirObjs,
  isString,
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
  function _normalizeFileDir(val) {
    if (['File', 'Directory'].includes(val['class'])) {
      if (val['location']) {
        val['location'] = convertToAbsPath(val['location'] as string, input_basedir);
      }
      if (val['path']) {
        val['path'] = convertToAbsPath(val['path'] as string, input_basedir);
      }
    }
  }
  visit_class(job_order_object, ['File', 'Directory'], _normalizeFileDir);
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
export const convertFileDirectoryToDict = (obj: any) => {
  if (obj instanceof Array) {
    return obj.map(convertFileDirectoryToDict);
  } else if (obj instanceof cwlTsAuto.File) {
    const file = {
      class: 'File',
      location: obj.location,
      basename: obj.basename,
      dirname: obj.dirname,
      checksum: obj.checksum,
      size: obj.size,
      secondaryFiles: obj.secondaryFiles,
      format: obj.format,
      path: obj.path,
      contents: obj.contents,
    };
    return file;
  } else if (obj instanceof cwlTsAuto.Directory) {
    const file = {
      class: 'Directory',
      location: obj.location,
      path: obj.path,
      basename: obj.basename,
      listing: obj.listing,
    };
    return file;
  } else if (obj instanceof Object) {
    if (obj['class'] === 'File') {
      return {
        class: 'File',
        location: obj.location,
        basename: obj.basename,
        dirname: obj.dirname,
        checksum: obj.checksum,
        size: obj.size,
        secondaryFiles: obj.secondaryFiles,
        format: obj.format,
        path: obj.path,
        contents: obj.contents,
      };
    } else if (obj['class'] === 'Directory') {
      return {
        class: 'Directory',
        location: obj.location,
        path: obj.path,
        basename: obj.basename,
        listing: obj.listing,
      };
    } else {
      for (const key of Object.keys(obj)) {
        obj[key] = convertFileDirectoryToDict(obj[key]);
      }
      return obj;
    }
  }
  return obj;
};

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
      job_order_object[shortname(inp.id)] = convertFileDirectoryToDict(inp.default_);
    }
  }

  function path_to_loc(p: CWLObjectType): void {
    if (!p['location'] && 'path' in p) {
      p['location'] = p['path'];
      delete p['path'];
    }
  }
  const namespaces = process.tool.loadingOptions.namespaces;

  function expand_formats(p: CWLObjectType): void {
    if (!namespaces) {
      return;
    }
    const format = p['format'];
    if (isString(format)) {
      const [id, rest] = format.split(':');
      if (namespaces[id]) {
        p['format'] = namespaces[id] + rest;
      }
    }
  }

  visit_class(job_order_object, ['File', 'Directory'], path_to_loc);
  visit_class(job_order_object, ['File'], (obj: CWLObjectType) =>
    add_sizes(runtime_context.make_fs_access(input_basedir), obj),
  );
  visit_class(job_order_object, ['File'], expand_formats);
  adjustDirObjs(job_order_object, trim_listing);
  normalizeFilesDirs(job_order_object);

  if ('cwl:tool' in job_order_object) delete job_order_object['cwl:tool'];
  if ('id' in job_order_object) delete job_order_object['id'];
  return job_order_object;
}
function toJsonString(obj: object): string {
  return JSON.stringify(obj, null, 2);
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
function equals(expected: any, actual: any, basedir: string): boolean {
  if (expected instanceof Array) {
    if (!(actual instanceof Array)) {
      return false;
    }
    if (expected.length !== actual.length) {
      return false;
    }
    for (let index = 0; index < expected.length; index++) {
      if (!equals(expected[index], actual[index], basedir)) {
        return false;
      }
    }
  } else if (expected instanceof Object) {
    if (expected['$import']) {
      const data_path = path.join(basedir, expected['$import']);
      expected = loadData(data_path);
    }
    if (!(actual instanceof Object)) {
      return false;
    }
    for (const key of Object.keys(expected)) {
      const expectedValue = expected[key];
      const actualValue = actual[key];
      if (expectedValue === 'Any') {
        continue;
      }
      if (key === 'location') {
        return actualValue.endsWith(expectedValue);
      }
      if (!equals(expectedValue, actualValue, basedir)) {
        return false;
      }
    }
  } else {
    return expected === actual;
  }
  return true;
}
function cleanWorkdir(directory: string, expect: string[]) {
  const items = fs.readdirSync(directory);
  for (const item of items) {
    if (!expect.includes(item)) {
      fsExtra.removeSync(item);
    }
  }
}
export async function conformance_test(): Promise<number> {
  // return do_test(path.join(process.cwd(), 'tests/iwd/test-index.yaml'), 13, -1);
  return do_test(path.join(process.cwd(), 'conformance_tests.yaml'), 200, -1);
  // return do_test(path.join(process.cwd(), 'conformance_tests.yaml'), 0, -1);
}
export interface Args {
  tool_path: string;
  job_path?: string;
  outdir?: string;
  quiet?: boolean;
}
export async function main(args: Args): Promise<number> {
  const [output, status] = await exec(args.tool_path, args.job_path, args.outdir);
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
export async function do_test(test_path: string, start = 0, end = -1): Promise<number> {
  const test_dir = path.dirname(test_path);
  const data = loadData(test_path) as { [key: string]: any }[];
  for (let index = start; index < (end < 0 ? data.length : end); index++) {
    cleanWorkdir(process.cwd(), ['tests', 'conformance_tests.yaml']);
    const test = data[index];
    if (test['id'] !== 'params_broken_null') {
      continue;
    }
    if (test['$import']) {
      const t = path.join(test_dir, test['$import']);
      await do_test(t);
    } else {
      _logger.info(`test index =${index}`);
      console.log(`index =${index}`);
      _logger.info(test['doc']);
      let job_path = test['job'] as string;
      if (job_path && !path.isAbsolute(job_path)) {
        job_path = path.join(test_dir, job_path);
      }
      let tool_path = test['tool'] as string;
      if (tool_path && !path.isAbsolute(tool_path)) {
        tool_path = path.join(test_dir, tool_path);
      }
      _logger.info(tool_path);
      _logger.info(job_path);
      const expected_outputs = test['output'];
      try {
        const [output, status] = await exec(tool_path, job_path);
        console.log(status);
        if (status !== 'success' && test['should_fail']) {
          console.log('OK expected error has occurred');
          continue;
        }
        if (test['should_fail']) {
          console.log('should_failed flag is true, but no error occurred.');
          continue;
        }

        if (!equals(expected_outputs, output, test_dir)) {
          const expected_str = toJsonString(expected_outputs);
          const output_str = toJsonString(output as object);
          console.log(`index=${index}`);
          console.log(test['id']);
          console.log(`expected: ${expected_str}`);
          console.log(`output: ${output_str}`);
        }
      } catch (e: any) {
        if (!test['should_fail']) {
          console.log(`index=${index}`);
          console.log(test['id']);
          console.log(e);
        } else {
          console.log('OK expected error has occurred');
        }
      }
    }
  }
  return 1;
}
export async function exec(tool_path: string, job_path?: string, outdir?: string): Promise<[CWLOutputType, string]> {
  const loadingContext = new LoadingContext({});
  loadingContext.construct_tool_object = default_make_tool;
  if (!path.isAbsolute(tool_path)) {
    tool_path = path.join(process.cwd(), tool_path);
  }
  if (job_path && !path.isAbsolute(job_path)) {
    job_path = path.join(process.cwd(), job_path);
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
  const runtimeContext = new RuntimeContext({
    outdir: outdir ? outdir : process.cwd(),
    secret_store: new SecretStore(),
  });
  const initialized_job_order = init_job_order(job_order_object, tool, input_basedir, tool_path, runtimeContext);
  runtimeContext.basedir = input_basedir;
  const process_executor = new SingleJobExecutor();
  const [out, status] = await process_executor.execute(tool, initialized_job_order, runtimeContext);
  return [out, status];
}
