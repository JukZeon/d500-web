import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await mkdir(path.join(root, 'dist'), { recursive: true });
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// All source is checked in first. Excluded local fixtures, secrets and vendor binaries
// are intentionally never scanned or added by this packaging script.
const { zipSync, strToU8 } = await import('fflate');
const content = {};
for (const name of files) {
  if (name.startsWith('research/') || name.startsWith('.deploy/')) continue;
  content[`d500-workbench/${name}`] = new Uint8Array(await readFile(path.join(root, name)));
}
content['d500-workbench/BUILD_REVISION'] = strToU8(revision + '\n');
await writeFile(path.join(root, 'dist/source.zip'), zipSync(content, { level: 6 }));
await copyFile(path.join(root, 'LICENSE'), path.join(root, 'dist/LICENSE.txt'));
await writeFile(path.join(root, 'dist/version.json'), JSON.stringify({ version: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, revision, builtAt: new Date().toISOString(), author: 'BA7KTC' }) + '\n');
console.log(`Packaged source and version ${revision.slice(0, 12)}`);
