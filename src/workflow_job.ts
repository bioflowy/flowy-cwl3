import { copy } from 'copy';
import { datetime } from 'datetime';
import { threading } from 'threading';
import { logging } from 'logging';
import { functools } from 'functools';
import * as cwl_utils from 'cwl_utils';
import { SourceLine } from 'schema_salad.sourceline';
import { json_dumps } from 'schema_salad.utils';
import { content_limit_respected_read } from './builder.js';
import { can_assign_src_to_sink } from './checker';
import { RuntimeContext, getdefault } from './context.js';
import { WorkflowException } from './errors';
import { _logger } from './loghandler.js';
import { shortname, uniquename } from './process.js';
import { StdFsAccess } from './stdfsaccess.js';
import { CWLObjectType, CWLOutputType, JobsGeneratorType, OutputCallbackType, ParametersType, ScatterDestinationsType, ScatterOutputCallbackType, SinkType, WorkflowStateItem, adjustDirObjs, aslist, get_listing } from './utils';

if (TYPE_CHECKING) {
    import { ProvenanceProfile } from './cwlprov.provenance_profile';
    import { Workflow, WorkflowStep } from './workflow';
}

class WorkflowJobStep {
    step: WorkflowStep;
    tool: any;
    id: string;
    submitted: boolean;
    iterable?: JobsGeneratorType;
    completed: boolean;
    name: string;
    prov_obj: any;
    parent_wf: any;

    constructor(step: WorkflowStep) {
        this.step = step;
        this.tool = step.tool;
        this.id = step.id;
        this.submitted = false;
        this.completed = false;
        this.name = uniquename("step " + shortname(this.id));
        this.prov_obj = step.prov_obj;
        this.parent_wf = step.parent_wf;
    }

    *job(joborder: CWLObjectType, output_callback? OutputCallbackType, runtimeContext: RuntimeContext) {
        let { ...context } = runtimeContext;
        context.part_of = this.name;
        context.name = shortname(this.id);

        _logger.info(`[${this.name}] start`);

        yield* this.step.job(joborder, output_callback, context);
    }
};

class ReceiveScatterOutput {
    dest: ScatterDestinationsType;
    completed: number;
    processStatus: string;
    total: number;
    output_callback: ScatterOutputCallbackType;
    steps?: Array<JobsGeneratorType | undefined>;

    constructor(
        output_callback: ScatterOutputCallbackType,
        dest: ScatterDestinationsType,
        total: number
    ) {
        this.dest = dest;
        this.completed = 0;
        this.processStatus = "success";
        this.total = total;
        this.output_callback = output_callback;
    }

    receive_scatter_output(index: number, jobout: CWLObjectType, processStatus: string) {
        for (let [key, val] of Object.entries(jobout)) {
            this.dest[key][index] = val;
        }

        if (this.steps) {
            this.steps[index] = undefined;
        }

        if (processStatus !== "success") {
            if (this.processStatus !== "permanentFail") {
                this.processStatus = processStatus;
            }
        }

        this.completed += 1;

        if (this.completed === this.total) {
            this.output_callback(this.dest, this.processStatus);
        }
    }

    setTotal(
        total: number,
        steps: Array<JobsGeneratorType | undefined>
    ) {
        this.total = total;
        this.steps = [];
        if (this.completed === this.total) {
            this.output_callback(this.dest, this.processStatus);
        }
    }
}
function* parallel_steps(
    steps: (JobsGeneratorType | null)[],
    rc: ReceiveScatterOutput,
    runtimeContext: RuntimeContext,
): IterableIterator<JobsGeneratorType> {
    while (rc.completed < rc.total) {
        let made_progress = false;
        for (const [index, step] of steps.entries()) {
            if (getdefault(runtimeContext.on_error, "stop") === "stop" && !["success", "skipped"].includes(rc.processStatus)) {
                break;
            }
            if (step === null){
                continue;
            }
            try {
                for (const j of step) {
                    if (getdefault(runtimeContext.on_error, "stop") === "stop" && !["success", "skipped"].includes(rc.processStatus)) {
                        break;
                    }
                    if (j !== null) {
                        made_progress = true;
                        yield j;
                    } else {
                        break;
                    }
                }
                if (made_progress) {
                    break;
                }
            } catch (exc) {
                if (exc instanceof WorkflowException) {
                    _logger.error(`Cannot make scatter job: ${exc.toString()}`);
                    _logger.debug("", {exc_info: true});
                    rc.receive_scatter_output(index, {}, "permanentFail");
                }
            }
        }
        if (!made_progress && rc.completed < rc.total) {
            yield null;
        }
    }
}

