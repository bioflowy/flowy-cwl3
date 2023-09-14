import { CommentedMap } from "ruamel.yaml.comments";
import { LoadingContext, RuntimeContext } from "./context.js";
import { Process, shortname } from "./process.js";
import { ValidationException, WorkflowException } from "./errors.js";
import * as cwlTsAuto from 'cwl-ts-auto'
import { _logger } from "./loghandler.js";
import { WorkflowJob } from "./workflow_job.js";
import * as command_line_tool from "./command_line_tool.js";
import * as procgenerator from "./procgenerator";
import { isString, type CWLObjectType, type JobsGeneratorType, type OutputCallbackType, aslist } from "./utils.js";
import { CommandInputParameter, convertCommandInputParameter, CommandOutputParameter, type Tool, transferProperties, convertCommandOutputParameter } from "./types.js";
import { static_checker } from "./checker.js";

function default_make_tool(toolpath_object: CommentedMap, loadingContext: LoadingContext): Process {
    if (!(toolpath_object instanceof Map)) {
        throw new WorkflowException(`Not a dict: '${toolpath_object}'`);
    }

    if (toolpath_object.has("class")) {
        switch (toolpath_object.get("class")) {
            case "CommandLineTool":
                return new command_line_tool.CommandLineTool(toolpath_object, loadingContext);
            case "ExpressionTool":
                return new command_line_tool.ExpressionTool(toolpath_object, loadingContext);
            case "Workflow":
                return new Workflow(toolpath_object, loadingContext);
            case "ProcessGenerator":
                return new procgenerator.ProcessGenerator(toolpath_object, loadingContext);
            case "Operation":
                return new command_line_tool.AbstractOperation(toolpath_object, loadingContext);
        }
    }
    
    throw new WorkflowException(
        `Missing or invalid 'class' field in ${toolpath_object.get("id")}, expecting one of: CommandLineTool, ExpressionTool, Workflow`
    );
}
context.default_make_tool = default_make_tool;

export class Workflow extends Process {
    declare tool: cwlTsAuto.Workflow;
    steps: WorkflowStep[];
    
    constructor(toolpath_object: CommentedMap, loadingContext: LoadingContext) {
        super(toolpath_object, loadingContext);

        loadingContext = loadingContext.copy();
        loadingContext.requirements = this.requirements;
        loadingContext.hints = this.hints;

        this.steps = [];
        let validation_errors = [];

        for (const [index, step] of this.tool.steps.entries()) {
            try {
                this.steps.push(
                    this.make_workflow_step(step, index, loadingContext, loadingContext.prov_obj)
                );
            } catch (vexc) {
                if (_logger.isDebugEnabled()) {
                    _logger.warn("Validation failed at");
                }
                validation_errors.push(vexc);
            }
        }

        if (validation_errors.length) {
            throw new ValidationException(validation_errors.map(v => `\n${v}`).join(''));
        }

        this.steps = this.steps.sort(() => Math.random() - 0.5);

        const workflow_inputs = this.tool.inputs;
        const workflow_outputs = this.tool.outputs;

        let step_inputs: CommandInputParameter[] = [];
        let step_outputs: CommandOutputParameter[] = [];
        let param_to_step: {[key:string]:cwlTsAuto.WorkflowStep} = {};

        for (const step of this.steps) {
            step_inputs = step_inputs.concat(step.inputs);
            step_outputs = step_outputs.concat(step.outputs);
            for (const s of step.inputs) {
                param_to_step[s.id] = step.tool;
            }
            for (const s of step.outputs) {
                param_to_step[s.name] = step.tool;
            }
        }

        if (loadingContext.do_validate ?? true) {
            static_checker(
                workflow_inputs,
                workflow_outputs,
                step_inputs,
                step_outputs,
                param_to_step
            );
            circular_dependency_checker(step_inputs);
            loop_checker(Array.from(this.steps, step => step.tool));
        }
    }
    make_workflow_step(
            toolpath_object: cwlTsAuto.WorkflowStep,
            pos: number,
            loadingContext: LoadingContext,
            parentworkflowProv?: ProvenanceProfile,
    ): WorkflowStep {
        return new WorkflowStep(toolpath_object, pos, loadingContext, parentworkflowProv);
    }

