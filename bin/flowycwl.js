#!/usr/bin/env node
// @ts-check

import { executeClient } from '../dist/client/client.js';

executeClient()
  .then((e) => {
    process.exit(e);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  });
