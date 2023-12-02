import { getServer } from '../dist/server.js';

function main() {
  const server = getServer();
  server.writeDocumentation();
}
main();
