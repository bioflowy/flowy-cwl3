import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';

import type { WorkflowInputParameter } from 'cwl-ts-auto';
import { v4 as uuidv4 } from 'uuid';
import { CallbackJob, ExpressionJob } from './command_line_tool.js';
import { ValidationException, WorkflowException } from './errors.js';
import { CommandLineJob, JobBase } from './job.js';
import { MapperEnt, PathMapper } from './pathmapper.js';
import { StdFsAccess } from './stdfsaccess.js';
import type { Tool, ToolRequirement } from './types.js';
import type { WorkflowJob } from './workflow_job.js';

let __random_outdir: string | null = null;

export const CONTENT_LIMIT = 64 * 1024;

export const DEFAULT_TMP_PREFIX = os.tmpdir() + path.sep;

export type CommentedMap = { [key: string]: any };

export type MutableSequence<T> = T[];
export type MutableMapping<T> = {
  [key: string]: T;
};
export type CWLOutputAtomType =
  | undefined
  | boolean
  | string
  | number
  | MutableSequence<undefined | boolean | string | number | MutableSequence<any> | MutableMapping<any>>
  | MutableMapping<undefined | boolean | string | number | MutableSequence<any> | MutableMapping<any>>;

export type CWLOutputType =
  | boolean
  | string
  | number
  | MutableSequence<CWLOutputAtomType>
  | MutableMapping<CWLOutputAtomType>;
export type CWLObjectType = MutableMapping<CWLOutputType | undefined>;

export type JobsType = CommandLineJob | JobBase | ExpressionJob | CallbackJob | WorkflowJob | undefined; //  ;
export type JobsGeneratorType = AsyncGenerator<JobsType, void>;
export type OutputCallbackType = (arg1: CWLObjectType, arg2: string) => void;
// type ResolverType = (Loader, string)=>string?;
// type DestinationsType = MutableMapping<string, CWLOutputType?>;
// type ScatterDestinationsType = MutableMapping<string, (CWLOutputType|undefined)[]>;
// type ScatterOutputCallbackType = (ScatterDestinationsType?, string)=> void;
export type SinkType = CWLOutputType | CWLObjectType;
export type DirectoryType = {
  class: string;
  listing: CWLObjectType[];
  basename: string;
};
// type JSONAtomType = MutableMapping<string, any> | MutableSequence<any> | string| number| boolean| null;
// type JSONType = MutableMapping<string, JSONAtomType>| MutableSequence<JSONAtomType>| string| number| boolean| null;
// type WorkflowStateItem = NamedTuple<
//     'WorkflowStateItem',
//     [
//         ['parameter', CWLObjectType],
//         ['value', Optional<CWLOutputType>],
//         ['success', string]
//     ]
// >;
export class WorkflowStateItem {
  // / """Workflow state item."""

  parameter: WorkflowInputParameter;
  value?: CWLOutputType;
  success: string;
  constructor(parameter: WorkflowInputParameter, value: CWLOutputType | undefined, success: string) {
    this.parameter = parameter;
    this.value = value;
    this.success = success;
  }
}
export function isString(value: any): value is string {
  return typeof value === 'string';
}
export function urldefrag(url: string): { url: string; fragment: string } {
  const [urlWithoutFragment, fragment] = url.split('#');
  return { url: urlWithoutFragment, fragment: fragment || '' };
}
export type ParametersType = CWLObjectType[];
export type StepType = CWLObjectType;

