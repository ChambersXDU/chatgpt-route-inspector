import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'userscript', 'chatgpt-route-inspector.user.js');
const releaseDir = path.join(root, 'release');

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
execFileSync(process.execPath, ['--check', source], { cwd: root, stdio: 'inherit' });

const sourceText = await readFile(source, 'utf8');
const version = /^\/\/ @version\s+([^\s]+)$/m.exec(sourceText)?.[1];
if (!version) throw new Error('Userscript metadata is missing @version');

const userscriptName = `chatgpt-route-inspector-${version}.user.js`;
const userscriptTarget = path.join(releaseDir, userscriptName);
await copyFile(source, userscriptTarget);

const hash = createHash('sha256').update(await readFile(userscriptTarget)).digest('hex');
await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), `${hash}  ${userscriptName}\n`, 'utf8');
process.stdout.write(`Packaged Tampermonkey userscript ${userscriptName}\n`);
