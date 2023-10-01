import {
  CommandInputArraySchema,
  CommandInputEnumSchema,
  CommandInputRecordSchema,
  InputArraySchema,
} from 'cwl-ts-auto';
import { ValidationException } from './errors.js';
import { aslist, get_filed_name, isString } from './utils.js';

export function validate(t, datum, raise_ex: boolean) {
  if (t === 'null' && !datum) {
    if (raise_ex) {
      throw new ValidationException(`${JSON.stringify(datum)} is not null`);
    }
    return true;
  } else if (t === 'string' && isString(datum)) {
    return true;
  } else if (t === 'boolean' && typeof datum === 'boolean') {
    return true;
  } else if (['org.w3id.cwl.salad.Any', 'Any'].includes(t)) {
    if (datum) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException("'Any' type must be non-null");
    }
    return false;
  } else if (t === 'File' && datum instanceof Object && datum['class'] === 'File') {
    return true;
  } else if (t === 'int' || t === 'long') {
    if (typeof datum === 'number' && Number.MIN_SAFE_INTEGER <= datum && datum <= Number.MAX_SAFE_INTEGER) {
      return true;
    }
    if (raise_ex) {
      throw new ValidationException(`${JSON.stringify(datum)} is not int`);
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
  } else if (t instanceof CommandInputEnumSchema) {
    return t.symbols.some((e) => get_filed_name(e) === datum);
  } else if (t instanceof CommandInputRecordSchema) {
    if (!(datum instanceof Object)) {
      return false;
    }
    for (const ft of t.fields) {
      const name = get_filed_name(ft.name);
      const val = datum[name];
      if (!validate(ft.type, val, false)) {
        return false;
      }
    }
    return true;
  } else if (Array.isArray(t)) {
    for (let index = 0; index < t.length; index++) {
      if (validate(t[index], datum, raise_ex)) {
        return true;
      }
    }
  } else if (t instanceof InputArraySchema || t instanceof CommandInputArraySchema) {
    if (!Array.isArray(datum)) {
      return false;
    }
    for (const d of datum) {
      for (const item of aslist(t.items)) {
        if (!validate(item, d, raise_ex)) {
          return false;
        }
      }
    }
    return true;
  }
  return false;
}