        job(
            job_order: CWLObjectType,
            output_callbacks?: OutputCallbackType,
            runtimeContext: RuntimeContext    
        ): JobsGeneratorType {
            let builder = this._init_job(job_order, runtimeContext);

            if (runtimeContext.research_obj != null) {
                if (runtimeContext.toplevel) {
                    // Record primary-job.json
                    runtimeContext.research_obj.fsaccess = runtimeContext.make_fs_access("");
                    create_job(runtimeContext.research_obj, builder.job);
                }
            }

            let job = new WorkflowJob(this, runtimeContext);
            yield job;

            runtimeContext = runtimeContext.copy();
            runtimeContext.part_of = `workflow ${job.name}`;
            runtimeContext.toplevel = false;

            yield* job.job(builder.job, output_callbacks, runtimeContext);
        }

        visit(op: (commentedMap: CommentedMap) => void): void {
            op(this.tool);
            for (let step of this.steps) {
                step.visit(op);
            }
        }
    }

function used_by_step(step: cwlTsAuto.WorkflowStep, shortinputid: string): boolean {
    
    for (let st of step.in_) {
        if (st.valueFrom) {
            if (st.valueFrom.includes(`inputs.${shortinputid}`)) {
                return true;
            }
        }
    }
    if (step.when) {
        if (step.when.includes(`inputs.${shortinputid}`)) {
            return true;
        }
    }
    return false;
}
export class WorkflowStep extends Process {
    declare tool: cwlTsAuto.WorkflowStep;
    inputs: CommandInputParameter[]
    outputs: CommandOutputParameter[]
    handleInput(toolpath_object: cwlTsAuto.WorkflowStepInput[], bound: Set<any>,  validation_errors, debug: boolean): CommandInputParameter[] {
        const inputs:CommandInputParameter[] = [];
        toolpath_object.forEach((step_entry: cwlTsAuto.WorkflowStepInput, index: number) => {
            let param: CommandInputParameter;
            let inputid = "";

            param = convertCommandInputParameter(step_entry);
            inputid = step_entry.id;
            const shortinputid = shortname(inputid);
            let found: boolean = false;
            
            for (const tool_entry of this.embedded_tool.tool.inputs) {
                const frag = shortname(tool_entry.id);
                if (frag === shortinputid) {
                    let step_default = null;
                    if (param.default_ && "default" in tool_entry) {
                        step_default = param["default"];
                    }
                    transferProperties(tool_entry,param)
                    param._tool_entry = tool_entry;
                    if (step_default !== null) {
                        param.default_ = step_default;
                    }
                    found = true;
                    bound.add(frag);
                    break;
                }
            }
            if (!found) {
                param.type = "Any";
                param.used_by_step = used_by_step(this.tool, shortinputid);
                param.not_connected = true;
            }

            param.id = inputid;
            inputs.push(param);
        });
        return inputs
    }
    handleOutput(stepOutputs: (cwlTsAuto.WorkflowStepOutput|string)[], bound: Set<any>,  validation_errors, debug: boolean): CommandOutputParameter[] {
        const outputs:CommandOutputParameter[] = []
        stepOutputs.forEach((step_entry, index: number) => {
            let param: any;
            let inputid;

            if (isString(step_entry)) {
                param = new CommandOutputParameter();
                inputid = step_entry;
            } else {
                param = convertCommandOutputParameter(step_entry);
                inputid = step_entry.id;
            }

            const shortinputid = shortname(inputid);
            let found: boolean = false;

            for (const tool_entry of this.embedded_tool.tool.outputs) {
                const frag = shortname(tool_entry.id);
                if (frag === shortinputid) {
                    let step_default = null;
                    transferProperties(tool_entry,param)
                    param._tool_entry = tool_entry;
                    if (step_default !== null) {
                        param.default_ = step_default;
                    }
                    found = true;
                    bound.add(frag);
                    break;
                }
            }
            if (!found) {
                let step_entry_name;

                if (step_entry instanceof Map) {
                    step_entry_name = step_entry["id"];
                } else {
                    step_entry_name = step_entry;
                }

                validation_errors.push(
                        `Workflow step output '${shortname(step_entry_name)}' does not correspond to\n`
                        + "\n" +
                        `  tool output (expected '${this.embedded_tool.tool["outputs"].map((tool_entry: any) => shortname(tool_entry["id"])).join("', '")}`
                    )
            }

            param.id = inputid;
            outputs.push(param);
        });
        return outputs;
    }
        id:string;
        embedded_tool:Process;

