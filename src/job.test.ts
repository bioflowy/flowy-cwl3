import * as fs from 'node:fs';
import { v4 } from 'uuid';
import { describe, expect, test } from 'vitest';
import { _job_popen } from './job.js';
describe('Vitest', () => {
  test('マッチャー', async () => {
    const tmp_path = `tmp${v4()}`;
    fs.mkdirSync(tmp_path);
    const rcode = await _job_popen(
      ['touch', 'test.txt'],
      '',
      '',
      '',
      {},
      tmp_path,
      () => 'test',
      '',
      0,
      'test',
      () => '',
    );
    expect(rcode).toBe(0);
  });
});
