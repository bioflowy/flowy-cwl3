let docker_exe: string;

function _terminate_processes(): void {
    // The python `global` keyword isn't needed in typescript.
    while (processes_to_kill.length) {
        const process = processes_to_kill.shift();
        let args;
        if (Array.isArray(process.args)) {
            args = process.args;
        } else {
            args = [process.args];
        }
        const cidfile = args
            .filter(arg => arg.includes("--cidfile"))
            .map(arg => arg.split("=")[1]);
        if (cidfile.length) { // Try to be nice
            try {
                const p = child_process.spawnSync( 
                    docker_exe,
                    ['kill', fs.readFileSync(cidfile[0], 'utf8')]
                );
                p.kill();
            } catch (error) {
                // Pass
            }
        }
        if (process.stdin) {
            process.stdin.close();
        }
        try {
            process.kill();  // Always kill, even if we tried with the cidfile
        } catch (error) {
            // Pass
        }
    }
}


function _signal_handler(signum: number, _: any): void {
    _terminate_processes();
    process.exit(signum);
}


function generate_example_input(
    inptype: CWLOutputType | undefined,
    default: CWLOutputType | undefined,
): [any, string] {
    let example = null;
    let comment = "";
    const defaults: CWLObjectType = {
        "null": "null",
        "Any": "null",
        "boolean": false,
        "int": 0,
        "long": 0,
        "float": 0.1,
        "double": 0.1,
        "string": "a_string",
        "File": {"class": "File", "path": "a/file/path"},
        "Directory": {"class": "Directory", "path": "a/directory/path"},
    };
    
    if (Array.isArray(inptype)) { /*...*/ }
    else if (typeof inptype === 'object' && inptype.type) { /*...*/ }
    else {
        if (!default) {
            example = defaults[inptype as string] || inptype;
            comment = `type ${inptype}`;
        } else {
            example = default;
            comment = `default value of type ${inptype}.`;
        }
    }
    
    return [example, comment];
}
function realize_input_schema(
  input_types: Array<string | CWLObjectType>,
  schema_defs: {[key: string]: CWLObjectType},
): Array<string | CWLObjectType> {

    for (let [index, entry] of input_types.entries()) {
        if (typeof entry === 'string') {
            let input_type_name: string;
            if (entry.includes("#")) {
                let splitted = entry.split("#");
                input_type_name = splitted[1];
            } else {
                input_type_name = entry;
            }
            if (input_type_name in schema_defs) {
                entry = input_types[index] = schema_defs[input_type_name];
            }
        }
        if (entry instanceof Map) {
            if (typeof entry.get("type") === 'string' && entry.get("type").includes("#")) {
                let splitted = entry.get("type").split("#");
                let input_type_name = splitted[1];
                if (input_type_name in schema_defs) {
                    entry.set("type", realize_input_schema(schema_defs[input_type_name], schema_defs));
                }
            }
            if (Array.isArray(entry.get("type"))) {
                entry.set("type", realize_input_schema(entry.get("type"), schema_defs));
            }
            if (entry.get("type") instanceof Map) {
                entry.set("type", realize_input_schema([entry.get("type")], schema_defs));
            }
            if (entry.get("type") === "array") {
                let items = Array.isArray(entry.get("items")) ? entry.get("items") : [entry.get("items")];
                entry.set("items", realize_input_schema(items, schema_defs));
            }
            if (entry.get("type") === "record") {
                entry.set("fields", realize_input_schema(entry.get("fields"), schema_defs));
            }
        }
    }
    return input_types;
}
function generate_input_template(tool: Process): CWLObjectType {
    let template = new ruamel.yaml.comments.CommentedMap();
    for (let inp of cast(
        Array<MutableMapping<string, string>>,
        realize_input_schema(tool.tool["inputs"], tool.schemaDefs)
    )) {
        let name = shortname(inp["id"]);
        let [value, comment] = generate_example_input(inp["type"], inp.get("default", null));
        template.insert(0, name, value, comment);
    }
    return template;
}

