import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Running version from backend/package.json (kept in step by scripts/set-version.mjs).
// APP_VERSION overrides it, e.g. for a CI dev build.
const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

export const APP_VERSION = process.env.APP_VERSION || readPackageVersion();

// Minimal x.y.z compare (a "-pre" suffix sorts below its release). Returns -1 / 0 / 1.
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
