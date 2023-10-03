import fs from 'node:fs';
import path from 'node:path';
import fsExtra from 'fs-extra/esm';
import { _logger } from './loghandler.js';
export function removeSyncIgnorePermissionError(file_path: string) {
  try {
    fsExtra.removeSync(file_path);
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      _logger.info(`Permission denied when trying remove outdir ${file_path}`);
    } else {
      throw e;
    }
  }
}
export async function removeIgnorePermissionError(file_path: string): Promise<void> {
  try {
    await fsExtra.remove(file_path);
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      _logger.info(`Permission denied when trying remove outdir ${file_path}`);
    } else {
      throw e;
    }
  }
}
export function isdir(dir_path: string) {
  return fs.existsSync(dir_path) && fs.lstatSync(dir_path).isDirectory();
}
export function isfile(file_path: string) {
  return fs.existsSync(file_path) && fs.lstatSync(file_path).isFile();
}
/**
 * Join multiple path together, similar to Python's os.path.join
 * If an absolute path is found, it discards the previous paths
 * @param paths paths to join.
 * @returns joined path
 */
export function pathJoin(...paths: string[]): string {
  let finalPath = '';
  for (const p of paths) {
    if (path.isAbsolute(p)) {
      finalPath = p;
    } else {
      finalPath = path.join(finalPath, p);
    }
  }
  return finalPath;
}
