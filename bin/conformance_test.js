import { conformance_test } from '../dist/main.js';

conformance_test()
  .then((e) => {
    process.exit(e);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  });
