import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rdf from 'rdflib';
import { filePathToURI } from './utils.js';

function guessContentType(path: string): string {
  const vals = path.split('.');
  const ext = vals[vals.length - 1];
  switch (ext) {
    case 'ttl':
      return 'text/turtle';
    default:
      return 'application/rdf+xml';
  }
}
export class FormatGraph {
  ontologyPaths: string[] = [];
  store: rdf.Store = rdf.graph();
  constructor(ontologyPath?: string) {
    if (ontologyPath) {
      this.ontologyPaths.push(ontologyPath);
    } else {
      const dirname = path.dirname(fileURLToPath(import.meta.url));
      this.ontologyPaths.push(path.join(dirname, '../resources/EDAM_1.25.owl'));
    }
  }
  async loads(): Promise<void> {
    for (const ontologyPath of this.ontologyPaths) {
      const store = await this.load(ontologyPath);
      this.store.addAll(store.statements);
    }
    this.ontologyPaths.length = 0;
  }
  isLoaded() {
    return this.ontologyPaths.length === 0;
  }
  addOntology(ontologyPath) {
    this.ontologyPaths.push(ontologyPath);
  }
  async load(ontologyPath: string): Promise<rdf.Store> {
    const store = rdf.graph();
    const owlData = (await readFile(ontologyPath)).toString('utf-8');
    return new Promise((resolve, reject) => {
      rdf.parse(owlData, store, filePathToURI(ontologyPath), guessContentType(ontologyPath), (error, _graph) => {
        if (error) {
          reject(error);
        } else {
          resolve(store);
        }
      });
    });
  }
  subClassOfPredicate = rdf.sym('http://www.w3.org/2000/01/rdf-schema#subClassOf');
  equivalentClassPredicate = rdf.sym('http://www.w3.org/2002/07/owl#equivalentClass');
  isSubClassOf(child: string, parent: string): boolean {
    if (child === parent) {
      return true;
    }
    if (!(child.startsWith('http:') && parent.startsWith('http:'))) {
      return false;
    }
    const childTerm = rdf.sym(child);
    const parentTerm = rdf.sym(parent);
    for (const result of this.store.each(childTerm, this.subClassOfPredicate)) {
      if (this.isSubClassOf(result.value, parent)) {
        return true;
      }
    }
    for (const result of this.store.each(childTerm, this.equivalentClassPredicate)) {
      if (this.isSubClassOf(result.value, parent)) {
        return true;
      }
    }
    for (const result of this.store.each(parentTerm, this.equivalentClassPredicate)) {
      if (this.isSubClassOf(child, result.value)) {
        return true;
      }
    }
    return false;
  }
}