function load_job_order(
    args: argparse.Namespace,
    stdin: IO<any>,
    fetcher_constructor: FetcherCallableType | null,
    overrides_list: Array<CWLObjectType>,
    tool_file_uri: string
): [CWLObjectType | null, string, Loader] {
    let job_order_object = null;
    let job_order_file = null;
    let _jobloaderctx = jobloaderctx.copy();

    let loader = new Loader(_jobloaderctx, fetcher_constructor);

    if (args.job_order.length == 1 && args.job_order[0][0] != "-") {
        job_order_file = args.job_order[0];
    } else if (args.job_order.length == 1 && args.job_order[0] == "-") {
        let yaml = yaml_no_ts();
        job_order_object = yaml.load(stdin);
        [job_order_object, _] = loader.resolve_all(job_order_object, file_uri(os.getcwd()) + "/");
    } else {
        job_order_file = null;
    }

    let input_basedir;
    if (job_order_object != null) {
        input_basedir = args.basedir ? args.basedir : os.getcwd();
    } else if (job_order_file != null) {
        input_basedir = args.basedir ? args.basedir : os.path.abspath(os.path.dirname(job_order_file));
        [job_order_object, _] = loader.resolve_ref(
            job_order_file,
            false,
            CWL_CONTENT_TYPES
        );
    }

    if (job_order_object != null && "http://commonwl.org/cwltool#overrides" in job_order_object) {
        let ov_uri = file_uri(job_order_file || input_basedir);
        overrides_list.push(...resolve_overrides(job_order_object, ov_uri, tool_file_uri));
        delete job_order_object["http://commonwl.org/cwltool#overrides"];
    }

    if (job_order_object == null) {
        input_basedir = args.basedir ? args.basedir : os.getcwd();
    }

    if (job_order_object != null && !(job_order_object instanceof MutableMapping)) {
        _logger.error(
            "CWL input object at %s is not formatted correctly, it should be a " +
            "JSON/YAML dictionary, not %s.\n" +
            "Raw input object:\n%s",
            job_order_file || "stdin",
            typeof job_order_object,
            job_order_object
        );
        process.exit(1);
    }

    return [job_order_object, input_basedir, loader];
}
function init_job_order(
    job_order_object? : CWLObjectType,
    args: argparse.Namespace,
    process: Process,
    loader: Loader,
    stdout: IO<string>,
    print_input_deps: boolean = False,
    relative_deps: string = "primary",
    make_fs_access: (str)=>StdFsAccess = StdFsAccess,
    input_basedir: string = "",
    secret_store? : SecretStore,
    input_required: boolean = true,
    runtime_context?: RuntimeContext
): CWLObjectType {
    let secrets_req = process.get_requirement("http://commonwl.org/cwltool#Secrets")[0];
    
    if (job_order_object === undefined) {
        let namemap = {}; 
        let records = []; 
        let toolparser = generate_parser(
            argparse.ArgumentParser(prog=args.workflow),
            process,
            namemap,
            records,
            input_required,
            loader.fetcher.urljoin,
            file_uri(process.cwd()) + "/",
        );
        if (args.tool_help){
            toolparser.print_help(stdout);
            process.exit(0);
        }
        let cmd_line: any = toolparser.parse_args(args.job_order);
        for (let record_name of records){
            let record = {};
            let record_items = Object.fromEntries(Object.entries(cmd_line).filter(([k, v]) => k.startsWith(record_name)));
            for (let [key, value] of Object.entries(record_items)){
                record[key.slice(record_name.length + 1)] = value;
                delete cmd_line[key];
            }
            cmd_line[record_name.toString()] = record;
        }
        if ("job_order" in cmd_line && cmd_line["job_order"]){
            try {
                job_order_object = cast(
                    CWLObjectType,
                    loader.resolve_ref(cmd_line["job_order"])[0],
                );
            } catch (error) {
                _logger.exception(`Failed to resolve job_order: ${cmd_line["job_order"]}`);
                process.exit(1);
            }
        } else{
            job_order_object = {"id": args.workflow};
        }

        delete cmd_line["job_order"];

        Object.assign(job_order_object, Object.fromEntries(Object.entries(cmd_line).map(([k, v]) =>[namemap[k], v])));

        if (secret_store && secrets_req){
            secret_store.store(
                secrets_req["secrets"].map(sc => shortname(sc)),
                job_order_object,
            );
        }

        if (_logger.isEnabledFor(logging.DEBUG)){
            _logger.debug(
                `Parsed job order from command line: ${JSON.stringify(job_order_object, null, 4)}`);
        }
    }
    for (let inp of process.tool["inputs"]){
        if ("default" in inp && (
            job_order_object === undefined || !(shortname(inp["id"]) in job_order_object)
        )){
            if (job_order_object === undefined){
                job_order_object = {};
            }
            job_order_object[shortname(inp["id"])] = inp["default"];
        }
    }

    let path_to_loc = (p: CWLObjectType) => {
        if (!("location" in p) && "path" in p){
            p["location"] = p["path"];
            delete p["path"];
        }
    };

    let ns = {}; 
    ns = {...ns, ...(job_order_object["$namespaces"] || {}), ...(process.metadata["$namespaces"] || {})};
    let ld = new Loader(ns);

    let expand_formats = (p: CWLObjectType) => {
        if ("format" in p){
            p["format"] = ld.expand_url(p["format"], "");
        }
    };

    visit_class(job_order_object, ["File", "Directory"], path_to_loc);
    visit_class(
        job_order_object,
        ["File"],
        functools.partial(add_sizes, make_fs_access(input_basedir)),
    );
    visit_class(job_order_object, ["File"], expand_formats);
    adjustDirObjs(job_order_object, trim_listing);
    normalizeFilesDirs(job_order_object);

    if (print_input_deps){
        if (!runtime_context){
            throw new Error("runtime_context is required for print_input_deps.");
        }
        runtime_context.toplevel = true;
        let builder = process._init_job(job_order_object, runtime_context);
        builder.loadListing = "no_listing";
        builder.bind_input(
            process.inputs_record_schema, job_order_object, true
        );
        let basedir: string | null = null;
        let uri = job_order_object["id"];
        if (uri == args.workflow){
            basedir = path.dirName(uri);
            uri = "";
        }
        printdeps(
            job_order_object,
            loader,
            stdout,
            relative_deps,
            uri,
            basedir || undefined,
            false,
        );
        process.exit(0);
    }

    if (secret_store && secrets_req){
        secret_store.store(
            secrets_req["secrets"].map(sc => shortname(sc)),
            job_order_object,
        );
    }

    if ("cwl:tool" in job_order_object){
        delete job_order_object["cwl:tool"];
    }
    if ("id" in job_order_object){
        delete job_order_object["id"];
    }
    return job_order_object;
}
function make_relative(base: string, obj: CWLObjectType): void {
    let uri = <string> obj.get("location", obj.get("path"))
    if (uri.split("/")[0].includes(":") && !uri.startsWith("file://")) {
        // Do nothing
    } else {
        if (uri.startsWith("file://")) {
            uri = uri_file_path(uri)
            obj["location"] = os.path.relpath(uri, base)
        }
    }
}

