import jsYaml from 'js-yaml';
import { describe, expect, test } from 'vitest';
import { exec } from './main.js';
describe('conformance_test', () => {
  const data = jsYaml.load('conformance_test.yaml') as { [key: string]: any }[];
  for (let index = 2; index < data.length; index++) {
    const testdata = data[index];
    test(testdata['id'], async () => {
      console.log(testdata['doc']);
      const job_path = testdata['job'] as string;
      const tool_path = testdata['job'] as string;
      const expected_outputs = testdata['output'] as string;
      const [output, status] = await exec(tool_path, job_path);
      expect(status).toBe('success');
      expect(output).toStrictEqual(expected_outputs);
    });
  }
});
