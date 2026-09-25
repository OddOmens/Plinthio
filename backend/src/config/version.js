import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The one place the running version comes from: backend/package.json, which the release
// script (scripts/set-version.mjs) keeps in step with the root and frontend packages and
// the git tag. APP_VERSION can override it (e.g. a dev build stamped by CI).
const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

export const APP_VERSION = process.env.APP_VERSION || readPackageVersion();

// Minimal semver compare for x.y.z (a "-pre" suffix sorts below its release). Returns
// -1 / 0 / 1. Enough for "is the published release newer than me" without a dependency.
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v || '').replace(/^v/i, '').split('-', 2);
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}