function printdeps(
    obj: CWLObjectType,
    document_loader: Loader,
    stdout: IO<string>,
    relative_deps: string,
    uri: string,
    basedir: string | null = null,
    nestdirs: boolean = true,
): void {
    const deps = find_deps(obj, document_loader, uri, basedir, nestdirs)
    let base: string;
    if (relative_deps == "primary") {
        base = basedir ? basedir : os.path.dirname(uri_file_path(uri))
    } else if (relative_deps == "cwd") {
        base = os.getcwd()
    }
    visit_class(deps, ("File", "Directory"), functools.partial(make_relative, base))
    json_dump(deps, stdout, 4, str)
}

function prov_deps(
    obj: CWLObjectType,
    document_loader: Loader,
    uri: string,
    basedir: string | null = null,
): CWLObjectType {
    const deps = find_deps(obj, document_loader, uri, basedir)

    function remove_non_cwl(deps: CWLObjectType): void {
        if ("secondaryFiles" in deps) {
            const sec_files = <CWLObjectType[]> deps["secondaryFiles"]
            for (let index = 0; index < sec_files.length; index++) {
                const entry = sec_files[index]
                if (!("format" in entry && entry["format"] == CWL_IANA)) {
                    delete sec_files[index]
                } else {
                    remove_non_cwl(entry)
                }
            }
        }
    }

    remove_non_cwl(deps)
    return deps
}