function* nested_crossproduct_scatter(
    process: WorkflowJobStep,
    joborder: CWLObjectType,
    scatter_keys: string[],
    output_callback: ScatterOutputCallbackType,
    runtimeContext: RuntimeContext,
): IterableIterator<JobsGeneratorType> {
    const scatter_key = scatter_keys[0];
    const jobl = (joborder[scatter_key] as any).length;
    const output: ScatterDestinationsType = {};
    for (const i of process.tool["outputs"]) {
        output[i["id"]] = new Array(jobl).fill(null)
    }

    const rc = new ReceiveScatterOutput(output_callback, output, jobl);
    const steps: (JobsGeneratorType | null)[] = [];
    for (let index=0; index < jobl; index++) {
        let sjob: CWLObjectType = {...joborder};
        sjob[scatter_key] = (joborder[scatter_key] as any)[index];

        if (scatter_keys.length === 1) {
            if (runtimeContext.postScatterEval !== undefined){
                sjob = runtimeContext.postScatterEval(sjob);
            }
            const curriedcallback = rc.receive_scatter_output.bind(rc, index);
            if (sjob !==null) {
                steps.push(process.job(sjob, curriedcallback, runtimeContext));
            } else {
                curriedcallback({}, "skipped");
                steps.push(null);
            }
        } else {
            steps.push(nested_crossproduct_scatter(
                process,
                sjob,
                scatter_keys.slice(1),
                rc.receive_scatter_output.bind(rc, index),
                runtimeContext,
            ));
        }
    }

    rc.setTotal(jobl, steps);
    yield* parallel_steps(steps, rc, runtimeContext);
}
crossproduct_size(joborder: CWLObjectType, scatter_keys: MutableSequence<string>): number {
    let scatter_key = scatter_keys[0];
    let ssum;

    if (scatter_keys.length == 1) {
        ssum = joborder[scatter_key].length;
    } else {
        ssum = 0;
        for (let _ = 0; _ < joborder[scatter_key].length; _++) {
            ssum += this.crossproduct_size(joborder, scatter_keys.slice(1));
        }
    }
    return ssum;
}

flat_crossproduct_scatter(
    process: WorkflowJobStep,
    joborder: CWLObjectType,
    scatter_keys: MutableSequence<string>,
    output_callback: ScatterOutputCallbackType,
    runtimeContext: RuntimeContext,
): JobsGeneratorType {
    let output: ScatterDestinationsType = {};

    for (let i of process.tool["outputs"]) {
        output[i["id"]] = Array(this.crossproduct_size(joborder, scatter_keys)).fill(null);
    }
    let callback = new ReceiveScatterOutput(output_callback, output, 0);
    let [steps, total] = this._flat_crossproduct_scatter(
        process, joborder, scatter_keys, callback, 0, runtimeContext
    );
    callback.setTotal(total, steps);
    return parallel_steps(steps, callback, runtimeContext);
}

