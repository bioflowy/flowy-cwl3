import cloneDeep from 'lodash';

export function deepcopy<T>(value: T): T {
  return cloneDeep(value) as T;
}
