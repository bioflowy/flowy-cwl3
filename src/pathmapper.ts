import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { RuntimeContext } from './context.js';
import { Directory, File } from './cwltypes.js';
import { abspath } from './stdfsaccess.js';
import { uriFilePath, dedup, downloadHttpFile, isFile, isDirectory } from './utils.js';

// MapperEnt Schema
export const MapperEntSchema = z.object({
  resolved: z.string(),
  target: z.string(),
  type: z.string(),
  staged: z.boolean(),
});
export type MapperEnt = z.infer<typeof MapperEntSchema>;

export class PathMapper {
  /**
   * Mapping of files from relative path provided in the file to a tuple.
   * (absolute local path, absolute container path)
   * The tao of PathMapper:
   * The initializer takes a list of `class: File` and `class: Directory`
   * objects, a base directory (for resolving relative references) and a staging
   * directory (where the files are mapped to).
   * The purpose of the setup method is to determine where each File or
   * Directory should be placed on the target file system (relative to
   * stagedir).
   * If `separatedirs=True`, unrelated files will be isolated in their own
   * directories under stagedir. If `separatedirs=False`, files and directories
   * will all be placed in stagedir (with the possibility for name
   * collisions...)
   * The path map maps the "location" of the input Files and Directory objects
   * to a tuple (resolved, target, type). The "resolved" field is the "real"
   * path on the local file system (after resolving relative paths and
   * traversing symlinks). The "target" is the path on the target file system
   * (under stagedir). The type is the object type (one of File, Directory,
   * CreateFile, WritableFile, CreateWritableFile).
   * The latter three (CreateFile, WritableFile, CreateWritableFile) are used by
   * InitialWorkDirRequirement to indicate files that are generated on the fly
   * (CreateFile and CreateWritableFile, in this case "resolved" holds the file
   * contents instead of the path because they file doesn't exist) or copied
   * into the output directory so they can be opened for update ("r+" or "a")
   * (WritableFile and CreateWritableFile).
   */

  private _pathmap: { [key: string]: MapperEnt };
  private stagedir: string;
  private separateDirs: boolean;

  constructor(referenced_files: (File | Directory)[], basedir: string, stagedir: string, separateDirs = true) {
    this._pathmap = {};
    this.stagedir = stagedir;
    this.separateDirs = separateDirs;
    this.setup(dedup(referenced_files), basedir);
  }

  public visitlisting(
    listing: (File | Directory)[],
    stagedir: string,
    basedir: string,
    copy = false,
    staged = false,
  ): void {
    for (const ld of listing) {
      this.visit(ld, stagedir, basedir, (copy = ld.writable ?? copy), staged);
    }
  }
  update(key: string, resolved: string, target: string, type: string, staged: boolean): MapperEnt {
    // / Update an existine entry.
    const m: MapperEnt = {
      resolved,
      target,
      type,
      staged,
    };
    this._pathmap[key] = m;
    return m;
  }
  reversemap(target: string): [string, string] | undefined {
    // Find the (source, resolved_path) for the given target, if any."""
    for (const [k, v] of Object.entries(this._pathmap)) {
      if (v.target === target) {
        return [k, v.resolved];
      }
    }
    return undefined;
  }

  private visit(obj: File | Directory, stagedir: string, basedir: string, copy: boolean, staged: boolean): void {
    stagedir = obj.dirname ?? stagedir;

    const tgt: string = path.join(stagedir, obj.basename);

    if (obj.location in this._pathmap) {
      return;
    }

    if (isDirectory(obj)) {
      const location: string = obj.location;
      let resolved: string;

      if (location.startsWith('file://')) {
        resolved = uriFilePath(location);
      } else {
        resolved = location;
      }

      this._pathmap[location] = { resolved, target: tgt, type: copy ? 'WritableDirectory' : 'Directory', staged };

      if (location.startsWith('file://')) {
        staged = false;
      }

      this.visitlisting(obj.listing || [], tgt, basedir, copy, staged);
    } else if (isFile(obj)) {
      const path1: string = obj.location;
      const ab: string = abspath(path1, basedir);

      if (obj.contents !== undefined && path1.startsWith('_:')) {
        this._pathmap[path1] = {
          resolved: obj.contents,
          target: tgt,
          type: copy ? 'CreateWritableFile' : 'CreateFile',
          staged,
        };
      } else {
        let deref: string = ab;

        if (deref.startsWith('http') || deref.startsWith('https')) {
          const [deref1, _] = downloadHttpFile(path1);
          deref = deref1;
        } else {
          let st: fs.Stats = fs.lstatSync(deref);
          while (st.isSymbolicLink()) {
            const rl: string = fs.readlinkSync(deref);
            deref = path.isAbsolute(rl) ? rl : path.join(path.dirname(deref), rl);
            st = fs.lstatSync(deref);
          }
        }

        this._pathmap[path1] = { resolved: deref, target: tgt, type: copy ? 'WritableFile' : 'File', staged };
      }

      this.visitlisting(obj.secondaryFiles ?? [], stagedir, basedir, copy, staged);
    }
  }
  setup(referenced_files: (File | Directory)[], basedir: string): void {
    let stagedir = this.stagedir;
    for (const fob of referenced_files) {
      if (this.separateDirs) {
        stagedir = path.join(this.stagedir, `stg${uuidv4()}`);
      }
      const copy = fob.writable || false;
      this.visit(fob, stagedir, basedir, copy, true);
    }
  }

  mapper(src: string): MapperEnt | undefined {
    if (src.includes('#')) {
      const i = src.indexOf('#');
      const p = this._pathmap[src.slice(0, i)];
      return p ? { resolved: p.resolved, target: p.target + src.slice(i), type: p.type, staged: p.staged } : undefined;
    }
    return this._pathmap[src];
  }

  files(): string[] {
    return Object.keys(this._pathmap);
  }

  items(): [string, MapperEnt][] {
    return Object.entries(this._pathmap);
  }
  contains(key: string): boolean {
    // Test for the presence of the given relative path in this mapper."""
    return key in this._pathmap;
  }
  items_exclude_children(): [string, MapperEnt][] {
    const newitems: { [key: string]: MapperEnt } = {};
    const keys = this.items().map(([key, _]) => key);
    for (const [key, entry] of this.items()) {
      const parents = path.parse(key).dir.split(path.sep);
      if (keys.some((key_) => parents.includes(path.parse(key_).base))) {
        continue;
      }
      newitems[key] = entry;
    }
    return Object.entries(newitems);
  }
}
export type MakePathMapper = (
  param1: (File | Directory)[],
  param2: string,
  param3: RuntimeContext,
  param4: boolean,
) => PathMapper;
