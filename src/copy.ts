import cloneDeep from 'lodash';

export function deepcopy<T>(value: T): T {
  const v = structuredClone(value);
  return v;
}
