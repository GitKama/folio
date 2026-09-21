import fs from 'node:fs/promises';
import path from 'node:path';
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
await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), `Folio includes third-party software. This inventory also includes development tools supplied in the lockfile. Electron and Chromium include additional notices in the installed application.\n\n${entries.join('\n\n' + '='.repeat(72) + '\n\n')}`);
console.log(`Recorded ${entries.length} package licenses.`);
