import { buildProgram } from '../cli/index.js';

buildProgram()
  .parseAsync(process.argv)
  .catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
