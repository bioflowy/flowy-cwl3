import * as path from 'node:path';
import type { Logger } from 'winston';
import { RuntimeContext, getDefault } from './context.js';
import { ValidationException, WorkflowException } from './errors.js';
import { JobBase } from './job.js';
import { _logger } from './loghandler.js';
import { Process, cleanIntermediate, relocateOutputs } from './process.js';
import { createRequirements } from './types.js';
import { type CWLObjectType, type MutableSequence } from './utils.js';

abstract class JobExecutor {
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

  abstract run_jobs(
    _process: Process,
    _job_order_object: CWLObjectType,
    _logger: Logger,
    _runtime_context: RuntimeContext,
  ): Promise<void>;

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

    let job_reqs: CWLObjectType[] | null = null;
    if ('cwl:requirements' in job_order_object) {
      job_reqs = job_order_object['cwl:requirements'] as CWLObjectType[];
    }
    if (job_reqs !== null) {
      for (const req of job_reqs) {
        const r = createRequirements(req);
        if (r) {
          process.requirements.push(r);
        }
      }
    }

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
      await cleanIntermediate(output_dirs);
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
    const jobiter = process.job(
      job_order_object,
      (out: CWLObjectType | undefined, process_status: string) => this.output_callback(out, process_status),
      runtime_context,
    );

    try {
      for await (const job of jobiter) {
        if (job) {
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
