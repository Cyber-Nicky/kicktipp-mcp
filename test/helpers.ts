import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');
