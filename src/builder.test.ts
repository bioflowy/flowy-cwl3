import * as cwl from 'cwl-ts-auto';
import { describe, expect, test } from 'vitest';
import { Builder } from './builder.js';
import { StdFsAccess } from './stdfsaccess.js';
import { CommandInputParameter, CommandLineBinding } from './types.js';
describe('Vitest', () => {
  test('マッチャー', () => {
    const files = [];
    const bindings: CommandLineBinding[] = [];
    const schema = new CommandInputParameter();
    schema.name = 'reads';
    schema.inputBinding = new cwl.CommandLineBinding({ position: 3 });
    schema.type = new cwl.CommandInputArraySchema({ type: 'array' as any, items: 'org.w3id.cwl.cwl.File' });
    const schema_r = {
      name: 'input_record_schema',
      type: 'record',
      fields: [schema],
    };
    const datum = {
      reads: [
        {
          class: 'File',
          location: 'file:///home/uehara/flowy-cwl3/tests/example_human_Illumina.pe_1.fastq',
          basename: 'example_human_Illumina.pe_1.fastq',
          nameext: '.fastq',
          nameroot: 'example_human_Illumina.pe_1',
        },
        {
          class: 'File',
          location: 'file:///home/uehara/flowy-cwl3/tests/example_human_Illumina.pe_2.fastq',
          basename: 'example_human_Illumina.pe_2.fastq',
          nameext: '.fastq',
          nameroot: 'example_human_Illumina.pe_2',
        },
      ],
    };

    const builder = new Builder(
      {},
      files,
      bindings,
      {},
      [],
      [],
      [],
      {},
      null,
      null,
      (val) => new StdFsAccess(val),
      new StdFsAccess('.'),
      null,
      null,
      true,
      true,
      false,
      [],
      '/out',
      '/tmp',
      'stage',
      'v1.2',
      'docker',
    );
    const bindings2 = builder.bind_input(schema_r as any, datum, true);
    // bind_input();
    expect(bindings2.length).toBe(3);
  });
});