export type LoadListingType = 'no_listing' | 'shallow_listing' | 'deep_listing';
export async function which(cmd: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    exec(`which ${cmd}`, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}
export function fileUri(inputPath: string, splitFrag = false): string {
  if (inputPath.startsWith('file://')) {
    return inputPath;
  }
  let frag = '';
  let urlPath: string;
  if (splitFrag) {
    const pathSp = inputPath.split('#', 2);
    if (pathSp.length === 2) {
      frag = `#${encodeURIComponent(pathSp[1])}`;
    }
    urlPath = pathToFileURL(pathSp[0]);
  } else {
    urlPath = pathToFileURL(inputPath);
  }
  if (urlPath.startsWith('/')) {
    return `file:${urlPath}${frag}`;
  }
  return `${urlPath}${frag}`;
}
export function copyTree(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyTree(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
export async function checkOutput(commands: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(commands.join(' '), (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}
export function uriFilePath(inputUrl: string): string {
  const split = new url.URL(inputUrl);
  if (split.protocol === 'file:') {
    return `${fileURLToPath(split.href)}${split.hash ? `#${decodeURIComponent(split.hash.slice(1))}` : ''}`;
  }
  throw new Error(`Not a file URI: ${inputUrl}`);
}

function pathToFileURL(inputPath: string): string {
  return new url.URL(`file://${path.resolve(inputPath)}`).toString();
}

function fileURLToPath(inputUrl: string): string {
  const u = new url.URL(inputUrl);
  if (u.protocol !== 'file:') {
    throw new Error(`Not a file URL: ${inputUrl}`);
  }
  return decodeURIComponent(u.pathname);
}
export function splitPath(filePath: string): [string, string] {
  const idx = filePath.lastIndexOf('/');
  if (idx === -1) {
    return ['', filePath];
  }
  return [filePath.substring(0, idx), filePath.substring(idx + 1)];
}
export function mkdtemp(prefix = '', dir?: string): string {
  if (!dir) {
    dir = DEFAULT_TMP_PREFIX;
  }
  const uniqueName = prefix + uuidv4();
  const tempDirPath = path.join(dir, uniqueName);

  fs.mkdirSync(tempDirPath);
  return tempDirPath;
}
export function versionstring(): string {
  return `flowy-cwl v1.0`;
}

export function aslist(thing: any): any[] {
  if (Array.isArray(thing)) {
    return thing;
  }
  if (thing === undefined || thing == null) {
    return [];
  }
  return [thing];
}
export function createTmpDir(tmpdirPrefix: string): string {
  const tmpDir = path.dirname(tmpdirPrefix);
  const tmpPrefix = path.basename(tmpdirPrefix);

  // デフォルトのtmpディレクトリを使用する場合
  const finalTmpDir = tmpDir || os.tmpdir();

  // 一時ディレクトリを作成する
  const fullTmpDir = fs.mkdtempSync(path.join(finalTmpDir, tmpPrefix));

  return fullTmpDir;
}

export function copytree_with_merge(src: string, dst: string): void {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst);
    fs.copyFileSync(src, dst);
  }
  const lst = fs.readdirSync(src);
  for (const item of lst) {
    const spath = path.join(src, item);
    const dpath = path.join(dst, item);
    if (fs.statSync(spath).isDirectory()) {
      copytree_with_merge(spath, dpath);
    } else {
      fs.copyFileSync(spath, dpath);
    }
  }
}

export function visit_class(rec: any, cls: any[], op: (...args: any[]) => any): void {
  if (typeof rec === 'object' && rec !== null) {
    if ('class' in rec && cls.includes(rec['class'])) {
      op(rec);
    }
    for (const key in rec) {
      visit_class(rec[key], cls, op);
    }
  }
}

function visit_field(rec: any, field: string, op: (...args: any[]) => any): void {
  if (typeof rec === 'object' && rec !== null) {
    if (field in rec) {
      rec[field] = op(rec[field]);
    }
    for (const key in rec) {
      visit_field(rec[key], field, op);
    }
  }
}
export function filePathToURI(filePath: string): string {
  const pathName = path.resolve(filePath).replace(/\\/g, '/');
  return url.format({
    protocol: 'file',
    slashes: true,
    pathname: pathName,
  });
}
export function random_outdir(): string {
  if (!__random_outdir) {
    __random_outdir = `/${Array.from({ length: 6 }, () => Math.random().toString(36)[2]?.toUpperCase()).join('')}`;
    return __random_outdir;
  }
  return __random_outdir;
}

export function adjustFileObjs(rec: any, op: any): void {
  // apply update function to each File object in rec
  visit_class(rec, ['File'], op);
}

export function adjustDirObjs(rec: any, op: any): void {
  // apply update function to each Directory object in rec
  visit_class(rec, ['Directory'], op);
}
const _find_unsafe = /[^a-zA-Z0-9@%+=:,./-]/;
export function quote(s: string): string {
  /** Return a shell-escaped version of the string *s*. */
  if (!s) {
    return "''";
  }
  if (!_find_unsafe.test(s)) {
    return s;
  }

  // use single quotes, and put single quotes into double quotes
  // the string $'b is then quoted as '$'"'"'b'
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}
export function urlJoin(...parts: string[]): string {
  return parts.reduce((accumulator, part) => {
    if (!accumulator) return part;

    const accSlash = accumulator.endsWith('/');
    const partSlash = part.startsWith('/');

    if (accSlash && partSlash) {
      return accumulator + part.slice(1);
    } else if (!accSlash && !partSlash) {
      return `${accumulator}/${part}`;
    } else {
      return accumulator + part;
    }
  }, '');
}

export function dedup(listing: any[]): any[] {
  const marksub = new Set();

  function mark(d: { [key: string]: string }): void {
    marksub.add(d['location']);
  }

  for (const entry of listing) {
    if (entry['class'] === 'Directory') {
      for (const e of entry['listing'] || []) {
        adjustFileObjs(e, mark);
        adjustDirObjs(e, mark);
      }
    }
  }

  const dd: CWLObjectType[] = [];
  const markdup = new Set();

  for (const r of listing) {
    if (!marksub.has(r['location']) && !markdup.has(r['location'])) {
      dd.push(r);
      markdup.add(r['location']);
    }
  }

  return dd;
}
function url2pathname(url: string): string {
  const myURL = new URL(url);

  // On Windows, Node.js's URL uses '/' as path separator. We should convert it to the correct one.
  if (path.sep === '\\') {
    return myURL.pathname.split('/').join('\\').slice(1);
  } else {
    return myURL.pathname;
  }
}

export function get_listing(fs_access: StdFsAccess, rec: any, recursive = true) {
  if (rec['class'] != 'Directory') {
    const finddirs: CWLObjectType[] = [];
    visit_class(rec, ['Directory'], finddirs.push);
    for (let _i = 0, finddirs_1 = finddirs; _i < finddirs_1.length; _i++) {
      const f = finddirs_1[_i];
      get_listing(fs_access, f, recursive);
    }
    return;
  }
  if ('listing' in rec) {
    return;
  }
  const listing: CWLOutputAtomType[] = [];
  const loc = rec['location'];
  for (let _a = 0, _b = fs_access.listdir(loc); _a < _b.length; _a++) {
    const ld = _b[_a];
    const bn = path.basename(url2pathname(ld));
    if (fs_access.isdir(ld)) {
      const ent = {
        class: 'Directory',
        location: ld,
        basename: bn,
      };
      if (recursive) {
        get_listing(fs_access, ent, recursive);
      }
      listing.push(ent);
    } else {
      listing.push({ class: 'File', location: ld, basename: bn });
    }
  }
  rec['listing'] = listing;
}
export function stage_files(
  pathmapper: PathMapper,
  stage_func: ((str: string, str2: string) => void) | null = null,
  ignore_writable = false,
  symlink = true,
  secret_store: any = null, // TODO SecretStore | null = null,
  fix_conflicts = false,
): void {
  let items = !symlink ? pathmapper.items() : pathmapper.items_exclude_children();
  const targets: { [key: string]: MapperEnt } = {};
  for (const [key, entry] of items) {
    if (!entry.type.includes('File')) continue;
    if (!(entry.target in targets)) {
      targets[entry.target] = entry;
    } else if (targets[entry.target]?.resolved != entry.resolved) {
      if (fix_conflicts) {
        let i = 2;
        let tgt = `${entry.target}_${i}`;
        while (tgt in targets) {
          i += 1;
          tgt = `${entry.target}_${i}`;
        }
        targets[tgt] = pathmapper.update(key, entry.resolved, tgt, entry.type, entry.staged);
      } else {
        throw new WorkflowException(
          `File staging conflict, trying to stage both ${targets[entry.target]?.resolved ?? ''} and ${
            entry.resolved
          } to the same target ${entry.target}`,
        );
      }
    }
  }

  items = !symlink ? pathmapper.items() : pathmapper.items_exclude_children();
  for (const [key, entry] of items) {
    if (!entry.staged) continue;
    if (!fs.existsSync(path.dirname(entry.target))) {
      fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    }
    if (('File' === entry.type || 'Directory' === entry.type) && fs.existsSync(entry.resolved)) {
      if (symlink) {
        fs.symlinkSync(entry.resolved, entry.target);
      } else if (stage_func) {
        stage_func(entry.resolved, entry.target);
      }
    }

    const matched_condition =
      'Directory' === entry.type && !fs.existsSync(entry.target) && entry.resolved.startsWith('_:');
    const ensure_writable_callback = () => ensureWritable(entry.target, true);

    if (matched_condition) {
      fs.mkdirSync(entry.target);
    } else if ('WritableFile' === entry.type && !ignore_writable) {
      fs.copyFileSync(entry.resolved, entry.target);
      ensure_writable_callback();
    } else if ('WritableDirectory' === entry.type && !ignore_writable) {
      if (entry.resolved.startsWith('_:')) {
        fs.mkdirSync(entry.target);
      } else {
        fs.cpSync(entry.resolved, entry.target);
        ensure_writable_callback();
      }
    } else if ('CreateFile' === entry.type || 'CreateWritableFile' === entry.type) {
      fs.writeFileSync(entry.target, secret_store ? (secret_store.retrieve(entry.resolved) as string) : entry.resolved);
      if ('CreateFile' === entry.type) {
        fs.chmodSync(entry.target, fs.constants.S_IRUSR);
      } else {
        ensure_writable_callback();
      }
      pathmapper.update(key, entry.target, entry.target, entry.type, entry.staged);
    }
  }
}
export function downloadHttpFile(httpurl: string): [string, Date] {
  // TODO
  // let cache_session = null;
  // let directory;
  // if ("XDG_CACHE_HOME" in process.env) {
  //     directory = process.env.XDG_CACHE_HOME;
  // }
  // else if ("HOME" in process.env) {
  //     directory = process.env.HOME;
  // }
  // else {
  //     directory = require("os").homedir();
  // }
  // cache_session = new CacheControl(requests.Session(), {
  //     cache: new FileCache(path.join(directory, ".cache", "cwltool"))
  // });
  // const r = cache_session.get(httpurl, {
  //     stream: true
  // });
  // const f = tmp.fileSync({ mode: "wb" });
  // const tempFilePath = f.name;
  // for (const chunk of r.iter_content({
  //     chunk_size: 16384
  // })) {
  //     if (chunk) {
  //         f.writeSync(chunk);
  //     }
  // }
  // r.close();
  // const date_raw = r.headers.get("Last-Modified");
  // const date = date_raw ? parsedate_to_datetime(date_raw) : null;
  // if (date) {
  //     const date_epoch = date.getTime() / 1000;
  //     fs.utimesSync(tempFilePath, date_epoch, date_epoch);
  // }
  return ['tempFilePath', new Date()];
}
export function ensureWritable(targetPath: string, includeRoot = false): void {
  //
  // Ensure that 'path' is writable.
  //
  // If 'path' is a directory, then all files and directories under 'path' are
  // made writable, recursively. If 'path' is a file or if 'include_root' is
  // `True`, then 'path' itself is made writable.
  //

  function addWritableFlag(p: string): void {
    const mode = fs.statSync(p).mode;
    const newMode = mode | 0o200; // Adding write permission for the owner
    fs.chmodSync(p, newMode);
  }

  if (fs.statSync(targetPath).isDirectory()) {
    if (includeRoot) {
      addWritableFlag(targetPath);
    }

    fs.readdirSync(targetPath).forEach((item) => {
      const itemPath = path.join(targetPath, item);
      if (fs.statSync(itemPath).isDirectory()) {
        ensureWritable(itemPath, true); // Recursive call for directories
      } else {
        addWritableFlag(itemPath); // Directly add flag for files
      }
    });
  } else {
    addWritableFlag(targetPath);
  }
}

export function ensure_non_writable(targetPath: string): void {
  function removeWritableFlag(p: string): void {
    const mode = fs.statSync(p).mode;
    // Remove write permissions for owner, group, and others
    const newMode = mode & ~0o200 & ~0o020 & ~0o002;
    fs.chmodSync(p, newMode);
  }

  if (fs.statSync(targetPath).isDirectory()) {
    fs.readdirSync(targetPath).forEach((item) => {
      const itemPath = path.join(targetPath, item);
      removeWritableFlag(itemPath); // Remove write permissions

      if (fs.statSync(itemPath).isDirectory()) {
        ensure_non_writable(itemPath); // Recursive call for directories
      }
    });
  } else {
    removeWritableFlag(targetPath);
  }
}
export function splitext(p: string): [string, string] {
  const ext = path.extname(p);
  const base = p.substring(0, p.length - ext.length);
  return [base, ext];
}
export function normalizeFilesDirs(
  job: (MutableSequence<MutableMapping<any>> | MutableMapping<any> | DirectoryType) | undefined,
) {
  function addLocation(d: Record<string, any>) {
    if (!('location' in d)) {
      if (d['class'] === 'File' && !('contents' in d)) {
        throw new ValidationException("Anonymous file object must have 'contents' and 'basename' fields.");
      }
      if (d['class'] === 'Directory' && (!('listing' in d) || !('basename' in d))) {
        throw new ValidationException("Anonymous directory object must have 'listing' and 'basename' fields.");
      }
      d['location'] = `_:${uuidv4()}`;
      if (!('basename' in d)) {
        d['basename'] = d['location'].substring(2);
      }
    }

    let path2 = d['location'];
    try {
      path2 = new URL(d['location']).pathname;
    } catch (e) {}
    // strip trailing slash
    if (path2.endsWith('/')) {
      if (d['class'] !== 'Directory') {
        throw new ValidationException(`location '${d['location']}' ends with '/' but is not a Directory`);
      }
      path2 = d['location'].slice(0, -1);
      d['location'] = path2;
    }

    if (!d['basename']) {
      if (path2.startsWith('_:')) {
        d['basename'] = path2.substring(2);
      } else {
        d['basename'] = path.basename(path2);
      }
    }

    if (d['class'] === 'File') {
      const [nr, ne] = splitext(d['basename']);
      if (d['nameroot'] !== nr) {
        d['nameroot'] = String(nr);
      }
      if (d['nameext'] !== ne) {
        d['nameext'] = String(ne);
      }
    }
  }

  visit_class(job, ['File', 'Directory'], addLocation);
}
function reversed<T>(arrays: T[]): T[] {
  return [...arrays].reverse();
}
export interface RequirementParam {
  requirements?: undefined | ToolRequirement;
  hints?: undefined | any[];
}

export function getRequirement<T>(reqs: RequirementParam, cls: new (any) => T): [T | undefined, boolean] {
  if (reqs.requirements) {
    const req = reqs.requirements.find((item) => item instanceof cls);
    if (req) {
      return [req as T, true];
    }
  }
  if (reqs.hints) {
    const req = reqs.hints.find((item) => item['class'] === cls.name);

    if (req) {
      // eslint-disable-next-line new-cap
      return [new cls(req), false];
    }
  }
  return [undefined, false];
}

export class HasReqsHints {
  // Base class for get_requirement().
  requirements: CWLObjectType[] = [];
  hints: CWLObjectType[] = [];

  public get_requirement(feature: string): [CWLObjectType | undefined, boolean | undefined] {
    // / Retrieve the named feature from the requirements field, or the hints field."""
    for (const item of reversed(this.requirements)) {
      if (item['class'] == feature) {
        return [item, true];
      }
    }
    for (const item of reversed(this.hints)) {
      if (item['class'] == feature) {
        return [item, false];
      }
    }
    return [undefined, undefined];
  }
}
