import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as glob from 'glob';
export function abspath(src: string, basedir: string): string {
  let abpath: string;
  if (src.startsWith('file://')) {
    abpath = url.fileURLToPath(src);
  } else if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  } else {
    if (basedir.startsWith('file://')) {
      abpath = src || (path.isAbsolute(src) ? `${basedir}/${src}` : path.join(basedir, src));
    } else {
      abpath = src || (path.isAbsolute(src) ? `${basedir}/${src}` : path.join(basedir, src));
    }
  }
  return abpath;
}
export class StdFsAccess {
  basedir: string;

  constructor(basedir: string) {
    this.basedir = basedir;
  }

  private _abs(p: string): string {
    const p2 =abspath(p,this.basedir)
    return p2;
  }

  glob(pattern: string): string[] {
    const matches = glob.sync(this._abs(pattern));
    // Assuming file_uri is a function to convert a filepath to a URI.
    return matches.map((match: any) => `file://${match}`); // Placeholder implementation
  }

  async open(fn: string, mode: string) :Promise<fs.promises.FileHandle>{
    return fs.promises.open(this._abs(fn), mode);
  }
  async read(fn: string):Promise<string> {
    return fs.promises.readFile(this._abs(fn),{encoding:"utf-8"})
  }
  exists(fn: string): boolean {
    return fs.existsSync(this._abs(fn));
  }

  size(fn: string): number {
    return fs.statSync(this._abs(fn)).size;
  }

  isfile(fn: string): boolean {
    return fs.statSync(this._abs(fn)).isFile();
  }

  isdir(fn: string): boolean {
    return fs.statSync(this._abs(fn)).isDirectory();
  }

  listdir(fn: string): string[] {
    const entries = fs.readdirSync(this._abs(fn));
    // Assuming abspath is supposed to convert to a URI format.
    return entries.map((entry) => `file://${path.join(fn, entry)}`); // Placeholder implementation
  }

  join(basePath: string, ...paths: string[]): string {
    return path.join(basePath, ...paths);
  }

  realpath(p: string): string {
    return path.resolve(p);
  }
}
