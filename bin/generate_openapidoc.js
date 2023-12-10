import { getServer } from '../dist/server/server.js';

function main() {
  const server = getServer();
  server.writeDocumentation();
}
main();
