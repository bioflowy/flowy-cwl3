import { log } from 'node:console';
import { DefaultFetcher, Fetcher } from 'cwl-ts-auto/dist/util/Fetcher.js';
import { fetcher } from 'rdflib';
import { getFileContentFromS3 } from './builder.js';
import { getServerConfig } from './server/server.js';

export function dirnames3(path: string): string {
  let dirname = path.split('/').slice(0, -1).join('/');
  if (!dirname.endsWith('/')) {
    dirname = `${dirname}/`;
  }
  return dirname;
}
export type StringMap = { [key: string]: string };
export class S3Fetcher extends Fetcher {
  fetcher: DefaultFetcher = new DefaultFetcher();
  async fetchText(url: string, _?: string[]): Promise<string> {
    const config = getServerConfig();
    const content = await getFileContentFromS3(config.sharedFileSystem, url, true);
    return content;
  }
  checkExists(urlString: string): boolean {
    return this.fetcher.checkExists(urlString);
  }
  urljoin(baseUrlString: string, urlString: string): string {
    return this.fetcher.urljoin(baseUrlString, urlString);
  }
  static override schemes = ['s3'];
}
