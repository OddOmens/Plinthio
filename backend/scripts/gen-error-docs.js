// Writes docs/error-codes.md from the catalog in src/errors.js.
//   npm run docs:errors
// test/error-codes.test.js fails when the committed file is out of date.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderErrorDocs } from '../src/errorDocs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../docs/error-codes.md');
fs.writeFileSync(out, renderErrorDocs());
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
