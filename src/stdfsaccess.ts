import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as glob from 'glob';
export function abspath(src: string, basedir: string): string {
  let abpath: string;
  if (src.startsWith('file://')) {
    abpath = url.fileURLToPath(src);
  } else if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  } else {
    if (basedir.startsWith('file://')) {
      basedir = url.fileURLToPath(basedir);
    }
    abpath = path.isAbsolute(src) ? src : path.join(basedir, src);
  }
  return abpath;
}
export class StdFsAccess {
  basedir: string;

  constructor(basedir: string) {
    this.basedir = basedir;
  }

  private _abs(p: string): string {
    const p2 = abspath(p, this.basedir);
    return p2;
  }

  glob(pattern: string): string[] {
    const matches = glob.sync(this._abs(pattern));
    // Assuming file_uri is a function to convert a filepath to a URI.
    return matches.map((match: any) => `file://${match}`); // Placeholder implementation
  }

  async open(fn: string, mode: string): Promise<fs.promises.FileHandle> {
    return fs.promises.open(this._abs(fn), mode);
  }
  async read(fn: string): Promise<string> {
    return fs.promises.readFile(this._abs(fn), { encoding: 'utf-8' });
  }
  exists(fn: string): boolean {
    return fs.existsSync(this._abs(fn));
  }

  size(fn: string): number {
    return fs.statSync(this._abs(fn)).size;
  }

  isfile(fn: string): boolean {
    const p = this._statSync(this._abs(fn));
    return p ? p.isFile() : false;
  }
  _statSync(path: string) {
    if (!fs.existsSync(path)) {
      return undefined;
    }
    return fs.statSync(path);
  }
  isdir(fn: string): boolean {
    const p = this._statSync(this._abs(fn));
    return p ? p.isDirectory() : false;
  }

  listdir(fn: string): string[] {
    const entries = fs.readdirSync(this._abs(fn));
    // Assuming abspath is supposed to convert to a URI format.
    return entries.map((entry) => {
      if (fn.startsWith('file://')) {
        let ret = '';
        if (fn.endsWith('/')) {
          ret = `${fn}${entry}`;
        } else {
          ret = `${fn}/${entry}`;
        }
        return ret;
      } else {
        const ret = `file://${path.join(fn, entry)}`;
        return ret;
      }
    });
  }

  join(...paths: string[]): string {
    let count = paths.length - 1;
    for (; 0 < count; count -= 1) {
      if (paths[count].startsWith('/')) break;
    }
    return paths.slice(count).join('/');
  }

  realpath(p: string): string {
    if (fs.existsSync(p)) {
      return fs.realpathSync(p);
    } else {
      return p;
    }
  }
}
