import path from 'node:path';
import * as cwl from 'cwl-ts-auto';
import { cloneDeep } from 'lodash-es';
import { Builder, contentLimitRespectedReadBytes, substitute } from './builder.js';
import {
  CommandOutputBinding,
  CommandOutputParameter,
  CommandOutputRecordField,
  Directory,
  File,
  RecordType,
} from './cwltypes.js';
import { ValidationException, WorkflowException } from './errors.js';
import { _logger } from './loghandler.js';
import { convertDictToFileDirectory } from './main.js';
import { compute_checksums, shortname } from './process.js';
import { StdFsAccess } from './stdfsaccess.js';
import {
  CWLObjectType,
  CWLOutputType,
  adjustFileObjs,
  aslist,
  fileUri,
  get_listing,
  isDirectory,
  isFile,
  isStringOrStringArray,
  normalizeFilesDirs,
  splitext,
  str,
  uriFilePath,
  visitFile,
  visitFileDirectory,
} from './utils.js';
import { validate } from './validate.js';
interface OutputPortsType {
  [key: string]: CWLOutputType | undefined;
}
function remove_path(f: File | Directory): void {
  if (f.path) {
    f.path = undefined;
  }
}
function revmap_file(builder: Builder, outdir: string, f: File | Directory): File | Directory | null {
  if (outdir.startsWith('/')) {
    outdir = fileUri(outdir);
  }
  if (f.location && !f.path) {
    const location: string = f.location;
    if (location.startsWith('file://')) {
      f.path = uriFilePath(location);
    } else {
      f.location = builder.fs_access.join(outdir, f.location);
      return f;
    }
  }
  if (f['dirname']) {
    delete f['dirname'];
  }
  if (f.path) {
    const path1 = builder.fs_access.join(builder.outdir, f.path);
    const uripath = fileUri(path1);
    f.path = undefined;
    if (!f.basename) {
      f.basename = path.basename(path1);
    }
    if (!builder.pathmapper) {
      throw new Error("Do not call revmap_file using a builder that doesn't have a pathmapper.");
    }
    const revmap_f = builder.pathmapper.reversemap(path1);
    if (revmap_f && !builder.pathmapper.mapper(revmap_f[0]).type.startsWith('Writable')) {
      f.location = revmap_f[1];
    } else if (uripath == outdir || uripath.startsWith(outdir + path.sep) || uripath.startsWith(`${outdir}/`)) {
      f.location = uripath;
    } else if (
      path1 == builder.outdir ||
      path1.startsWith(builder.outdir + path.sep) ||
      path1.startsWith(`${builder.outdir}/`)
    ) {
      const joined_path = builder.fs_access.join(
        outdir,
        encodeURIComponent(path1.substring(builder.outdir.length + 1)),
      );
      f.location = joined_path;
    } else {
      throw new WorkflowException(
        `Output file path ${path1} must be within designated output directory ${builder.outdir} or an input file pass through.`,
      );
    }
    return f;
  }
  throw new WorkflowException(`Output File object is missing both 'location' and 'path' fields: ${str(f)}`);
}

function checkValidLocations(fsAccess: StdFsAccess, ob: Directory | File): void {
  const location = ob.location;
  if (location.startsWith('_:')) {
    return;
  }
  if (isFile(ob) && !fsAccess.isfile(location)) {
    throw new Error(`Does not exist or is not a File: '${location}'`);
  }
  if (isDirectory(ob) && !fsAccess.isdir(location)) {
    throw new Error(`Does not exist or is not a Directory: '${location}'`);
  }
}