function find_deps(
    obj: CWLObjectType,
    document_loader: Loader,
    uri: string,
    basedir: string | null = null,
    nestdirs: boolean = true
): CWLObjectType {
    const deps: CWLObjectType = {
        "class": "File",
        "location": uri,
        "format": CWL_IANA
    }

    function loadref(base: string, uri: string): CommentedMap | CommentedSeq | string | null {
        return document_loader.fetch(document_loader.fetcher.urljoin(base, uri))
    }

    const sfs = scandeps(
        basedir ? basedir : uri,
        obj,
        {"$import", "run"},
        {"$include", "$schemas", "location"},
        loadref,
        nestdirs
    )
    if (sfs) {
        deps["secondaryFiles"] = <MutableSequence<CWLOutputAtomType>> mergedirs(sfs)
    }

    return deps
}
function print_pack(
    loadingContext: LoadingContext,
    uri: string,
): string {
    let packed = pack(loadingContext, uri);
    let target;
    if (packed["$graph"].length > 1) {
        target = packed;
    } 
    else {
        target = packed["$graph"][0];
    }
    return JSON.stringify(target, null, 4);
}

function supported_cwl_versions(enable_dev: boolean): Array<string>{
    let versions;
    if (enable_dev) {
        versions = Object.keys(ALLUPDATES);
    } else {
        versions = Object.keys(UPDATES);
    }
    versions.sort();
    return versions;
}

function setup_schema(
    args: any, custom_schema_callback?: Function | null
): void {
    if (custom_schema_callback != null) {
        custom_schema_callback();
    } 
    else if (args.enable_ext) {
        let ext10 = files("cwltool").join("extensions.yml").readText("utf-8");
        let ext11 = files("cwltool").join("extensions-v1.1.yml").readText("utf-8");
        let ext12 = files("cwltool").join("extensions-v1.2.yml").readText("utf-8");
        use_custom_schema("v1.0", "http://commonwl.org/cwltool", ext10);
        use_custom_schema("v1.1", "http://commonwl.org/cwltool", ext11);
        use_custom_schema("v1.2", "http://commonwl.org/cwltool", ext12);
        use_custom_schema("v1.2.0-dev1", "http://commonwl.org/cwltool", ext11);
        use_custom_schema("v1.2.0-dev2", "http://commonwl.org/cwltool", ext11);
        use_custom_schema("v1.2.0-dev3", "http://commonwl.org/cwltool", ext11);
    } 
    else {
        use_standard_schema("v1.0");
        use_standard_schema("v1.1");
        use_standard_schema("v1.2");
        use_standard_schema("v1.2.0-dev1");
        use_standard_schema("v1.2.0-dev2");
        use_standard_schema("v1.2.0-dev3");
    }
}
class ProvLogFormatter extends logging.Formatter {
    constructor() {
        super("[%(asctime)sZ] %(message)s");
    }

    formatTime(record: logging.LogRecord, datefmt: Optional[str] = null): string {
        let formatted_time = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(Number(record.created)));
        let with_msecs = `${formatted_time},${record.msecs.toFixed(3)}`;
        return with_msecs;
    }
}

let ProvOut: Union<io.TextIOWrapper, WritableBagFile>;

