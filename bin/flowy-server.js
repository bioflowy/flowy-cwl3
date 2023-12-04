#!/usr/bin/env node
// @ts-check

import * as server from '../dist/server.js';

const serverInstance = server.getServer();
serverInstance
  .start()
  .then(() => {
    console.log('finished');
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  });