    constructor(
        toolpath_object: cwlTsAuto.WorkflowStep,
        pos: number,
        loadingContext: LoadingContext,
        parentworkflowProv: ProvenanceProfile | null = null,
    ) {
        super(toolpath_object,loadingContext)
        const debug = loadingContext.debug;
        if (toolpath_object.id) {
            this.id = toolpath_object.id;
        } else {
            this.id = `#step${pos}`;
        }

        loadingContext = loadingContext.copy();

        const parent_requirements = copy.deepcopy(getdefault(loadingContext.requirements, []));
        loadingContext.requirements = copy.deepcopy(toolpath_object.get("requirements", []));
        if (loadingContext.requirements === null) throw new Error('');

        for (let parent_req of parent_requirements) {
            let found_in_step = false;
            for (let step_req of loadingContext.requirements) {
                if (parent_req["class"] === step_req["class"]) {
                    found_in_step = true;
                    break;
                }
            }
            if (!found_in_step && parent_req.get("class") !== "http://commonwl.org/cwltool#Loop") {
                loadingContext.requirements.push(parent_req);
            }
        }
        loadingContext.requirements = loadingContext.requirements.concat(
            cast(
                List[CWLObjectType],
                get_overrides(getdefault(loadingContext.overrides_list, []), this.id).get(
                    "requirements", []
                ),
            )
        );

        let hints = copy.deepcopy(getdefault(loadingContext.hints, []));
        hints = hints.concat(toolpath_object.get("hints", []));
        loadingContext.hints = hints;

        try {
            if (isString(toolpath_object.run)){
                loadingContext.metadata = {};
                this.embedded_tool = load_tool(toolpath_object.run, loadingContext);
            }else {
                this.embedded_tool = loadingContext.construct_tool_object(
                    toolpath_object.run, loadingContext
                );
            }
        } catch (vexc) {
            if (loadingContext.debug) {
                console.error("Validation exception");
            }
            throw new WorkflowException(
                `Tool definition ${toolpath_object["run"]} failed validation:\n${indent(vexc.toString())}`,
                vexc
            );
        }

        let validation_errors = [];
        this.tool = toolpath_object = copy.deepcopy(toolpath_object);
        let bound = new Set();

        if (this.embedded_tool.getRequirement(cwlTsAuto.SchemaDefRequirement)[0]) {
            if (!toolpath_object.has("requirements")) {
                toolpath_object["requirements"] = [];
            }
            toolpath_object["requirements"].push(
                this.embedded_tool.get_requirement("SchemaDefRequirement")[0]
            );
        }
        this.inputs = this.handleInput(toolpath_object.in_, bound, validation_errors, debug);
        this.outputs = this.handleOutput(toolpath_object.out, bound, validation_errors, debug);

        let missing_values = [];
        for (let tool_entry of this.embedded_tool.tool.inputs) {
            if (!bound.has(shortname(tool_entry.id))) {
                if (!("null" in aslist(tool_entry.type)) && !tool_entry.default_) {
                    missing_values.push(shortname(tool_entry["id"]));
                }
            }
        }

        if (missing_values.length > 0) {
            validation_errors.push(
                new WorkflowException(
                    `Step is missing required parameter${missing_values.length > 1 ? 's' : ''} '${missing_values.join("', '")}'`
                )
            );
        }

        if (validation_errors.length > 0) throw new ValidationException(validation_errors.join("\n"));

        super(toolpath_object, loadingContext);

        if (this.embedded_tool.tool instanceof cwlTsAuto.Workflow) {
            let [feature, _] = this.getRequirement(cwlTsAuto.SubworkflowFeatureRequirement);
            if (!feature) {
                throw new WorkflowException("Workflow contains embedded workflow but SubworkflowFeatureRequirement not in requirements");
            }
        }

        if (this.tool.scatter) {
            let [feature, _] = this.getRequirement(cwlTsAuto.ScatterFeatureRequirement);
            if (!feature) {
                throw new WorkflowException("Workflow contains scatter but ScatterFeatureRequirement not in requirements");
            }

            let inputparms = [...this.inputs];
            let outputparms = [...this.outputs];
            let scatter = aslist(this.tool.scatter);

            const method = this.tool.scatterMethod;
            if (method === null && scatter.length !== 1) {
                throw new ValidationException(
                    "Must specify scatterMethod when scattering over multiple inputs"
                );
            }

            let inp_map = inputparms.reduce((acc, i) => ({ ...acc, [i["id"]]: i }), {});
            for (let inp of scatter) {
                if (!(inp in inp_map)) {
                    throw new ValidationException(
                        `Scatter parameter '${shortname(inp)}' does not correspond to an input parameter of this step, expecting '${Object.keys(inp_map).map(k => shortname(k)).join("', '")}'`
                    );
                }

                inp_map[inp]["type"] = { "type": "array", "items": inp_map[inp]["type"] };
            }

            let nesting;
            if (this.tool.scatterMethod === "nested_crossproduct") {
                nesting = scatter.length;
            } else {
                nesting = 1;
            }

            for (let _ of Array(nesting).keys()) {
                for (let oparam of outputparms) {
                    oparam.type = { "type": "array", "items": oparam["type"] };
                }
            }
            this.tool["inputs"] = inputparms;
            this.tool["outputs"] = outputparms;
        }
        // this.prov_obj = null;
        // if (loadingContext.research_obj !== null) {
        //     this.prov_obj = parentworkflowProv;
        //     if (this.embedded_tool.tool["class"] === "Workflow") {
        //         this.parent_wf = this.embedded_tool.parent_wf;
        //     } else {
        //         this.parent_wf = this.prov_obj;
        //     }
        // }
    }
    override checkRequirements(
        rec: MutableSequence<CWLObjectType> | CWLObjectType | CWLOutputType | null,
        supported_process_requirements: Iterable<string>,
    ): void {
        supported_process_requirements = [...supported_process_requirements];
        supported_process_requirements.push("http://commonwl.org/cwltool#Loop");
        super.checkRequirements(rec, supported_process_requirements);
    }

