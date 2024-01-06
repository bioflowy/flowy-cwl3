export function dirnames3(path: string): string {
  let dirname = path.split('/').slice(0, -1).join('/');
  if (!dirname.endsWith('/')) {
    dirname = `${dirname}/`;
  }
  return dirname;
}
