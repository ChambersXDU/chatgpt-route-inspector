import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import archiver from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['--check', path.join(root, 'userscript', 'chatgpt-route-inspector.user.js')], { cwd: root, stdio: 'inherit' });

async function zipDirectory(source, target) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(target);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(source, false);
    void archive.finalize();
  });
}

const extensionName = `chatgpt-route-inspector-${version}.zip`;
const extensionTarget = path.join(releaseDir, extensionName);
await zipDirectory(path.join(root, 'dist', 'extension'), extensionTarget);

const userscriptName = `chatgpt-route-inspector-${version}.user.js`;
const userscriptTarget = path.join(releaseDir, userscriptName);
await copyFile(path.join(root, 'userscript', 'chatgpt-route-inspector.user.js'), userscriptTarget);

const artifacts = [extensionName, userscriptName];
const sums = [];
for (const name of artifacts) {
  const file = path.join(releaseDir, name);
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  sums.push(`${hash}  ${name}`);
}
await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
process.stdout.write(`Packaged extension and userscript installers in ${releaseDir}\n`);
