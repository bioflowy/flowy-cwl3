import fs from 'node:fs';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import fastify from 'fastify';
import jsYaml from 'js-yaml';
import { JobExec } from '../JobExecutor.js';
import { Builder } from '../builder.js';
import { Directory, File } from '../cwltypes.js';
import { WorkflowException } from '../errors.js';
import { CWLOutputType } from '../utils.js';
import { ServerConfig, ServerConfigSchema } from './config.js';
import { ResultFiles, appendApi, createDocument } from './restapi.js';
import { appRouter } from './router.js';

let config: ServerConfig;

export function getServerConfig(): ServerConfig {
  return config;
}
export class Server {
  private server: fastify.FastifyInstance;
  private config: ServerConfig;
  private builders: Map<string, Builder> = new Map();
  private executableJobs: JobExec[] = [];
  private jobPromises: Map<
    string,
    { resolve: (value: [number, boolean, ResultFiles]) => void; reject: (error: Error) => void }
  > = new Map();
  constructor() {
    this.server = fastify();
  }
  getServerConfig(): ServerConfig {
    return this.config;
  }
  async initialize(configPath: string = 'config.yml') {
    const data = jsYaml.load(fs.readFileSync(configPath, 'utf-8'));
    this.config = ServerConfigSchema.parse(data);
    config = this.config;
    await this.server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: { router: appRouter },
    });
    appendApi(this, this.server);
  }
  writeDocumentation() {
    // OpenAPI JSON
    const docs = createDocument();
    // YAML equivalent
    const fileContent = jsYaml.dump(docs);

    fs.writeFileSync(`openapi-docs.yml`, fileContent, {
      encoding: 'utf-8',
    });
  }

  addBuilder(id: string, builder: Builder) {
    this.builders.set(id, builder);
  }
  async execute(id: string, job: JobExec): Promise<[number, boolean, ResultFiles]> {
    this.executableJobs.push(job);
    const promise = new Promise<[number, boolean, ResultFiles]>((resolve, reject) => {
      this.jobPromises.set(id, { resolve, reject });
    });
    return promise;
  }
  async evaluate(id: string, ex: string, context: File | Directory): Promise<CWLOutputType> {
    const builder = this.builders.get(id);
    return builder.do_eval(ex, context, false);
  }
  getExecutableJob(): JobExec | undefined {
    if (this.executableJobs.length === 0) {
      return undefined;
    } else {
      return this.executableJobs.pop();
      // return this.executableJobs[0];
    }
  }
  jobfinished(
    id: string,
    ret_code: number,
    isCwlOutput: boolean,
    outputResults: { [key: string]: (File | Directory)[] },
  ) {
    const promise = this.jobPromises.get(id);
    if (promise) {
      promise.resolve([ret_code, isCwlOutput, outputResults]);
      this.jobPromises.delete(id);
    }
  }
  jobfailed(id: string, errorMsg: string) {
    const promise = this.jobPromises.get(id);
    if (promise) {
      promise.reject(new WorkflowException(errorMsg));
      this.jobPromises.delete(id);
    }
  }
  async start() {
    try {
      await this.initialize();
      await this.server.listen({ port: 3000 });
      process.on('SIGTERM', () => {
        this.close()
          .then(() => {
            console.log('flowy-server stopped');
            // eslint-disable-next-line n/no-process-exit
            process.exit(0);
          })
          .catch((e) => {
            console.log(e);
            // eslint-disable-next-line n/no-process-exit
            process.exit(1);
          });
      });
    } catch (error) {
      this.server.log.error(error);
      throw error;
    }
  }
  async close(): Promise<void> {
    await this.server.close();
  }
}
const instance = new Server();
export function getServer(): Server {
  return instance;
}
