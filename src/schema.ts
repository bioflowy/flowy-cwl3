import { InputArraySchema, type InputEnumSchema, type InputRecordSchema } from 'cwl-ts-auto';
import { isString } from './utils.js';

function avro_field_name(url: string): string {
  try {
    const d = new URL(url);
    if (d.hash) {
      return d.hash.split('/').pop();
    }
    return d.pathname.split('/').pop();
  } catch (e) {
    console.log(e);
    throw e;
  }
}
const saladp = 'https://w3id.org/cwl/salad#';
const primitives = (function createPrimitives() {
  const primitives: { [key: string]: string } = {};
  primitives['http://www.w3.org/2001/XMLSchema#string'] = 'string';
  primitives['http://www.w3.org/2001/XMLSchema#boolean'] = 'boolean';
  primitives['http://www.w3.org/2001/XMLSchema#int'] = 'int';
  primitives['http://www.w3.org/2001/XMLSchema#long'] = 'long';
  primitives['http://www.w3.org/2001/XMLSchema#float'] = 'float';
  primitives['http://www.w3.org/2001/XMLSchema#double'] = 'double';
  primitives[`${saladp}pnull`] = 'null';
  primitives[`${saladp}enum`] = 'enum';
  primitives[`${saladp}array`] = 'array';
  primitives[`${saladp}record`] = 'record';
  return primitives;
})();

function avro_type_name(url: string): string {
  if (url in primitives) {
    return primitives[url];
  }
  try {
    const u = new URL(url);
    const joined = [...u.hostname.split('.').reverse(), ...u.pathname.split('/'), ...u.hash.split('/')].filter(
      (x) => x,
    );
    return joined.join('.');
  } catch {
    return url;
  }
}
export function make_valid_avro_string(
  item: string,
  alltypes: { [key: string]: any },
  found: Set<string>,
  union = false,
  fielddef = false,
  vocab: { [key: string]: string },
): any {
  if (union) {
    if (alltypes[item] && !found.has(avro_type_name(item))) {
      return make_valid_avro(alltypes[item], alltypes, found, union, fielddef, vocab);
    }

    if (vocab[item]) {
      return avro_type_name(vocab[item]);
    }

    return avro_type_name(item);
  }
}
export function make_valid_avro_array(
  items: (string | InputArraySchema | InputRecordSchema | InputEnumSchema)[],
  alltypes: { [key: string]: any },
  found: Set<string>,
  union = false,
  fielddef = false,
  vocab: { [key: string]: string } = null,
) {
  return items.map((i) => make_valid_avro(i, alltypes, found, union, fielddef, vocab));
}
export function make_valid_avro(
  item:
    | InputArraySchema
    | InputRecordSchema
    | InputEnumSchema
    | (string | InputArraySchema | InputRecordSchema | InputEnumSchema)[]
    | string,
  alltypes: { [key: string]: any },
  found: Set<string>,
  union = false,
  fielddef = false,
  vocab: { [key: string]: string } = null,
): any | undefined {
  if (Array.isArray(item)) {
    return make_valid_avro_array(item, alltypes, found, union, fielddef, vocab);
  } else if (isString(item)) {
    return make_valid_avro_string(item, alltypes, found, union, fielddef, vocab);
  } else {
    return make_valid_avro_obj(item, alltypes, found, fielddef, vocab);
  }
}
export function make_valid_avro_obj(
  item: InputArraySchema | InputRecordSchema | InputEnumSchema,
  alltypes: { [key: string]: any },
  found: Set<string>,
  fielddef = false,
  vocab: { [key: string]: string } = null,
): any {
  if (item.name) {
    if (fielddef) {
      item.name = avro_field_name(item.name);
    } else {
      item.name = avro_type_name(item.name);
    }
  }

  if (item.type === 'record' || item.type === 'enum') {
    if (found.has(item.name)) {
      return item.name;
    }
    found.add(item.name);
  }
  ['type', 'items', 'values', 'fields'].forEach((field) => {
    if (field in item) {
      const ret = make_valid_avro(item[field], alltypes, found, true, field === 'fields', vocab);
      if (!isUndefinedOrAllUndefinedArray(ret)) {
        item[field] = ret;
      }
    }
  });
  if ('symbols' in item) {
    const symbols = (item['symbols'] as any[]).map((sym) => avro_field_name(sym));
    item['symbols'] = symbols;
  }
  return undefined;
}

function isUndefinedOrAllUndefinedArray(value) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== undefined) {
        return false;
      }
    }
    return true;
  }
  return value === undefined;
}
