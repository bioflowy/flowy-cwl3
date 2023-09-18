import cloneDeep from 'lodash';

export function deepcopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
