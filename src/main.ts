import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cwlTsAuto from 'cwl-ts-auto';
import fsExtra from 'fs-extra/esm';
import ivm from 'isolated-vm';
import yaml from 'js-yaml';
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
    if (val['class'] === 'File') {
      let location = val['location'];
      if (location) {
        if (!location.startsWith('/')) {
          location = path.join(input_basedir, location);
        }
        if (!location.startsWith('file://')) {
          location = pathToFileURL(location).toString();
        }
        val['location'] = location;
      }
    } else if (val['class'] === 'Directory') {
      let location = val['location'];
      if (!location.startsWith('/')) {
        location = path.join(input_basedir, location);
      }
      if (!location.startsWith('file://')) {
        location = pathToFileURL(location).toString();
      }
      val['location'] = location;
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
      contents: obj.contents,
    };
    return file;
  } else if (obj instanceof cwlTsAuto.Directory) {
    const file = {
      class: 'File',
      location: obj.location,
      basename: obj.basename,
      listing: obj.listing,
    };
    return file;
  } else if (obj instanceof Object) {
    for (const key of Object.keys(obj)) {
      obj[key] = convertFileDirectoryToDict(obj[key]);
    }
    return obj;
  }
  return obj;
};
function init_job_order(
  job_order_object: CWLObjectType,
  process: Process,
  make_fs_access: (str) => StdFsAccess,
  input_basedir = '',
): CWLObjectType {
  for (const inp of process.tool.inputs) {
    if (inp.default_ && (job_order_object === undefined || !(shortname(inp.id) in job_order_object))) {
      if (job_order_object === undefined) {
        job_order_object = {};
      }
      job_order_object[shortname(inp.id)] = convertFileDirectoryToDict(inp.default_);
    }
  }

  const path_to_loc = (p: CWLObjectType, basedir: string) => {
    if (!('location' in p) && 'path' in p) {
      p['location'] = p['path'];
      delete p['path'];
    }
    const location = p['location'] as string;
    if (location && !location.startsWith('file://')) {
      p['location'] = urlJoin(basedir, location);
    }
  };
  const basedirUrl = filePathToURI(input_basedir);
  visit_class(job_order_object, ['File', 'Directory'], (val) => path_to_loc(val, basedirUrl));
  visit_class(job_order_object, ['File'], (val) => add_sizes(make_fs_access(input_basedir), val));
  // visit_class(job_order_object, ['File'], expand_formats);
  // adjustDirObjs(job_order_object, trim_listing);
  normalizeFilesDirs(job_order_object);

  if ('cwl:tool' in job_order_object) {
    delete job_order_object['cwl:tool'];
  }
  if ('id' in job_order_object) {
    delete job_order_object['id'];
  }
  return job_order_object;
}
function toJsonString(obj: object): string {
  return JSON.stringify(obj, null, 2);
}
function equals(expected: any, actual: any): boolean {
  if (expected instanceof Array) {
    if (!(actual instanceof Array)) {
      return false;
    }
    if (expected.length !== actual.length) {
      return false;
    }
    for (let index = 0; index < expected.length; index++) {
      if (!equals(expected[index], actual[index])) {
        return false;
      }
    }
  } else if (expected instanceof Object) {
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
      if (!equals(expectedValue, actualValue)) {
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
export async function main(): Promise<number> {
  const _logger = createLogger({
    level: 'debug', // Set the minimum log level to 'info'
    transports: [new transports.Console()],
  });
  _logger.info('hello');
  const test_path = path.join(process.cwd(), 'conformance_tests.yaml');
  const content = fs.readFileSync(test_path, 'utf-8');
  const data = yaml.load(content) as { [key: string]: any }[];
  for (let index = 116; index < 117; index++) {
    cleanWorkdir(process.cwd(), ['tests', 'conformance_tests.yaml']);
    console.log(`test index =${index}`);
    const test = data[index];
    console.log(test['id']);
    console.log(test['doc']);
    const job_path = test['job'] as string;
    const tool_path = test['tool'] as string;
    const expected_outputs = test['output'];
    try {
      const [output, status] = await exec(tool_path, job_path);
      console.log(status);
      if (test['should_fail']) {
        console.log('should_failed flag is true, but no error occurred.');
      }

      if (!equals(expected_outputs, output)) {
        const expected_str = toJsonString(expected_outputs);
        const output_str = toJsonString(output as object);
        console.log(`expected: ${expected_str}`);
        console.log(`output: ${output_str}`);
      }
    } catch (e: any) {
      if (!test['should_fail']) {
        console.log(e);
      } else {
        console.log('OK expected error has occurred');
      }
    }
  }
  return 1;
}
export async function exec(tool_path: string, job_path: string): Promise<[CWLOutputType, string]> {
  const loadingContext = new LoadingContext({});
  loadingContext.construct_tool_object = default_make_tool;
  if (!path.isAbsolute(tool_path)) {
    tool_path = path.join(process.cwd(), tool_path);
  }
  const [tool] = await loadDocument(tool_path, loadingContext);
  const [job_order_object, input_basedir] = load_job_order(undefined, job_path);
  const initialized_job_order = init_job_order(
    job_order_object,
    tool,
    (basedir) => new StdFsAccess(basedir),
    input_basedir,
  );
  const runtimeContext = new RuntimeContext({
    outdir: process.cwd(),
    secret_store: new SecretStore(),
  });
  runtimeContext.basedir = input_basedir;
  const process_executor = new SingleJobExecutor();
  const [out, status] = await process_executor.execute(tool, initialized_job_order, runtimeContext);
  return [out, status];
}
