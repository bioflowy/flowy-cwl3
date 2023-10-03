#!/usr/bin/env node
// @ts-check

import { run } from '../dist/index.js';

run()
  .then((e) => {
    process.exit(e);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  });