_flat_crossproduct_scatter(
    process: WorkflowJobStep,
    joborder: CWLObjectType,
    scatter_keys: MutableSequence<string>,
    callback: ReceiveScatterOutput,
    startindex: number,
    runtimeContext: RuntimeContext,
): [Array<Optional<JobsGeneratorType>>, number] {

    let scatter_key = scatter_keys[0];
    let jobl = joborder[scatter_key].length;
    let steps: Array<Optional<JobsGeneratorType>> = [];
    let put = startindex;

    for (let index = 0; index < jobl; index++) {
        let sjob: Optional<CWLObjectType> = JSON.parse(JSON.stringify(joborder));
        sjob[scatter_key] = joborder[scatter_key][index];

        if (scatter_keys.length == 1) {
            if (runtimeContext.postScatterEval !== null) {
                sjob = runtimeContext.postScatterEval(sjob);
            }
            let curriedcallback = callback.receive_scatter_output.bind(null, put);
            if (sjob !== null) {
                steps.push(process.job(sjob, curriedcallback, runtimeContext));
            } else {
                curriedcallback({}, "skipped");
                steps.push(null);
            }
            put += 1;
        } else {
            let [add, _] = this._flat_crossproduct_scatter(
                process, sjob, scatter_keys.slice(1), callback, put, runtimeContext
            );
            put += add.length;
            steps = steps.concat(add);
        }


    }

    return [steps, put];
}
function dotproduct_scatter(
    process: WorkflowJobStep,
    joborder: CWLObjectType,
    scatter_keys: MutableSequence<string>,
    output_callback: ScatterOutputCallbackType,
    runtimeContext: RuntimeContext,
): JobsGeneratorType {
    let jobl: number | null = null;
    for (let key of scatter_keys) {
        if (jobl === null) {
            jobl = (<Sized> joborder[key]).length;
        }
        else if (jobl !== (<Sized> joborder[key]).length) {
            throw new WorkflowException(
                "Length of input arrays must be equal when performing " + "dotproduct scatter."
            );
        }
    }
    if (jobl === null) {
        throw new Error("Impossible codepath");
    }
    
    let output: ScatterDestinationsType = {};
    for (let i of process.tool["outputs"]) {
        output[i["id"]] = new Array(jobl).fill(null);
    }
    
    let rc = new ReceiveScatterOutput(output_callback, output, jobl);
    
    let steps: Array<JobsGeneratorType | null> = [];
    for (let index = 0; index < jobl; index++) {
        let sjobo: CWLObjectType | null = JSON.parse(JSON.stringify(joborder));
        for (let key of scatter_keys) {
            sjobo[key] = (<MutableMapping<number, CWLObjectType>> joborder[key])[index];
        }
        
        if (runtimeContext.postScatterEval !== null) {
            sjobo = runtimeContext.postScatterEval(sjobo);
        }
        
        let curriedcallback = rc.receive_scatter_output.bind(rc, index);
        
        if (sjobo !== null) {
            steps.push(process.job(sjobo, curriedcallback, runtimeContext));
        }
        else {
            curriedcallback({}, "skipped");
            steps.push(null);
        }
    }
    
    rc.setTotal(jobl, steps);
  
    return parallel_steps(steps, rc, runtimeContext);
}
function match_types(
    sinktype: SinkType | null,
    src: WorkflowStateItem,
    iid: string,
    inputobj: CWLObjectType,
    linkMerge: string | null,
    valueFrom: string | null,
): boolean {
    if (sinktype instanceof Array){
        for (let st of sinktype) {
            if (match_types(st, src, iid, inputobj, linkMerge, valueFrom)){
                return true;
            }
        }
    } else if (src.parameter["type"] instanceof Array){
        let original_types = src.parameter["type"];
        for (let source_type of original_types){
            src.parameter["type"] = source_type;
            let match = match_types(sinktype, src, iid, inputobj, linkMerge, valueFrom);
            if (match){
                src.parameter["type"] = original_types;
                return true;
            }
        }
        src.parameter["type"] = original_types;
        return false;
    } else if (linkMerge){
        if (!(iid in inputobj)){
            inputobj[iid] = [];
        }
        let sourceTypes: Array<CWLOutputType> | null = inputobj[iid];
        if (linkMerge === "merge_nested"){
            sourceTypes.push(src.value);
        } else if (linkMerge === "merge_flattened"){
            if (src.value instanceof Array){
                sourceTypes = sourceTypes.concat(src.value);
            } else {
                sourceTypes.push(src.value);
            }
        } else {
            throw new Error("Unrecognized linkMerge enum '" + linkMerge + "'");
        }
        return true;
    } else if (
        valueFrom !== null
        || can_assign_src_to_sink(<SinkType>src.parameter["type"], sinktype)
        || sinktype === "Any"
    ){
        inputobj[iid] = JSON.parse(JSON.stringify(src.value));
        return true;
    }
    return false;
}
function objectFromState(
    state: { [key: string]: WorkflowStateItem | null | undefined },
    params: ParametersType,
    fragOnly: boolean,
    supportsMultipleInput: boolean,
    sourceField: string,
    incomplete: boolean = false,
): CWLObjectType | null {
    let inputobj: CWLObjectType = {};
    for (let inp of params) {
        let iid = originalId = <string>inp["id"];
        if (fragOnly) {
            iid = shortname(iid);
        }
        if (sourceField in inp) {
            let connections = aslist(inp[sourceField]);
            if (connections.length > 1 && !supportsMultipleInput) {
                throw new WorkflowException(
                    "Workflow contains multiple inbound links to a single " +
                    "parameter but MultipleInputFeatureRequirement is not " +
                    "declared."
                );
            }
            for (let src of connections) {
                let aState = state[src] || null;
                if (aState && (
                    aState.success === "success" || aState.success === "skipped" || incomplete
                )) {
                    if (!matchTypes(
                        inp["type"],
                        aState,
                        iid,
                        inputobj,
                        <string | null>(inp["linkMerge"] ||
                            ((connections.length > 1) ? "merge_nested" : null)),
                        inp["valueFrom"] as string,
                    )) {
                        throw new WorkflowException(
                            "Type mismatch between source '" + src + "' (" + aState.parameter["type"] + ") and " +
                            "sink '" + originalId + "' (" + inp["type"] + ")"
                        );
                    }
                } else if (!(src in state)) {
                    throw new WorkflowException(
                        "Connect source '" + src + "' on parameter '" + originalId + "' does not exist"
                    );
                } else if (!incomplete) {
                    return null;
                }
            }
        }
        if ("pickValue" in inp && Array.isArray(inputobj[iid])) {
            let seq = <Array<CWLOutputType | null>>inputobj[iid];
            if (inp["pickValue"] === "first_non_null") {
                let found: boolean = false;
                for (let v of seq) {
                    if (v !== null) {
                        found = true;
                        inputobj[iid] = v;
                        break;
                    }
                }
                if (!found) {
                    throw new WorkflowException(
                        "All sources for '" + shortname(originalId) + "' are null"
                    );
                }
            } else if (inp["pickValue"] === "the_only_non_null") {
                let found: boolean = false;
                for (let v of seq) {
                    if (v !== null) {
                        if (found) {
                            throw new WorkflowException(
                                "Expected only one source for '" + shortname(originalId) + "' to be non-null, got " +
                                seq
                            );
                        }
                        found = true;
                        inputobj[iid] = v;
                    }
                }
                if (!found) {
                    throw new WorkflowException(
                        "All sources for '" + shortname(originalId) + "' are null"
                    );
                }
            } else if (inp["pickValue"] === "all_non_null") {
                inputobj[iid] = seq.filter(v => v !== null);
            }
        }
        if (inputobj[iid] === undefined && "default" in inp) {
            inputobj[iid] = inp["default"];
        }
        if (!(iid in inputobj) && ("valueFrom" in inp || incomplete)) {
            inputobj[iid] = null;
        }
        if (!(iid in inputobj)) {
            throw new WorkflowException("Value for " + originalId + " not specified");
        }
    }
    return inputobj;
}
class WorkflowJob {
    workflow: any;
    prov_obj: ProvenanceProfile | null;
    parent_wf: ProvenanceProfile | null;
    tool: any;
    steps: Array<WorkflowJobStep>;
    state: { [key: string]: WorkflowStateItem | null };
    processStatus: string;
    did_callback: boolean;
    made_progress: boolean | null;
    outdir: any;
    name: string;