    receive_output(
        output_callback: OutputCallbackType,
        jobout: CWLObjectType,
        processStatus: string,
    ): void {
        const output: {[key: string]: any} = {};
        for (let i of this.tool["outputs"]) {
            let field = shortname(i["id"]);
            if (field in jobout) {
                output[i["id"]] = jobout[field];
            } else {
                processStatus = "permanentFail";
            }
        }
        output_callback(output, processStatus);
    }

    job(
        job_order: CWLObjectType,
        output_callbacks: OutputCallbackType | null,
        runtimeContext: RuntimeContext,
    ): JobsGeneratorType {
        if (
            this.embedded_tool.tool["class"] == "Workflow"
            && runtimeContext.research_obj
            && this.prov_obj
            && this.embedded_tool.provenance_object
        ) {
            this.embedded_tool.parent_wf = this.prov_obj;
            let process_name = this.tool["id"].split("#")[1];
            this.prov_obj.start_process(
                process_name,
                new Date(),
                this.embedded_tool.provenance_object.workflow_run_uri,
            );
        }

        let step_input: {[key: string]: any} = {};
        for (let inp of this.tool["inputs"]) {
            let field = shortname(inp["id"]);
            if (!inp["not_connected"]) {
                step_input[field] = job_order[inp["id"]];
            }
        }

        try {
            for (let item of this.embedded_tool.job(
                step_input,
                (output: any, processStatus: string) => this.receive_output(output_callbacks, output, processStatus),
                runtimeContext,
            )) {
                yield item;
            }
        } catch (e) {
            if (e instanceof WorkflowException) {
                _logger.error(`Exception on step '${runtimeContext.name}'`);
                throw e;
            } else {
                _logger.warn("Unexpected exception");
                throw new WorkflowException(e);
            }
        }
    }

    visit(op: (map: CommentedMap) => void): void {
        this.embedded_tool.visit(op);
    }
}