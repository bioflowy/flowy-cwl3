import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import * as url from 'node:url';
import {
  GetObjectCommand,
  GetObjectCommandInput,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import fsExtra from 'fs-extra/esm';
import * as glob from 'glob';
import { SharedFileSystem } from './server/config.js';
export function abspath(src: string, basedir: string): string {
  let abpath: string;
  if (src.startsWith('file://')) {
    abpath = url.fileURLToPath(src);
  } else if (src.startsWith('s3://') || src.startsWith('S3://')) {
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
  async downloadS3Object(s3path: string, downloadPath: string): Promise<void> {
    const s3url = new URL(s3path);
    let key = s3url.pathname;
    key = key.startsWith('/') ? key.substring(1) : key;
    const getObjectInput: GetObjectCommandInput = {
      Bucket: s3url.host,
      Key: key,
    };

    try {
      const s3Client = this._getS3();
      const data = await s3Client.send(new GetObjectCommand(getObjectInput));
      if (data.Body) {
        const stream = data.Body as Readable;
        const writeStream = createWriteStream(downloadPath);
        stream.pipe(writeStream);
        return await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      } else {
        throw new Error('File body is empty');
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      throw error;
    }
  }
  async copy(src: string, dst: string) {
    if (src.startsWith('s3://')) {
      await this.downloadS3Object(src, dst);
    } else {
      fsExtra.copySync(src, dst, { preserveTimestamps: true, overwrite: true });
    }
  }
  s3: S3Client;
  sharedFileSystem: SharedFileSystem;
  basedir: string;

  constructor(basedir: string, sharedFileSystem: SharedFileSystem) {
    this.basedir = basedir;
    this.sharedFileSystem = sharedFileSystem;
  }
  private _getS3(): S3Client {
    if (!this.s3) {
      if (this.sharedFileSystem.type !== 's3') {
        throw new Error('s3 shared file system is not configured');
      }
      this.s3 = new S3Client({
        forcePathStyle: true,
        region: this.sharedFileSystem.region,
        endpoint: this.sharedFileSystem.endpoint,
        credentials: {
          accessKeyId: this.sharedFileSystem.accessKey,
          secretAccessKey: this.sharedFileSystem.secretKey,
        },
      });
    }
    return this.s3;
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
  async exists(fn: string): Promise<boolean> {
    if (fn.startsWith('s3://')) {
      const response = await this.headObject(fn);
      return response !== undefined;
    } else {
      return fs.existsSync(this._abs(fn));
    }
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
  async headObject(fn: string): Promise<HeadObjectCommandOutput> {
    const s3url = new URL(fn);
    const s3 = this._getS3();
    let key = s3url.pathname;
    key = key.startsWith('/') ? key.substring(1) : key;
    const command = new HeadObjectCommand({
      Bucket: s3url.host,
      Key: key,
    });

    return s3.send(command);
  }
  async isdirs3(fn: string): Promise<boolean> {
    const response = await this.headObject(fn);
    if (response.Metadata === undefined) {
      return false;
    }
    return response.Metadata['x-amz-meta-filetype'] === 'directory';
  }
  async isdir(fn: string): Promise<boolean> {
    if (fn.startsWith('s3://')) {
      return this.isdirs3(fn);
    }
    const p = this._statSync(this._abs(fn));
    return p ? p.isDirectory() : false;
  }

  async listdirS3(fn: string): Promise<string[]> {
    const s3url = new URL(fn);
    const s3 = this._getS3();
    let key = s3url.pathname.endsWith('/') ? s3url.pathname : `${s3url.pathname}/`;
    key = key.startsWith('/') ? key.substring(1) : key;
    const command = new ListObjectsV2Command({
      Bucket: s3url.host,
      Prefix: key,
    });

    const response = await s3.send(command);
    const contents = response.Contents.filter((content) => content.Key !== key);
    return (
      contents?.map((object) => {
        const u = `s3://${s3url.host}/${object.Key}`;
        return u;
      }) ?? []
    );
  }
  async listdir(fn: string): Promise<string[]> {
    if (fn.startsWith('s3://')) {
      return this.listdirS3(fn);
    }
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
