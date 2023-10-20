import { CommandInputEnumSchema } from 'cwl-ts-auto';
import { IOArraySchema, IORecordSchema, InputEnumSchema, isIOArraySchema, isIORecordSchema } from './cwltypes.js';
import { ValidationException } from './errors.js';
import { CWLOutputType, get_filed_name, isDirectory, isFile, isString, str } from './utils.js';

export function validate(
  t:
    | string
    | IOArraySchema
    | InputEnumSchema
    | IORecordSchema
    | (string | IOArraySchema | InputEnumSchema | IORecordSchema)[],
  datum: CWLOutputType | null | undefined,
  raise_ex: boolean,
) {
  if (t === 'null') {
    if (datum === null || datum === undefined) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`${JSON.stringify(datum)} is not null`);
    }
    return false;
  } else if (t === 'string') {
    if (isString(datum)) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`Excepted class is string but ${typeof datum}`);
    }
    return false;
  } else if (t === 'boolean' && typeof datum === 'boolean') {
    if (typeof datum === 'boolean') {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`Excepted class is string but ${typeof datum}`);
    }
    return false;
  } else if (t === 'Any') {
    if (datum) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException("'Any' type must be non-null");
    }
    return false;
  } else if (t === 'File') {
    if (datum && isFile(datum)) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`Excepted class is File but ${JSON.stringify(datum)}`);
    }
    return false;
  } else if (t === 'Directory') {
    if (datum && isDirectory(datum)) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`Excepted class is Directory but ${JSON.stringify(datum)}`);
    }
    return false;
  } else if (t === 'int' || t === 'long') {
    if (typeof datum === 'number' && Number.MIN_SAFE_INTEGER <= datum && datum <= Number.MAX_SAFE_INTEGER) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`Excepted class is string but ${typeof datum}`);
    }
    return false;
  } else if (t === 'float' || t === 'double') {
    if (typeof datum === 'number') {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`${JSON.stringify(datum)} is not ${t}`);
    }
    return false;
  } else if (typeof t === 'number') {
    if (typeof datum === 'number') {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`the value ${JSON.stringify(datum)} is not long`);
    }
    return false;
  } else if (Array.isArray(t)) {
    for (let index = 0; index < t.length; index++) {
      if (validate(t[index], datum, false)) {
        return true;
      }
    }
    if (raise_ex) {
      throw new ValidationException(`the value ${JSON.stringify(datum)} is not ${t.join(' or ')}`);
    }
    return false;
  } else if (t instanceof CommandInputEnumSchema) {
    return t.symbols.some((e) => get_filed_name(e) === datum);
  } else if (isIORecordSchema(t)) {
    if (!(datum instanceof Object)) {
      if (raise_ex) {
        throw new ValidationException(`is not a dict. Expected a ${t.name} object.`);
      }
      return false;
    }

    const errors: ValidationException[] = [];
    for (const f of t.fields) {
      if (f.name === 'class') continue;

      let fieldval: CWLOutputType | null | undefined = null;
      if (datum[get_filed_name(f.name)]) {
        fieldval = datum[get_filed_name(f.name)];
      }

      try {
        if (!validate(f.type, fieldval, raise_ex)) {
          return false;
        }
      } catch (v) {
        if (!datum[f.name]) {
          errors.push(new ValidationException(`missing required field ${f.name}`));
        } else {
          errors.push(new ValidationException(`the ${f.name} field is not valid because ${v}`));
        }
      }
    }

    if (errors.length) {
      if (raise_ex) {
        throw new ValidationException(errors.join('\n'));
      } else {
        return false;
      }
    }
    return true;
  } else if (isIOArraySchema(t)) {
    let valid = true;
    if (Array.isArray(datum)) {
      for (const d of datum) {
        const items = t.items;
        if (!validate(items, d, false)) {
          valid = false;
          break;
        }
      }
    }
    if (valid) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`the value ${JSON.stringify(datum)} is not ${str(t.items)}`);
    }
    return false;
  }
  if (raise_ex) {
    throw new ValidationException(`the value ${JSON.stringify(datum)} is not ${str(t)}`);
  }
  return false;
}