function setup_provenance(
    args: argparse.Namespace,
    argsl: List<string>,
    runtimeContext: RuntimeContext,
): Tuple<ProvOut, logging.StreamHandler<ProvOut>> {
    if (!args.compute_checksum) {
        _logger.error("--provenance incompatible with --no-compute-checksum");
        throw new ArgumentException();
    }
    let ro = new ResearchObject(
        getdefault(runtimeContext.make_fs_access, StdFsAccess)(""),
        args.tmpdir_prefix,
        args.orcid,
        args.cwl_full_name,
    );
    runtimeContext.research_obj = ro;
    let log_file_io = open_log_file_for_activity(ro, ro.engine_uuid);
    let prov_log_handler = new logging.StreamHandler(log_file_io);

    prov_log_handler.setFormatter(new ProvLogFormatter());
    _logger.addHandler(prov_log_handler);
    _logger.debug("[provenance] Logging to %s", log_file_io);
    if (argsl !== null) {
        _logger.info("[cwltool] %s %s", sys.argv[0], argsl.join(" "));
    }
    _logger.debug("[cwltool] Arguments: %s", args);
    return [log_file_io, prov_log_handler];
}

function setup_loadingContext(
    loadingContext: Optional<LoadingContext>,
    runtimeContext: RuntimeContext,
    args: argparse.Namespace,
): LoadingContext {
    if (loadingContext === null) {
        loadingContext = new LoadingContext(vars(args));
        loadingContext.singularity = runtimeContext.singularity;
        loadingContext.podman = runtimeContext.podman;
    } else {
        loadingContext = loadingContext.copy();
    }
    loadingContext.loader = default_loader(
        loadingContext.fetcher_constructor,
        args.enable_dev,
        args.doc_cache,
    );
    loadingContext.research_obj = runtimeContext.research_obj;
    loadingContext.disable_js_validation = args.disable_js_validation || (!args.do_validate);
    loadingContext.construct_tool_object = getdefault(
        loadingContext.construct_tool_object, workflow.default_make_tool);
    loadingContext.resolver = getdefault(loadingContext.resolver, tool_resolver);
    if (loadingContext.do_update === null) {
        loadingContext.do_update = !(args.pack || args.print_subgraph);
    }

    return loadingContext;
}

