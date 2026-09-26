#!/usr/bin/env node
// Sets the release version everywhere it lives, so the three package.json files, their
// lockfiles, the changelog and the git tag can never disagree.
//
//   npm run release:version -- 1.1.0
//
// Then commit, tag v1.1.0 and push the tag — see RELEASING.md.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run release:version -- <major.minor.patch>   e.g. 1.1.0');
  process.exit(1);
}

function updateJson(rel, mutate) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ${rel}`);
}

console.log(`Setting version ${version}:`);
for (const dir of ['.', 'backend', 'frontend']) {
  updateJson(path.join(dir, 'package.json'), (pkg) => { pkg.version = version; });
  updateJson(path.join(dir, 'package-lock.json'), (lock) => {
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
  });
}

// "## [Unreleased]" becomes this release, and a fresh empty Unreleased section goes on top.
const changelogPath = path.join(root, 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  const today = new Date().toISOString().slice(0, 10);
  let text = fs.readFileSync(changelogPath, 'utf8');
  if (text.includes(`## [${version}]`)) {
    console.log('  CHANGELOG.md already has this version — left as is');
  } else if (/## \[Unreleased\]/.test(text)) {
    text = text.replace(/## \[Unreleased\]\n/, `## [Unreleased]\n\n## [${version}] - ${today}\n`);
    fs.writeFileSync(changelogPath, text);
    console.log('  CHANGELOG.md');
  } else {
    console.warn('  CHANGELOG.md has no "## [Unreleased]" section — add release notes by hand');
  }
}

console.log(`\nNext:\n  git commit -am "Release v${version}"\n  git tag v${version}\n  git push origin main v${version}`);