export async function collect_output_ports(
  ports: CommandOutputParameter[],
  fields: CommandOutputRecordField[],
  builder: Builder,
  outdir: string,
  rcode: number,
  compute_checksum = true,
  _jobname: string,
): Promise<OutputPortsType> {
  let ret: OutputPortsType = {};
  const debug = _logger.isDebugEnabled();
  builder.resources['exitCode'] = rcode;

  try {
    const fs_access = new builder.make_fs_access(outdir);
    const custom_output = fs_access.join(outdir, 'cwl.output.json');
    if (fs_access.exists(custom_output)) {
      const f = await fs_access.read(custom_output);
      ret = JSON.parse(f);
      if (debug) {
        _logger.debug(`Raw output from ${custom_output}: ${JSON.stringify(ret, null, 4)}`);
      }
      convertDictToFileDirectory(ret);
    } else if (Array.isArray(ports)) {
      for (let i = 0; i < ports.length; i++) {
        const port = ports[i];
        const fragment = shortname(port.id);
        ret[fragment] = await collect_output(port, builder, outdir, fs_access, compute_checksum);
      }
    }
    if (ret) {
      const revmap = (val) => revmap_file(builder, outdir, val);
      // adjustDirObjs(ret, trim_listing);
      visitFileDirectory(ret, revmap);
      visitFileDirectory(ret, remove_path);
      normalizeFilesDirs(ret);
      visitFileDirectory(ret, (val) => checkValidLocations(fs_access, val));

      if (compute_checksum) {
        const promises: Promise<void>[] = [];
        visitFile(ret, (val) => promises.push(compute_checksums(fs_access, val)));
        await Promise.all(promises);
      }
      // const expected_schema = ((this.names.get_name("outputs_record_schema", null)) as Schema);
      validate({ type: RecordType, fields }, ret, true);
      return ret || {};
    }
  } catch (e) {
    if (e instanceof ValidationException) {
      throw new WorkflowException(`Error validating output record. ${e.message}\n in ${JSON.stringify(ret, null, 4)}`);
    }
    throw e;
  }
  return ret;
}
async function glob_output(
  builder: Builder,
  binding: CommandOutputBinding,
  debug: boolean,
  outdir: string,
  fs_access: StdFsAccess,
  compute_checksum: boolean,
  revmap,
): Promise<[CWLOutputType[], string[]]> {
  const r: CWLOutputType[] = [];
  const globpatterns: string[] = [];

  if (!binding.glob) {
    return [r, globpatterns];
  }

  try {
    for (const g of aslist(binding.glob)) {
      const gb = await builder.do_eval(g);
      if (gb) {
        if (isStringOrStringArray(gb)) {
          globpatterns.push(...aslist(gb));
        } else {
          throw new WorkflowException(
            'Resolved glob patterns must be strings or list of strings, not ' + `${str(gb)} from ${str(binding.glob)}`,
          );
        }
      }
    }

    for (let gb of globpatterns) {
      if (gb.startsWith(builder.outdir)) {
        gb = gb.substring(builder.outdir.length + 1);
      } else if (gb === '.') {
        gb = outdir;
      } else if (gb.startsWith('/')) {
        throw new WorkflowException("glob patterns must not start with '/'");
      }

      try {
        const prefix = fs_access.glob(outdir);
        const sorted_glob_result = fs_access.glob(fs_access.join(outdir, gb)).sort();

        r.push(
          ...sorted_glob_result.map((g) => {
            const decoded_basename = path.basename(g);
            return fs_access.isfile(g)
              ? {
                  class: 'File',
                  location: g,
                  path: fs_access.join(builder.outdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
                  basename: decoded_basename,
                  nameroot: splitext(decoded_basename)[0],
                  nameext: splitext(decoded_basename)[1],
                }
              : {
                  class: 'Directory',
                  location: g,
                  path: fs_access.join(builder.outdir, decodeURIComponent(g.substring(prefix[0].length + 1))),
                  basename: decoded_basename,
                };
          }),
        );
      } catch (e) {
        console.error('Unexpected error from fs_access');
        throw e;
      }
    }

    for (const files of r) {
      const rfile = cloneDeep(files);
      revmap(rfile);
      if (isDirectory(files)) {
        const ll = binding.loadListing;
        if (ll && ll !== cwl.LoadListingEnum.NO_LISTING) {
          get_listing(fs_access, files, ll === cwl.LoadListingEnum.DEEP_LISTING);
        }
      } else if (isFile(rfile) && isFile(files)) {
        if (binding.loadContents) {
          files.contents = await contentLimitRespectedReadBytes(rfile.location);
        }

        if (compute_checksum) {
          await compute_checksums(fs_access, rfile);
          files.checksum = rfile.checksum;
        }

        files.size = fs_access.size(rfile.location);
      }
    }

    return [r, globpatterns];
  } catch (e) {
    throw e;
  }
}
async function collect_secondary_files(
  schema: CommandOutputParameter,
  builder: Builder,
  result: CWLOutputType | null,
  debug: boolean,
  fs_access: StdFsAccess,
  revmap: any,
): Promise<void> {
  for (const primary of aslist(result)) {
    if (primary instanceof Object) {
      if (!primary['secondaryFiles']) {
        primary['secondaryFiles'] = [];
      }
      const pathprefix = primary['path'].substring(0, primary['path'].lastIndexOf(path.sep) + 1);
      for (const sf of aslist(schema.secondaryFiles)) {
        let sf_required: boolean;
        if (sf.required) {
          const sf_required_eval = await builder.do_eval(sf.required, primary);
          if (!(typeof sf_required_eval === 'boolean' || sf_required_eval === null)) {
            throw new WorkflowException(
              `Expressions in the field 'required' must evaluate to a Boolean (true or false) or None. Got ${str(
                sf_required_eval,
              )} for ${sf['required']}.`,
            );
          }
          sf_required = (sf_required_eval as boolean) || false;
        } else {
          sf_required = false;
        }

        let sfpath;
        if (sf['pattern'].includes('$(') || sf['pattern'].includes('${')) {
          sfpath = await builder.do_eval(sf['pattern'], primary);
        } else {
          sfpath = substitute(primary['basename'], sf['pattern']);
        }

        for (let sfitem of aslist(sfpath)) {
          if (!sfitem) {
            continue;
          }
          if (typeof sfitem === 'string') {
            sfitem = { path: pathprefix + sfitem };
          }
          const original_sfitem = JSON.parse(JSON.stringify(sfitem));
          if (!fs_access.exists(revmap(sfitem)['location']) && sf_required) {
            throw new WorkflowException(`Missing required secondary file '${original_sfitem['path']}'`);
          }
          if ('path' in sfitem && !('location' in sfitem)) {
            revmap(sfitem);
          }
          if (fs_access.isfile(sfitem['location'])) {
            sfitem['class'] = 'File';
            primary['secondaryFiles'].push(sfitem);
          } else if (fs_access.isdir(sfitem['location'])) {
            sfitem['class'] = 'Directory';
            primary['secondaryFiles'].push(sfitem);
          }
        }
      }
    }
  }
}
async function handle_output_format(
  schema: CommandOutputParameter,
  builder: Builder,
  result: CWLOutputType,
): Promise<void> {
  if (schema.format) {
    const format_field: string = schema.format;
    if (format_field.includes('$(') || format_field.includes('${')) {
      const results = aslist(result);
      for (let index = 0; index < results.length; index++) {
        const primary = results[index];
        const format_eval: CWLOutputType = await builder.do_eval(format_field, primary);
        if (typeof format_eval !== 'string') {
          let message = `'format' expression must evaluate to a string. Got ${str(format_eval)} from ${format_field}.`;
          if (Array.isArray(result)) {
            message += ` 'self' had the value of the index ${index} result: ${str(primary)}.`;
          }
          throw new WorkflowException(message);
        }
        primary['format'] = format_eval;
      }
    } else {
      aslist(result).forEach((primary) => {
        primary['format'] = format_field;
      });
    }
  }
}
async function collect_output(
  schema: CommandOutputParameter,
  builder: Builder,
  outdir: string,
  fs_access: StdFsAccess,
  compute_checksum = true,
): Promise<CWLOutputType | undefined> {
  const empty_and_optional = false;
  const debug = _logger.isDebugEnabled();
  let result: CWLOutputType | undefined = undefined;
  if (schema.outputBinding) {
    const binding = schema.outputBinding;
    const revmap = revmap_file.bind(null, builder, outdir);
    const [r, globpatterns] = await glob_output(builder, binding, debug, outdir, fs_access, compute_checksum, revmap);
    let optional = false;
    let single = false;
    if (Array.isArray(schema.type)) {
      if (schema.type.includes('null')) {
        optional = true;
      }
      if (schema.type.includes('File') || schema.type.includes('Directory')) {
        single = true;
      }
    } else if (schema.type === 'File' || schema.type === 'Directory') {
      single = true;
    }
    if (binding.outputEval) {
      result = await builder.do_eval(binding.outputEval, r);
    } else {
      result = r as CWLOutputType;
    }
    if (single) {
      try {
        if (!result && !optional) {
          throw new WorkflowException(`Did not find output file with glob pattern: ${str(globpatterns)}.`);
        } else if (!result && optional) {
          // Do nothing
        } else if (Array.isArray(result)) {
          if (result.length > 1) {
            throw new WorkflowException('Multiple matches for output item that is a single file.');
          } else {
            result = result[0] as CWLOutputType;
          }
        }
      } catch {
        // Log the error here
      }
    }
    if (schema.secondaryFiles) {
      await collect_secondary_files(schema, builder, result, debug, fs_access, revmap);
    }
    await handle_output_format(schema, builder, result);
    adjustFileObjs(result, revmap);
    if (optional && (!result || (result instanceof Array && result.length === 0))) {
      return result === 0 || result === '' ? result : null;
    }
  }
  if (!result && !empty_and_optional && typeof schema.type === 'object' && schema.type['type'] === 'record') {
    const out = {};
    for (const field of schema['type']['fields'] as CWLObjectType[]) {
      out[shortname(field['name'] as string)] = await collect_output(
        field as unknown as CommandOutputParameter,
        builder,
        outdir,
        fs_access,
        compute_checksum,
      );
    }
    return out;
  }
  return result;
}
