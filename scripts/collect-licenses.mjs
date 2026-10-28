import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const entries = [];
for (const [relative, item] of Object.entries(lock.packages || {})) {
  if (!relative || !relative.includes('node_modules/')) continue;
  const dir = path.join(root, relative);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    const names = await fs.readdir(dir);
    const licenses = names.filter(name => /^(LICENSE|LICENCE|COPYING)(?:\..*)?$/i.test(name));
    let text = '';
    for (const name of licenses) text += `\n${await fs.readFile(path.join(dir, name), 'utf8')}`;
    entries.push(`${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || 'See package')}\n${text || 'License information is available in the package repository.'}`);
  } catch { /* Optional packages for other platforms need not be installed. */ }
}
const metadata = JSON.parse(execFileSync(process.env.CARGO || 'cargo', ['metadata', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], { maxBuffer: 20 * 1024 * 1024 }));
const resolved = new Set(metadata.resolve.nodes.map(node => node.id));
for (const pkg of metadata.packages.filter(pkg => resolved.has(pkg.id) && pkg.name !== 'folio')) {
  const dir = path.dirname(pkg.manifest_path);
  const names = (await fs.readdir(dir)).filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)(?:[-_.].*)?$/i.test(name));
  const texts = [];
  for (const name of names) if ((await fs.stat(path.join(dir, name))).isFile()) texts.push(await fs.readFile(path.join(dir, name), 'utf8'));
  entries.push(`${pkg.name} ${pkg.version} (Rust crate)\nLicense: ${pkg.license || 'See crate source'}\nSource: ${pkg.repository || `https://crates.io/crates/${pkg.name}/${pkg.version}`}\n${texts.join('\n') || 'See the crate source for the complete license notice.'}`);
}
await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), `Folio includes third-party software. This inventory includes Windows Rust dependencies and JavaScript packages, including build/development tools. Microsoft Edge WebView2 is an operating-system runtime, installed and licensed separately by Microsoft; Electron is not bundled. The lockfiles identify exact dependency versions.\n\n${entries.join('\n\n' + '='.repeat(72) + '\n\n')}`);
console.log(`Recorded ${entries.length} package licenses.`);
