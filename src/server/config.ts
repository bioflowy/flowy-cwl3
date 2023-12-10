import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
extendZodWithOpenApi(z);

export const SharedFileSystemSchema = z
  .object({
    type: z.enum(['s3', 'nfs']),
    rootUrl: z.string().url(),
    region: z.string().optional(),
    endpoint: z.string().optional(),
    accessKey: z.string().optional(),
    secretKey: z.string().optional(),
  })
  .openapi('SharedFileSystemConfig');

export type SharedFileSystem = z.infer<typeof SharedFileSystemSchema>;
export const ServerConfigSchema = z.object({
  sharedFileSystem: SharedFileSystemSchema,
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
