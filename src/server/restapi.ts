import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import fastify from 'fastify';
import { z } from 'zod';
import { JobExec, JobExecSchema } from '../JobExecutor.js';
import { DirectorySchema, FileSchema } from '../cwltypes.js';
import { StagingCommandNameSchema } from '../staging.js';
import { SharedFileSystemSchema } from './config.js';
import { Server } from './server.js';

extendZodWithOpenApi(z);

const DoEvalRequestSchema = z.object({
  id: z.string(),
  ex: z.string(),
  context: z.any(),
});
export type DoEvalRequest = z.infer<typeof DoEvalRequestSchema>;
const ResultFilesSchema = z.record(z.array(z.union([FileSchema, DirectorySchema])));
export type ResultFiles = z.infer<typeof ResultFilesSchema>;

export const JobFinishedRequestSchema = z
  .object({
    id: z.string(),
    isCwlOutput: z.boolean(),
    exitCode: z.number().int(),
    results: z.record(z.any()),
  })
  .openapi('JobFinishedRequest');
const WorkerStartedInput = z.object({
  hostname: z.string(),
  cpu: z.number().int(),
  memory: z.number().int().openapi({ description: 'memory in MB' }),
});

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

export function appendApi(s: Server, server: fastify.FastifyInstance) {
  server.post('/v1/api/workerStarted', async (request, reply) => {
    const jsonData = request.body as z.infer<typeof WorkerStartedInput>;
    console.log('worker started', jsonData);
    await reply.send(s.getServerConfig().sharedFileSystem);
  });
  server.post('/v1/api/do_eval', async (request, reply) => {
    const jsonData = request.body as DoEvalRequest;
    const ret = await s.evaluate(jsonData.id, jsonData.ex, jsonData.context);
    await reply.send({ result: ret });
  });
  server.post('/v1/api/getExectableJob', async (request, reply) => {
    const jobs: JobExec[] = [];
    const ret = s.getExecutableJob();
    if (ret) {
      jobs.push(ret);
    }
    await reply.send(jobs);
  });
  server.post(
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
      s.jobfinished(jsonData.id, jsonData.exitCode, jsonData.isCwlOutput, jsonData.results);
      await reply.send({ message: 'OK' });
    },
  );
  server.post(
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
      s.jobfailed(jsonData.id, jsonData.errorMsg);
      await reply.send({ message: 'OK' });
    },
  );
}

export function createDocument() {
  const registry = new OpenAPIRegistry();
  registry.register('StagingCommandName', StagingCommandNameSchema.openapi('StagingCommandName'));
  registry.registerPath({
    method: 'post',
    path: '/api/workerStarted',
    description: 'report worker started and return shared file system settings',
    request: {
      body: {
        content: {
          'application/json': {
            schema: WorkerStartedInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Exectable jobs',
        content: {
          'application/json': {
            schema: SharedFileSystemSchema,
          },
        },
      },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/workerStopping',
    description: 'report worker stopping',
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
