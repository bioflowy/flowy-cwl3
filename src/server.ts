import fs from 'node:fs';
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import fastify, { FastifyReply, FastifyRequest } from 'fastify';
import jsYaml from 'js-yaml';
import { z } from 'zod';
import { JobExec, JobExecSchema } from './JobExecutor.js';
import { Builder } from './builder.js';
import { Directory, DirectorySchema, File, FileSchema } from './cwltypes.js';
import { WorkflowException } from './errors.js';
import { StagingCommandNameSchema } from './staging.js';
import { CWLOutputType } from './utils.js';

extendZodWithOpenApi(z);

const DoEvalRequestSchema = z.object({
  id: z.string(),
  ex: z.string(),
  context: FileSchema.or(DirectorySchema).optional(),
});
export type DoEvalRequest = z.infer<typeof DoEvalRequestSchema>;
const ResultFilesSchema = z.record(z.array(z.union([FileSchema, DirectorySchema])));
export type ResultFiles = z.infer<typeof ResultFilesSchema>;

export const JobFinishedRequestSchema = z
  .object({
    id: z.string(),
    exitCode: z.number().int(),
    results: ResultFilesSchema,
  })
  .openapi('JobFinishedRequest');

export const JobFailedRequestSchema = z.object({
  id: z.string(),
  errorMsg: z.string(),
});
export type JobFinishedRequest = z.infer<typeof JobFinishedRequestSchema>;
export type JobFailedRequest = z.infer<typeof JobFailedRequestSchema>;
export const DoEvalResultSchema = z
  .object({
    string_value: z.string().optional(),
    json_value: z.record(z.any()).optional(),
    boolean_value: z.boolean().optional(),
  })
  .openapi('DoEvalResult');
export class Server {
  private server: fastify.FastifyInstance;
  private builders: Map<string, Builder> = new Map();
  private executableJobs: JobExec[] = [];
  private jobPromises: Map<
    string,
    { resolve: (value: [number, ResultFiles]) => void; reject: (error: Error) => void }
  > = new Map();
  constructor() {
    this.server = fastify();

    this.server.post('/v1/api/do_eval', async (request, reply) => {
      const jsonData = request.body as DoEvalRequest;
      const ret = await this.evaluate(jsonData.id, jsonData.ex, jsonData.context);
      await reply.send({ result: ret });
    });
    this.server.post('/v1/api/getExectableJob', async (request, reply) => {
      const jobs: JobExec[] = [];
      const ret = this.getExecutableJob();
      if (ret) {
        jobs.push(ret);
      }
      await reply.send(jobs);
    });
    this.server.post(
      '/v1/api/jobFinished',
      {
        schema: {
          description: 'Example route',
          tags: ['example'],
          request: {
            description: 'Example POST body',
            type: 'object',
            properties: {
              id: { type: 'string' },
              exitCode: { type: 'int' },
              hello: { type: 'string' },
            },
          },
          response: {
            200: {
              description: 'Successful response',
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const jsonData = request.body as JobFinishedRequest;
        this.jobfinished(jsonData.id, jsonData.exitCode, jsonData.results);
        await reply.send({ message: 'OK' });
      },
    );
    this.server.post(
      '/v1/api/jobFailed',
      {
        schema: {
          description: 'report job failed',
          tags: ['example'],
          request: {
            description: 'job failed',
            type: 'object',
            properties: {
              id: { type: 'string' },
              errorMsg: { type: 'string' },
            },
            required: ['id', 'errorMsg'],
          },
          response: {
            200: {
              description: 'Successful response',
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const jsonData = request.body as JobFailedRequest;
        this.jobfailed(jsonData.id, jsonData.errorMsg);
        await reply.send({ message: 'OK' });
      },
    );
  }
  createDocument() {
    const registry = new OpenAPIRegistry();
    registry.register('StagingCommandName', StagingCommandNameSchema.openapi('StagingCommandName'));
    registry.registerPath({
      method: 'post',
      path: '/api/getExectableJob',
      description: 'Get executable job',
      summary: 'Get a single user',
      responses: {
        200: {
          description: 'Exectable jobs',
          content: {
            'application/json': {
              schema: JobExecSchema.array(),
            },
          },
        },
      },
    });
    registry.registerPath({
      method: 'post',
      path: '/api/do_eval',
      description: 'report job failed',
      summary: 'report job failed',
      request: {
        body: {
          content: {
            'application/json': {
              schema: DoEvalRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Exectable jobs',
          content: {
            'application/json': {
              schema: z.any(),
            },
          },
        },
      },
    });
    registry.registerPath({
      method: 'post',
      path: '/api/jobFailed',
      description: 'report job failed',
      summary: 'report job failed',
      request: {
        body: {
          content: {
            'application/json': {
              schema: JobFailedRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Exectable jobs',
          content: {
            'application/json': {
              schema: z.string(),
            },
          },
        },
      },
    });
    registry.registerPath({
      method: 'post',
      path: '/api/jobFinished',
      description: 'report job finished',
      summary: 'report job finished',
      request: {
        body: {
          content: {
            'application/json': {
              schema: JobFinishedRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Exectable jobs',
          content: {
            'application/json': {
              schema: z.string(),
            },
          },
        },
      },
    });
    const generator = new OpenApiGeneratorV3(registry.definitions);

    return generator.generateDocument({
      openapi: '3.0.0',
      info: {
        version: '1.0.0',
        title: 'My API',
        description: 'This is the API',
      },
      servers: [{ url: 'v1' }],
    });
  }
  writeDocumentation() {
    // OpenAPI JSON
    const docs = this.createDocument();
    // YAML equivalent
    const fileContent = jsYaml.dump(docs);

    fs.writeFileSync(`openapi-docs.yml`, fileContent, {
      encoding: 'utf-8',
    });
  }

  addBuilder(id: string, builder: Builder) {
    this.builders.set(id, builder);
  }
  async execute(id: string, job: JobExec): Promise<[number, ResultFiles]> {
    this.executableJobs.push(job);
    const promise = new Promise<[number, ResultFiles]>((resolve, reject) => {
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
  jobfinished(id: string, ret_code: number, outputResults: { [key: string]: (File | Directory)[] }) {
    const promise = this.jobPromises.get(id);
    if (promise) {
      promise.resolve([ret_code, outputResults]);
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
      await this.server.listen(3000);
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
