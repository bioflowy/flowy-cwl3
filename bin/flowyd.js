#!/usr/bin/env node
// @ts-check

import { main } from '../dist/JobExecutor.js';

main('http://localhost:3000')
  .then(() => {
    console.log('finished');
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  });
