export function dirnames3(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