function make_template(tool: Process, target: IO<string>): void {
    function my_represent_none(self: Any, data: Any): Any {
        return self.represent_scalar("tag:yaml.org,2002:null", "null");
    }

    ruamel.yaml.representer.RoundTripRepresenter.add_representer(null, my_represent_none);
    let yaml = new YAML();
    yaml.default_flow_style = false;
    yaml.indent = 4;
    yaml.block_seq_indent = 2;
    yaml.dump(generate_input_template(tool), target);
}
function inherit_reqshints(tool: Process, parent: Process): void {
    /**Copy down requirements and hints from ancestors of a given process.**/
    for (let parent_req of parent.requirements) {
        let found = false;
        for (let tool_req of tool.requirements) {
            if (parent_req["class"] === tool_req["class"]) {
                found = true;
                break;
            }
        }
        if (!found) {
            tool.requirements.push(parent_req);
        }
    }
    for (let parent_hint of parent.hints) {
        let found = false;
        for (let tool_req of tool.requirements) {
            if (parent_hint["class"] === tool_req["class"]) {
                found = true;
                break;
            }
        }
        if (!found) {
            for (let tool_hint of tool.hints) {
                if (parent_hint["class"] === tool_hint["class"]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                tool.hints.push(parent_hint);
            }
        }
    }
}

function choose_target(args: argparse.Namespace, tool: Process, loading_context: LoadingContext):  Process | null {
    /**Walk the Workflow, extract the subset matches all the args.targets.**/
    if (loading_context.loader === null) {
        throw ("loading_context.loader cannot be null");
    }
    if (tool instanceof Workflow) {
        const url = urllib.parse.urlparse(tool.tool["id"]);
        let extracted;
        if (url.fragment) {
            extracted = get_subgraph([tool.tool["id"] + "/" + r for (let r of args.target)], tool, loading_context);
        } else {
            extracted = get_subgraph([
                loading_context.loader.fetcher.urljoin(tool.tool["id"], "#" + r)
                for (let r of args.target)
            ], tool, loading_context);
        }
    } else {
        _logger.error("Can only use --target on Workflows");
        return null;
    }
    if (loading_context.loader.idx instanceof MutableMapping) {
        loading_context.loader.idx[extracted["id"]] = extracted;
        tool = make_tool(extracted["id"], loading_context);
    } else {
        throw ("Missing loading_context.loader.idx!");
    }

    return tool;
}
function choose_step(
    args: any,
    tool: any,
    loading_context: any,
): any {
    if (loading_context.loader === null) {
        throw new Error("loading_context.loader cannot be null");
    }

    if (tool instanceof Workflow) {
        let url = new URL(tool.tool["id"]);
        let step_id;
        if (url.hash) {
            step_id = tool.tool["id"] + "/" + args.single_step;
        } else {
            step_id = loading_context.loader.fetcher.urljoin(
                tool.tool["id"], "#" + args.single_step
            );
        }
        let extracted = get_step(tool, step_id, loading_context);
        if (loading_context.loader.idx instanceof Map) {
            loading_context.loader.idx[extracted["id"]] = cmap(extracted);
            tool = make_tool(extracted["id"], loading_context);
        } else {
            throw new Error("Missing loading_context.loader.idx!");
        }
    } else {
        console.error("Can only use --single-step on Workflows");
        return null;
    }

    return tool;
}

function choose_process(
    args: any,
    tool: any,
    loadingContext: any,
): any {
    if (loadingContext.loader === null) {
        throw new Error("loadingContext.loader cannot be null");
    }

    if (tool instanceof Workflow) {
        let url = new URL(tool.tool["id"]);
        let step_id;
        if (url.hash) {
            step_id = tool.tool["id"] + "/" + args.single_process;
        } else {
            step_id = loadingContext.loader.fetcher.urljoin(
                tool.tool["id"], "#" + args.single_process
            );
        }
        let [extracted, workflow_step] = get_process(
            tool,
            step_id,
            loadingContext,
        );
        if (loadingContext.loader.idx instanceof Map) {
            loadingContext.loader.idx[extracted["id"]] = extracted;
            let new_tool = make_tool(extracted["id"], loadingContext);
            inherit_reqshints(new_tool, workflow_step);
            return new_tool;
        } else {
            throw new Error("Missing loadingContext.loader.idx!");
        }
    } else {
        console.error("Can only use --single-process on Workflows");
        return null;
    }
}

function check_working_directories(
    runtimeContext: any,
): any {
    for (let dirprefix of ["tmpdir_prefix", "tmp_outdir_prefix", "cachedir"]) {
        if (
            runtimeContext[dirprefix]
            && runtimeContext[dirprefix] !== DEFAULT_TMP_PREFIX
        ) {
            let sl = (
                "/"
                if runtimeContext[dirprefix].endsWith("/") || dirprefix === "cachedir"
                else ""
            );
            runtimeContext[dirprefix] = path.resolve(runtimeContext[dirprefix]) + sl;
            if (!fs.existsSync(path.dirname(runtimeContext[dirprefix]))) {
                try {
                    fs.mkdirSync(path.dirname(runtimeContext[dirprefix]), {recursive: true});
                } catch (error) {
                    console.error("Failed to create directory.", error);
                    return 1;
                }
            }
        }
    }
    return null;
}
function print_targets(
    tool: Process,
    stdout: IO<string>,
    loading_context: LoadingContext,
    prefix: string = "",
): void {
    /* Recursively find targets for --subgraph and friends. */
    for (let f of ["outputs", "inputs"]) {
        if (tool.tool[f]) {
            _logger.info(`${prefix.slice(0, -1)} ${f[0].toUpperCase()}${f.slice(1, -1)} targets:`);
            console.log(
                "  " + "\n  ".join(tool.tool[f].map(t => `${prefix}${shortname(t['id'])}`)),
                {file: stdout},
            )
        }
    }
    if ("steps" in tool.tool) {
        loading_context = { ...loading_context };
        loading_context.requirements = tool.requirements;
        loading_context.hints = tool.hints;
        _logger.info(`${prefix.slice(0, -1)} steps targets:`);
        for (let t of tool.tool["steps"]) {
            console.log(`  ${prefix}${shortname(t['id'])}`, {file: stdout});
            let run: Union<string, Process, Record<string, any>> = t["run"];
            let process;
            if (typeof run === 'string') {
                process = make_tool(run, loading_context);
            } else if (run instanceof Object) {
                process = make_tool(cmap(run as CommentedMap), loading_context);
            } else {
                process = run;
            }
            print_targets(process, stdout, loading_context, `${prefix}${shortname(t['id'])}/`);
        }
    }
}
function main(
    argsl: string[] = null,
    args: argparse.Namespace = null,
    job_order_object: CWLObjectType = null,
    stdin: any = sys.stdin,
    stdout: string[] = null,
    stderr: string[] = sys.stderr,
    versionfunc: Function = versionstring,
    logger_handler: logging.Handler = null,
    custom_schema_callback: Function = null,
    executor: JobExecutor = null,
    loadingContext: LoadingContext = null,
    runtimeContext: RuntimeContext,
    input_required: boolean = true,
) : number {
    if (stdout === null) {
        if (sys.stdout.hasOwnProperty("encoding") && (sys.stdout.encoding.toUpperCase() !== "UTF-8" || sys.stdout.encoding.toUpperCase() !== "UTF8")){
            if(sys.stdout.hasOwnProperty("detach")){
                stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8");
            } else {
                stdout = getwriter("utf-8")(sys.stdout);
            }
        } else {
            stdout = sys.stdout;
        }
        stdout= cast(IO[str], stdout);
    }
    _logger.removeHandler(defaultStreamHandler);
    var stderr_handler = logger_handler;
    if (stderr_handler !== null) {
        _logger.addHandler(stderr_handler);
    } else {
        coloredlogs.install(logger=_logger, stream=stderr);
        stderr_handler = _logger.handlers[-1];
    }
    var workflowobj = null,
        prov_log_handler: Optional[logging.StreamHandler[ProvOut]] = null,
        global docker_exe;
        try {
            if (args === null) {
                if (argsl === null) {
                    argsl = sys.argv.slice(1);
                }
                var addl: string[]= [];
 
    // more code continues, but omitted for brevity.
}
function find_default_container(
    builder: HasReqsHints,
    default_container: string | null = null,
    use_biocontainers: boolean | null = null,
    container_image_cache_path: string | null = null
): string | null {
    if (!default_container && use_biocontainers) {
        default_container = get_container_from_software_requirements(
            use_biocontainers, builder, container_image_cache_path
        );
    }
    return default_container;
}

function windows_check() {
    if (os.name == "nt") {
        warnings.warn(
            "The CWL reference runner (cwltool) no longer supports running " +
            "CWL workflows natively on MS Windows as its previous MS Windows " +
            "support was incomplete and untested. Instead, please see " +
            "https://pypi.org/project/cwltool/#ms-windows-users " +
            "for instructions on running cwltool via " +
            "Windows Subsystem for Linux 2 (WSL2). If don't need to execute " +
            "CWL documents, then you can ignore this warning, but please " +
            "consider migrating to https://pypi.org/project/cwl-utils/ " +
            "for your CWL document processing needs.",
            1
        );
    }
}

function run(...args: any[]): number {
    windows_check();
    signal.signal(signal.SIGTERM, _signal_handler);
    let retval = 1;
    try {
        retval = main(...args);
    }
    finally {
        _terminate_processes();
    }
    return retval;
}

if (require.main === module) {
    process.exit(run(process.argv.slice(2)));
}