    constructor(workflow: any, runtimeContext: any) {
        this.workflow = workflow;
        this.prov_obj = null;
        this.parent_wf = null;
        this.tool = workflow.tool;
        if (runtimeContext.research_obj !== null) {
            this.prov_obj = workflow.provenance_object;
            this.parent_wf = workflow.parent_wf;
        }
        this.steps = workflow.steps.map((s: any) => new WorkflowJobStep(s));
        this.state = {};
        this.processStatus = "";
        this.did_callback = false;
        this.made_progress = null;
        this.outdir = runtimeContext.get_outdir();

        this.name = uniquename(`workflow ${
            getdefault(runtimeContext.name, shortname(this.workflow.tool.get("id", "embedded")))}
        `);

        _logger.debug(
            "[%s] initialized from %s",
            this.name,
            this.tool.get("id", `workflow embedded in ${runtimeContext.part_of}`),
        );
    }

    do_output_callback(final_output_callback: any) {
        const supportsMultipleInput = Boolean(this.workflow.get_requirement("MultipleInputFeatureRequirement")[0]);

        let wo: any | null = null;
        try {
            wo = object_from_state(
                this.state,
                this.tool["outputs"],
                true,
                supportsMultipleInput,
                "outputSource",
                { incomplete: true },
            );
        } catch (err) {
            _logger.error("[%s] Cannot collect workflow output: %s", this.name, err.toString());
            this.processStatus = "permanentFail";
        }
        if (this.prov_obj && this.parent_wf && this.prov_obj.workflow_run_uri !== this.parent_wf.workflow_run_uri) {
            let process_run_id: string | null = null;
            this.prov_obj.generate_output_prov(wo || {}, process_run_id, this.name);
            this.prov_obj.document.wasEndedBy(
                this.prov_obj.workflow_run_uri,
                null,
                this.prov_obj.engine_uuid,
                new Date()
            );
            let prov_ids: any = this.prov_obj.finalize_prov_profile(this.name);
            this.parent_wf.activity_has_provenance(this.prov_obj.workflow_run_uri, prov_ids);
        }

        _logger.info("[%s] completed %s", this.name, this.processStatus);
        if (_logger.isEnabledFor(logging.DEBUG)) {
            _logger.debug("[%s] outputs %s", this.name, JSON.stringify(wo, null, 4));
        }

        this.did_callback = true;

        final_output_callback(wo, this.processStatus);
    }
}
receive_output(
    step: WorkflowJobStep,
    outputparms: CWLObjectType[],
    final_output_callback: OutputCallbackType,
    jobout: CWLObjectType,
    processStatus: string,
) {
    for (let i of outputparms) {
        if ("id" in i) {
            let iid = i["id"] as string;
            if (iid in jobout) {
                this.state[iid] = new WorkflowStateItem(i, jobout[iid], processStatus);
            } else {
                _logger.error(`[${step.name}] Output is missing expected field ${iid}`);
                processStatus = "permanentFail";
            }
        }
    }

    if (_logger.isEnabledFor(logging.DEBUG)) {
        _logger.debug(`[${step.name}] produced output ${json_dumps(jobout, 4)}`);
    }

    if (!["success", "skipped"].includes(processStatus)) {
        if (this.processStatus != "permanentFail") {
            this.processStatus = processStatus;
        }
        _logger.warning(`[${step.name}] completed ${processStatus}`);
    } else {
        _logger.info(`[${step.name}] completed ${processStatus}`);
    }

    step.completed = true;
    step.iterable = null;
    this.made_progress = true;

    let completed = this.steps.filter(s => s.completed).length;
    if (completed == this.steps.length) {
        this.do_output_callback(final_output_callback);
    }
}
tryMakeJob(
    this: any,
    step: WorkflowJobStep,
    finalOutputCallback: OutputCallbackType | undefined,
    runtimeContext: RuntimeContext,
): IterableIterator<JobsGeneratorType> {
    let containerEngine: string = "docker";
    if (runtimeContext.podman) {
        containerEngine = "podman";
    } else if (runtimeContext.singularity) {
        containerEngine = "singularity";
    }
    if (step.submitted) return;

    const inputParms = step.tool["inputs"];
    const outputParms = step.tool["outputs"];

    const supportsMultipleInput = Boolean(
        this.workflow.getRequirement("MultipleInputFeatureRequirement")[0]
    );

    try {
        const inputObj = objectFromState(
            this.state, inputParms, false, supportsMultipleInput, "source"
        );
        if (!inputObj) {
            _logger.debug(`[${this.name}] job step ${step.id} not ready`);
            return;
        }

        _logger.info(`[${this.name}] starting ${step.name}`);

        const callback = this.receiveOutput.bind(
            this, step, outputParms, finalOutputCallback
        );

        const valueFrom: {
            [key: string]: any;
        } = {};
        step.tool["inputs"].forEach((i: any) => {
            if ("valueFrom" in i) valueFrom[i["id"]] = i["valueFrom"];
        });

        const loadContents = new Set(
            step.tool["inputs"].map((i: any) => i.get("loadContents") && i["id"])
        );

        if (Object.keys(valueFrom).length > 0 &&
            !Boolean(this.workflow.getRequirement("StepInputExpressionRequirement")[0])
        ) {
            throw new WorkflowException(
                "Workflow step contains valueFrom but StepInputExpressionRequirement not in requirements"
            );
        }

        const postScatterEval = (io: CWLObjectType): CWLObjectType | undefined => {       

        // ... rest of the code
    }
    catch (err) {
        if (err instanceof WorkflowException) throw err;
       
        _logger.error("Unhandled exception", err);
       
        this.processStatus = "permanentFail";
        step.completed = true;
    }
}
run(runtimeContext: RuntimeContext, tmpdir_lock?: threading.Lock): void {
    _logger.info(`[${this.name}] start`);
}

*job(joborder: CWLObjectType, output_callback?: OutputCallbackType, runtimeContext: RuntimeContext): Generator<JobsGeneratorType, void, unknown> {
    this.state = {};
    this.processStatus = "success";

    if (_logger.isEnabledFor(logging.DEBUG)) {
        _logger.debug(`[${this.name}] inputs ${json_dumps(joborder, 4)}`);
    }

    runtimeContext = { ...runtimeContext, outdir: null };
    const debug = runtimeContext.debug;

    this.tool["inputs"].forEach((inp: any, index: number) => {
        with SourceLine(this.tool["inputs"], index, WorkflowException, debug) {
            const inp_id = shortname(inp["id"]);
            if (inp_id in joborder) {
                this.state[inp["id"]] = new WorkflowStateItem(inp, joborder[inp_id], "success");
            } else if ("default" in inp) {
                this.state[inp["id"]] = new WorkflowStateItem(inp, inp["default"], "success");
            } else {
                throw new WorkflowException(`Input '${inp["id"]}' not in input object and does not have a default value.`);
            }
        }
    });

    this.steps.forEach((step: any) => {
        step.tool["outputs"].forEach((out: any) => {
            this.state[out["id"]] = null;
        });
    });

    let completed = 0;
    while (completed < this.steps.length) {
        this.made_progress = false;
        for (const step of this.steps) {
            if (getdefault(runtimeContext.on_error, "stop") === "stop" && this.processStatus !== "success") break;
            if (!step.submitted) {
                try {
                    step.iterable = this.try_make_job(step, output_callback, runtimeContext);
                } catch (exc) {
                    _logger.error(`[${step.name}] Cannot make job: ${exc}`);
                    _logger.debug("", { info: true });
                    this.processStatus = "permanentFail";
                }
            }
            if (step.iterable) {
                try {
                    for (let newjob of step.iterable) {
                        if (
                            getdefault(runtimeContext.on_error, "stop") === "stop" &&
                            this.processStatus !== "success"
                        ) break;
                        if (newjob) {
                            this.made_progress = true;
                            yield newjob;
                        } else {
                            break;
                        }
                    }
                } catch (exc) {
                    _logger.error(`[${step.name}] Cannot make job: ${exc}`);
                    _logger.debug("", { info: true });
                    this.processStatus = "permanentFail";
                }
            }
        }
        completed = this.steps.filter(s => s.completed).length;
        if (!this.made_progress && completed < this.steps.length) {
            if (this.processStatus !== "success") break;
            else yield null;
        }
    }
    if (!this.did_callback && output_callback) {
        this.do_output_callback(output_callback);
    }
}
class WorkflowJobLoopStep {
    step: WorkflowJobStep;
    container_engine: string;
    joborder: CWLObjectType | null;
    processStatus: string;
    iteration: number;
    output_buffer: { [key: string]: (CWLOutputType | null)[] | CWLOutputType | null };

    constructor(step: WorkflowJobStep, container_engine: string) {
        this.step = step;
        this.container_engine = container_engine;
        this.joborder = null;
        this.processStatus = "success";
        this.iteration = 0;
        this.output_buffer = {};
    }

    _set_empty_output(loop_req: CWLObjectType) {
        for (let i of this.step.tool["outputs"]) {
            if ("id" in i) {
                let iid = <string>i["id"];
                if (loop_req.get("outputMethod") == "all") {
                    this.output_buffer[iid] = <(CWLOutputType | null)[]> [];
                }
                else {
                    this.output_buffer[iid] = null;
                }
            }
        }
    }

    *job(
        joborder: CWLObjectType,
        output_callback: OutputCallbackType,
        runtimeContext: RuntimeContext,
    ): Iterable<JobsGeneratorType> {
        this.joborder = joborder;
        let loop_req = <CWLObjectType>this.step.step.get_requirement("http://commonwl.org/cwltool#Loop")[0];

        let callback = this.loop_callback.bind(this, runtimeContext);

        try {
            while (true) {
                let evalinputs = Object.fromEntries(Object.entries(this.joborder).map(([k, v]) => [shortname(k), v]));
                let whenval = expression.do_eval(
                    loop_req["loopWhen"],
                    evalinputs,
                    this.step.step.requirements,
                    null,
                    null,
                    {},
                    runtimeContext.debug,
                    runtimeContext.js_console,
                    runtimeContext.eval_timeout,
                    this.container_engine,
                );
                if (whenval === true) {
                    this.processStatus = "";
                    yield* this.step.job(this.joborder, callback, runtimeContext);
                    while (this.processStatus === "") {
                        yield null;
                    }
                    if (this.processStatus === "permanentFail") {
                        output_callback(this.output_buffer, this.processStatus);
                        return;
                    }
                }
                else if (whenval === false) {
                    _logger.debug(
                        "[%s] loop condition %s evaluated to %s at iteration %i",
                        this.step.name,
                        loop_req["loopWhen"],
                        whenval,
                        this.iteration,
                    );
                    _logger.debug(
                        "[%s] inputs was %s",
                        this.step.name,
                        json_dumps(evalinputs, 2),
                    );
                    if (this.iteration === 0) {
                        this.processStatus = "skipped";
                        this._set_empty_output(loop_req);
                    }
                    output_callback(this.output_buffer, this.processStatus);
                    return;
                }
                else {
                    throw new WorkflowException(
                        "Loop condition 'loopWhen' must evaluate to 'true' or 'false'"
                    );
                }
            }
        }
        catch (WorkflowException) {
            throw;
        }
        catch (Exception) {
            _logger.exception("Unhandled exception");
            this.processStatus = "permanentFail";
            if (this.iteration === 0) {
                this._set_empty_output(loop_req);
            }
            output_callback(this.output_buffer, this.processStatus);
        }
    }
}
loop_callback(runtimeContext: any, jobout: any, processStatus: string) {
        this.iteration += 1;
        try {
            let loop_req = this.step.step.get_requirement('http://commonwl.org/cwltool#Loop')[0] as CWLObjectType;
            let state: {[key: string]: WorkflowStateItem | null} = {};
            for (let i of this.step.tool['outputs']) {
                if ('id' in i) {
                    let iid = i['id'] as string;
                    if (iid in jobout) {
                        state[iid] = new WorkflowStateItem(i, jobout[iid], processStatus);
                        if (loop_req.get('outputMethod') === 'all') {
                            if (!(iid in this.output_buffer)) {
                                this.output_buffer[iid] = [] as CWLOutputType[];
                            }
                            (this.output_buffer[iid] as CWLOutputType[]).push(jobout[iid]);
                        } else {
                            this.output_buffer[iid] = jobout[iid];
                        }
                    } else {
                        _logger.error(`[${this.step.name}] Output of iteration ${this.iteration} is missing expected field ${iid}`);
                        processStatus = 'permanentFail';
                    }
                }
            }
            if (_logger.isEnabledFor(logging.DEBUG)) {
                _logger.debug(`Iteration ${this.iteration} of [${this.step.name}] produced output ${JSON.stringify(jobout, null, 4)}`);
            }
            if (this.processStatus !== 'permanentFail') {
                this.processStatus = processStatus;
            }
            if (!['success', 'skipped'].includes(processStatus)) {
                _logger.warning(`[${this.step.name}] Iteration ${this.iteration} completed ${processStatus}`);
            } else {
                _logger.info(`[${this.step.name}] Iteration ${this.iteration} completed ${processStatus}`);
            }
            let supportsMultipleInput = Boolean(this.step.step.get_requirement('MultipleInputFeatureRequirement')[0]);
            let inputobj = {
                ...this.joborder as CWLObjectType,
                ...object_from_state(state, (loop_req.get('loop', []) as CWLObjectType[]).map(value => ({...value, type: 'Any'})), false, supportsMultipleInput, 'loopSource')
            };
            let fs_access = getdefault(runtimeContext.make_fs_access, StdFsAccess)('');
            let valueFrom = (loop_req.get('loop', []) as CWLObjectType[]).filter(value => 'valueFrom' in value)
                                                                        .reduce((prev, curr) => ({...prev, [curr['id']]: curr['valueFrom']}), {});
            if (Object.keys(valueFrom).length > 0 && !Boolean(this.step.step.get_requirement('StepInputExpressionRequirement')[0])) {
                throw new WorkflowException('Workflow step contains valueFrom but StepInputExpressionRequirement not in requirements');
            }
            for (let [k, v] of Object.entries(inputobj)) {
                if (k in valueFrom) {
                    adjustDirObjs(v, (value: any) => get_listing(fs_access, true));
                    inputobj[k] = expression.do_eval(valueFrom[k], this.joborder, this.step.step.requirements, null, null, {}, v, runtimeContext.debug, runtimeContext.js_console, runtimeContext.eval_timeout, this.container_engine);
                }
            }
            this.joborder = inputobj;
        } catch (error) {
            this.processStatus = 'permanentFail';
            throw error;
        }
    }
