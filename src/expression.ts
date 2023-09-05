import { type CWLObjectType, type CWLOutputType, isString } from './utils.js';

// eslint-disable-next-line max-params
export function do_eval(
  ex1: CWLObjectType | undefined,
  jobinput: CWLObjectType,
  requirements: CWLObjectType[],
  outdir: string,
  tmpdir: string,
  resources: { [key: string]: number },
  context?: CWLOutputType,
  timeout?: number,
  // eslint-disable-next-line default-param-last, @typescript-eslint/no-unused-vars
  strip_whitespace = true,
  cwlVersion = '',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  kwargs?: CWLObjectType,
) {
  console.log(jobinput);
  return '2';
}

export function needs_parsing(snippet: any): boolean {
  return isString(snippet) && (snippet.includes('$(') || snippet.includes('${'));
}
