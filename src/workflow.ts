import { CommentedMap } from "ruamel.yaml.comments";
import { LoadingContext } from "./context.js";
import { Process } from "./process.js";
import { WorkflowException } from "./errors.js";
import { Workflow } from "./workflow_job.js";
import * as command_line_tool from "./command_line_tool.js";
import * as procgenerator from "./procgenerator";
import type { CWLObjectType } from "./utils.js";

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
class Workflow extends Process {
    provenance_object?: ProvenanceProfile;
    steps: WorkflowStep[];
    parent_wf?: ProvenanceProfile;
    
    constructor(toolpath_object: CommentedMap, loadingContext: LoadingContext) {
        super(toolpath_object, loadingContext);
        if (loadingContext.research_obj) {
            let run_uuid: UUID | null = null;
            const is_main = !loadingContext.prov_obj;
            if (is_main) {
                run_uuid = loadingContext.research_obj.ro_uuid;
            }

            this.provenance_object = new ProvenanceProfile(
                loadingContext.research_obj,
                loadingContext.cwl_full_name,
                loadingContext.host_provenance,
                loadingContext.user_provenance,
                loadingContext.orcid,
                run_uuid,
                loadingContext.research_obj.fsaccess
            );
            this.parent_wf = this.provenance_object;
        }

        loadingContext.prov_obj = this.provenance_object;
        loadingContext = {...loadingContext};
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
                if (_logger.isEnabledFor(logging.DEBUG)) {
                    _logger.exception("Validation failed at");
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

        let step_inputs: CWLObjectType[] = [];
        let step_outputs: CWLObjectType[] = [];
        let param_to_step: {[key:string]:CWLObjectType} = {};

        for (const step of this.steps) {
            step_inputs = step_inputs.concat(step.tool.inputs);
            step_outputs = step_outputs.concat(step.tool.outputs);
            for (const s of step.tool.inputs) {
                param_to_step[s.id] = step.tool;
            }
            for (const s of step.tool.outputs) {
                param_to_step[s.id] = step.tool;
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
        toolpath_object: CommentedMap,
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

function used_by_step(step: StepType, shortinputid: string): boolean {
    for (let st of <MutableSequence<CWLObjectType>>step["in"]) {
        if (st.get("valueFrom")) {
            if (`inputs.${shortinputid}` in <string>st.get("valueFrom")) {
                return true;
            }
        }
    }
    if (step.get("when")) {
        if (`inputs.${shortinputid}` in <string>step.get("when")) {
            return true;
        }
    }
    return false;
}
class WorkflowStep extends Process {
    handle_field(toolpath_object: any, bound: Set<any>, stepfield: string, toolfield: string, validation_errors, debug: boolean): void {
        toolpath_object[toolfield] = [];
        toolpath_object[stepfield].forEach((step_entry: any, index: number) => {
            let param: any;
            let inputid;

            if (typeof step_entry === 'string') {
                param = new Map();
                inputid = step_entry;
            } else {
                param = new Map([...step_entry.entries()]);
                inputid = step_entry["id"];
            }

            const shortinputid = shortname(inputid);
            let found: boolean = false;

            for (const tool_entry of this.embedded_tool.tool[toolfield]) {
                const frag = shortname(tool_entry["id"]);
                if (frag === shortinputid) {
                    let step_default = null;
                    if ("default" in param && "default" in tool_entry) {
                        step_default = param["default"];
                    }
                    param = new Map([...param, ...tool_entry]);
                    param["_tool_entry"] = tool_entry;
                    if (step_default !== null) {
                        param["default"] = step_default;
                    }
                    found = true;
                    bound.add(frag);
                    break;
                }
            }

            if (!found) {
                if (stepfield === "in") {
                    param["type"] = "Any";
                    param["used_by_step"] = used_by_step(this.tool, shortinputid);
                    param["not_connected"] = true;
                } else {
                    let step_entry_name;

                    if (step_entry instanceof Map) {
                        step_entry_name = step_entry["id"];
                    } else {
                        step_entry_name = step_entry;
                    }

                    validation_errors.push(
                        SourceLine(this.tool["out"], index, {include_traceback: debug}).makeError(
                            `Workflow step output '${shortname(step_entry_name)}' does not correspond to`
                        ) + "\n" +
                        SourceLine(this.embedded_tool.tool, "outputs", {include_traceback: debug}).makeError(
                            `  tool output (expected '${
                                this.embedded_tool.tool["outputs"].map((tool_entry: any) => shortname(tool_entry["id"])).join("', '")
                            }')`
                        )
                    );
                }
            }

            param["id"] = inputid;
            param.lc.line = toolpath_object[stepfield].lc.data[index][0];
            param.lc.col = toolpath_object[stepfield].lc.data[index][1];
            param.lc.filename = toolpath_object[stepfield].lc.filename;
            toolpath_object[toolfield].push(param);
        });
    }
}
constructor(
    toolpath_object: CommentedMap,
    pos: number,
    loadingContext: LoadingContext,
    parentworkflowProv: ProvenanceProfile | null = null,
) {
    const debug = loadingContext.debug;
    if (toolpath_object.has("id")) {
        this.id = toolpath_object["id"];
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
        if (toolpath_object["run"] instanceof CommentedMap) {
            this.embedded_tool = loadingContext.construct_tool_object(
                toolpath_object["run"], loadingContext
            );
        } else {
            loadingContext.metadata = {};
            this.embedded_tool = load_tool(toolpath_object["run"], loadingContext);
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

    if (this.embedded_tool.get_requirement("SchemaDefRequirement")[0]) {
        if (!toolpath_object.has("requirements")) {
            toolpath_object["requirements"] = [];
        }
        toolpath_object["requirements"].push(
            this.embedded_tool.get_requirement("SchemaDefRequirement")[0]
        );
    }

    for (let [stepfield, toolfield] of [["in", "inputs"], ["out", "outputs"]]) {
        this.handle_field(toolpath_object, bound, stepfield, toolfield, validation_errors, debug);
    }

    let missing_values = [];
    for (let tool_entry of this.embedded_tool.tool["inputs"]) {
        if (!bound.has(shortname(tool_entry["id"]))) {
            if (!("null" in tool_entry["type"]) && !("default" in tool_entry)) {
                missing_values.push(shortname(tool_entry["id"]));
            }
        }
    }

    if (missing_values.length > 0) {
        validation_errors.push(
            SourceLine(this.tool, "in", include_traceback=debug).makeError(
                `Step is missing required parameter${missing_values.length > 1 ? 's' : ''} '${missing_values.join("', '")}'`
            )
        );
    }

    if (validation_errors.length > 0) throw new ValidationException(validation_errors.join("\n"));

    super(toolpath_object, loadingContext);

    if (this.embedded_tool.tool["class"] === "Workflow") {
        let [feature, _] = this.get_requirement("SubworkflowFeatureRequirement");
        if (!feature) {
            throw new WorkflowException("Workflow contains embedded workflow but SubworkflowFeatureRequirement not in requirements");
        }
    }

    if (this.tool.has("scatter")) {
        let [feature, _] = this.get_requirement("ScatterFeatureRequirement");
        if (!feature) {
            throw new WorkflowException("Workflow contains scatter but ScatterFeatureRequirement not in requirements");
        }

        let inputparms = copy.deepcopy(this.tool["inputs"]);
        let outputparms = copy.deepcopy(this.tool["outputs"]);
        let scatter = aslist(this.tool["scatter"]);

        const method = this.tool.get("scatterMethod");
        if (method === null && scatter.length !== 1) {
            throw new ValidationException(
                "Must specify scatterMethod when scattering over multiple inputs"
            );
        }

        let inp_map = inputparms.reduce((acc, i) => ({ ...acc, [i["id"]]: i }), {});
        for (let inp of scatter) {
            if (!(inp in inp_map)) {
                SourceLine(this.tool, "scatter", ValidationException, debug).makeError(
                    `Scatter parameter '${shortname(inp)}' does not correspond to an input parameter of this step, expecting '${Object.keys(inp_map).map(k => shortname(k)).join("', '")}'`
                );
            }

            inp_map[inp]["type"] = { "type": "array", "items": inp_map[inp]["type"] };
        }

        let nesting;
        if (this.tool.get("scatterMethod") === "nested_crossproduct") {
            nesting = scatter.length;
        } else {
            nesting = 1;
        }

        for (let _ of Array(nesting).keys()) {
            for (let oparam of outputparms) {
                oparam["type"] = { "type": "array", "items": oparam["type"] };
            }
        }
        this.tool["inputs"] = inputparms;
        this.tool["outputs"] = outputparms;
    }
    this.prov_obj = null;
    if (loadingContext.research_obj !== null) {
        this.prov_obj = parentworkflowProv;
        if (this.embedded_tool.tool["class"] === "Workflow") {
            this.parent_wf = this.embedded_tool.parent_wf;
        } else {
            this.parent_wf = this.prov_obj;
        }
    }
}
checkRequirements(
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
            _logger.exception("Unexpected exception");
            throw new WorkflowException(e);
        }
    }
}

visit(op: (map: CommentedMap) => void): void {
    this.embedded_tool.visit(op);
}
