import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from 'winston';
import { RuntimeContext, getDefault } from './context.js';
import { ValidationException, WorkflowException } from './errors.js';
import { JobBase } from './job.js';
import { _logger } from './loghandler.js';
import { Process, cleanIntermediate, relocateOutputs } from './process.js';
import { type CWLObjectType, type MutableSequence } from './utils.js';

class JobExecutor {
  final_output: MutableSequence<CWLObjectType | undefined>;
  final_status: string[];
  output_dirs: string[];

  constructor() {
    this.final_output = [];
    this.final_status = [];
    this.output_dirs = [];
  }

  async __call__(
    process: Process,
    job_order_object: CWLObjectType,
    runtime_context: RuntimeContext,
    logger: Logger = _logger,
  ): Promise<[CWLObjectType | undefined, string]> {
    return this.execute(process, job_order_object, runtime_context, logger);
  }

  output_callback(out: CWLObjectType | undefined, process_status: string): void {
    this.final_status.push(process_status);
    this.final_output.push(out);
  }

  async run_jobs(
    process: Process,
    job_order_object: CWLObjectType,
    logger: Logger,
    runtime_context: RuntimeContext,
  ): Promise<void> {
    throw new Error('Method not implemented.');
  }
  async execute(
    process: Process,
    job_order_object: CWLObjectType,
    runtime_context: RuntimeContext,
    logger: Logger = _logger,
  ): Promise<[CWLObjectType | null, string]> {
    this.final_output = [];
    this.final_status = [];

    if (!runtime_context.basedir) {
      throw new WorkflowException("Must provide 'basedir' in runtimeContext");
    }

    const check_for_abstract_op = (tool: CWLObjectType): void => {
      if (tool['class'] === 'Operation') {
        throw new WorkflowException('Workflow has unrunnable abstract Operation');
      }
    };

    process.visit(check_for_abstract_op);

    let finaloutdir: string | null = null;
    const original_outdir = runtime_context.outdir;
    if (typeof original_outdir === 'string') {
      finaloutdir = path.resolve(original_outdir);
    }
    // runtime_context = runtime_context.copy();
    const outdir = runtime_context.createOutdir();
    this.output_dirs.push(outdir);
    runtime_context.outdir = outdir;
    //    runtime_context.mutation_manager = new MutationManager();
    runtime_context.toplevel = true;

    // let job_reqs: CWLObjectType[] | null = null;
    // if ('https://w3id.org/cwl/cwl#requirements' in job_order_object) {
    //   if (process.metadata.get(ORIGINAL_CWLVERSION) === 'v1.0') {
    //     throw new WorkflowException(
    //       '`cwl:requirements` in the input object is not part of CWL ' +
    //         'v1.0. You can adjust to use `cwltool:overrides` instead; or you ' +
    //         'can set the cwlVersion to v1.1',
    //     );
    //   }
    //   job_reqs = job_order_object['https://w3id.org/cwl/cwl#requirements'] as CWLObjectType[];
    // } else if (
    //   'cwl:defaults' in process.metadata &&
    //   'https://w3id.org/cwl/cwl#requirements' in process.metadata['cwl:defaults']
    // ) {
    //   if (process.metadata.get(ORIGINAL_CWLVERSION) === 'v1.0') {
    //     throw new WorkflowException(
    //       '`cwl:requirements` in the input object is not part of CWL ' +
    //         'v1.0. You can adjust to use `cwltool:overrides` instead; or you ' +
    //         'can set the cwlVersion to v1.1',
    //     );
    //   }
    //   job_reqs = process.metadata['cwl:defaults']['https://w3id.org/cwl/cwl#requirements'];
    // }
    // if (job_reqs !== null) {
    //   for (const req of job_reqs) {
    //     process.requirements.push(req);
    //   }
    // }

    await this.run_jobs(process, job_order_object, logger, runtime_context);

    if (this.final_output && this.final_output[0] !== undefined && finaloutdir !== null) {
      this.final_output[0] = await relocateOutputs(
        this.final_output[0],
        finaloutdir,
        new Set(this.output_dirs),
        runtime_context.move_outputs,
        runtime_context.make_fs_access(''),
        getDefault(runtime_context.compute_checksum, true),
      );
    }

    if (runtime_context.rm_tmpdir) {
      let output_dirs: string[];
      if (!runtime_context.cachedir) {
        output_dirs = this.output_dirs;
      } else {
        output_dirs = this.output_dirs.filter((x) => !x.startsWith(runtime_context.cachedir));
      }
      cleanIntermediate(output_dirs);
    }

    if (this.final_output && this.final_status) {
      if (
        runtime_context.research_obj !== null &&
        (process instanceof JobBase || process instanceof Process) &&
        // ||
        // process instanceof WorkflowJobStep ||
        // process instanceof WorkflowJob
        process.parent_wf
      ) {
        const process_run_id: string | null = null;
        const name = 'primary';
        process.parent_wf.generate_output_prov(this.final_output[0], process_run_id, name);
        process.parent_wf.document.wasEndedBy(
          process.parent_wf.workflow_run_uri,
          null,
          process.parent_wf.engine_uuid,
          new Date(),
        );
        process.parent_wf.finalize_prov_profile(null);
      }
      return [this.final_output[0], this.final_status[0]];
    }
    return [null, 'permanentFail'];
  }
}
export class SingleJobExecutor extends JobExecutor {
  override async run_jobs(
    process: Process,
    job_order_object: CWLObjectType,
    logger: Logger,
    runtime_context: RuntimeContext,
  ): Promise<void> {
    const process_run_id: string | undefined = undefined;

    // if (!(process instanceof Workflow) && runtime_context.research_obj !== null) {
    //   process.provenance_object = new ProvenanceProfile(
    //     runtime_context.research_obj,
    //     runtime_context.cwl_full_name,
    //     false,
    //     false,
    //     runtime_context.orcid,
    //     runtime_context.research_obj.ro_uuid,
    //     runtime_context.make_fs_access(''),
    //   );
    //   process.parent_wf = process.provenance_object;
    // }

    const jobiter = process.job(
      job_order_object,
      (out: CWLObjectType | undefined, process_status: string) => this.output_callback(out, process_status),
      runtime_context,
    );

    try {
      for await (const job of jobiter) {
        if (job !== null) {
          if (runtime_context.builder !== undefined && job.hasOwnProperty('builder')) {
            (job as any).builder = runtime_context.builder;
          }
          if (job.outdir !== null) {
            this.output_dirs.push(job.outdir);
          }
          if (runtime_context.research_obj !== null) {
            // const prov_obj = process instanceof Workflow ? job.prov_obj : process.provenance_object;
            // if (prov_obj) {
            //   runtime_context.prov_obj = prov_obj;
            //   prov_obj.fsaccess = runtime_context.make_fs_access('');
            //   prov_obj.evaluate(process, job, job_order_object, runtime_context.research_obj);
            //   process_run_id = prov_obj.record_process_start(process, job);
            //   runtime_context = runtime_context.copy();
            // }
            // runtime_context.process_run_id = process_run_id;
          }
          await job.run(runtime_context);
        } else {
          logger.error('Workflow cannot make any more progress.');
          break;
        }
      }
    } catch (err) {
      if (err instanceof ValidationException || err instanceof WorkflowException) {
        throw err;
      } else {
        logger.warn('Got workflow error', err);
        throw err;
      }
    }
  }
}
