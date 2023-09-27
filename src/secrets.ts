import { v4 } from 'uuid';
import { type CWLObjectType, type CWLOutputType } from './utils.js';

export class SecretStore {
  private secrets: { [key: string]: string };

  constructor() {
    this.secrets = {};
  }

  add(value: CWLOutputType | null): CWLOutputType | null {
    if (typeof value !== 'string') {
      throw new Error('Secret store only accepts strings');
    }

    if (!(value in this.secrets)) {
      const placeholder = `(secret-${v4()})`;
      this.secrets[placeholder] = value;
      return placeholder;
    }
    return value;
  }

  store(secrets: string[], job: CWLObjectType): void {
    for (const j in job) {
      if (secrets.includes(j)) {
        job[j] = this.add(job[j] as string);
      }
    }
  }

  hasSecret(value: CWLOutputType): boolean {
    if (typeof value === 'string') {
      for (const k in this.secrets) {
        if (value.includes(k)) {
          return true;
        }
      }
    } else if (value instanceof Object) {
      for (const thisValue of Object.values(value)) {
        if (this.hasSecret(thisValue)) {
          return true;
        }
      }
    } else if (Array.isArray(value)) {
      for (const thisValue of value) {
        if (this.hasSecret(thisValue)) {
          return true;
        }
      }
    }
    return false;
  }

  retrieve(value: CWLOutputType): CWLOutputType {
    if (typeof value === 'string') {
      for (const [key, thisValue] of Object.entries(this.secrets)) {
        value = value.replace(key, thisValue);
      }
      return value;
    } else if (Array.isArray(value)) {
      return value.map((v) => this.retrieve(v));
    } else if (value instanceof Object) {
      const result: CWLObjectType = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.retrieve(v);
      }
      return result;
    }
    return value;
  }
}
