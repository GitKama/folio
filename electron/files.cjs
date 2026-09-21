const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const markdownExtensions = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx', '.qmd', '.rmd', '.txt']);
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function isNetworkPath(candidate) { return /^\\\\|^\/\//.test(candidate); }
async function readDocument(candidate) {
  if (typeof candidate !== 'string' || !candidate || isNetworkPath(candidate)) throw new Error('Choose a Markdown file on a local drive.');
  const real = await fs.realpath(candidate);
  if (!markdownExtensions.has(path.extname(real).toLowerCase())) throw new Error('This file type is not a Markdown or text document.');
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error('Choose a file, rather than a folder.');
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('This document is larger than the 12 MB viewing limit.');
  const bytes = await fs.readFile(real);
  let content, encoding = 'UTF-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (bytes.length % 2) throw new Error('This UTF-16 file is incomplete.');
    content = bytes.subarray(2).toString('utf16le'); encoding = 'UTF-16 LE';
  }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const copy = Buffer.from(bytes.subarray(2));
    if (copy.length % 2) throw new Error('This UTF-16 file is incomplete.');
    content = copy.swap16().toString('utf16le'); encoding = 'UTF-16 BE';
  } else {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { content = new TextDecoder('windows-1252').decode(bytes); encoding = 'Windows-1252 (fallback)'; }
  }
  if (content.includes('\u0000')) throw new Error('This appears to be a binary file, not readable Markdown.');
  return { path: real, name: path.basename(real), content, modified: stat.mtimeMs, encoding,
    bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    eol: content.match(/\r\n|\r|\n/)?.[0] || '\n', revision: digest(bytes) };
}

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalizeNewlines = text => text.replace(/\r\n|\r/g, '\n');

function encodeDocument(content, format = {}) {
  if (typeof content !== 'string' || content.includes('\0')) throw new Error('Invalid Markdown text.');
  // Preserve untouched mixed line endings; textarea edits use the original first line ending.
  const text = content === format.content ? content : normalizeNewlines(content).replace(/\n/g, format.eol || '\n');
  let bytes;
  if (format.encoding === 'UTF-16 LE' || format.encoding === 'UTF-16 BE') {
    const body = Buffer.from(text, 'utf16le');
    bytes = format.encoding === 'UTF-16 BE' ? Buffer.concat([Buffer.from([0xfe, 0xff]), body.swap16()]) : Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  } else if (format.encoding?.startsWith('Windows-1252')) {
    const decoder = new TextDecoder('windows-1252');
    const map = new Map(Array.from({ length: 256 }, (_, n) => [decoder.decode(Uint8Array.of(n)), n]));
    bytes = Buffer.from(Array.from(text, char => {
      if (!map.has(char)) throw new Error('This character cannot be saved as Windows-1252. Use Save As to create a UTF-8 copy.');
      return map.get(char);
    }));
  } else bytes = Buffer.concat([format.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('This document exceeds the 12 MB saving limit.');
  return bytes;
}

async function getRevision(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw new Error('The destination is not a supported document.');
    return digest(await fs.readFile(candidate));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeDocument(candidate, content, { expectedRevision = null, format = {} } = {}) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || isNetworkPath(candidate)) throw new Error('Choose a Markdown file on a local drive.');
  if (!markdownExtensions.has(path.extname(candidate).toLowerCase())) throw new Error('Choose a Markdown or text filename.');
  // Resolve before writing so a symlink is not replaced by a different kind of file.
  const real = await fs.realpath(candidate).catch(error => { if (error.code === 'ENOENT') return path.join(path.dirname(candidate), path.basename(candidate)); throw error; });
  const bytes = encodeDocument(content, format);
  const assertRevision = async () => {
    if (await getRevision(real) !== expectedRevision) throw new Error('The file changed on disk. Your edits are still open; save again to review the conflict or use Save As.');
  };
  await assertRevision();
  const temp = path.join(path.dirname(real), `.${path.basename(real)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let created = false;
  try {
    const handle = await fs.open(temp, 'wx'); created = true;
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await assertRevision();
    // Same-directory rename avoids truncating the original if writing fails.
    await fs.rename(temp, real);
    created = false;
    return readDocument(real);
  } finally { if (created) await fs.unlink(temp).catch(() => {}); }
}

async function resolveAsset(root, resourcePath) {
  if (typeof resourcePath !== 'string' || resourcePath.includes('\0') || isNetworkPath(resourcePath)) throw new Error('Invalid image path.');
  const normalized = resourcePath.replace(/\\/g, '/');
  if (/^[a-z]:|^[a-z][a-z0-9+.-]*:/i.test(normalized)) throw new Error('Images must be relative to the document folder.');
  const candidate = path.resolve(root, `.${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
  if (!isWithin(root, candidate)) throw new Error('The image is outside the document folder.');
  const real = await fs.realpath(candidate);
  if (!isWithin(await fs.realpath(root), real)) throw new Error('The image is outside the document folder.');
  const mime = imageTypes[path.extname(real).toLowerCase()];
  if (!mime) throw new Error('Only image files can be embedded.');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) throw new Error('The image exceeds the 20 MB limit.');
  return { bytes: await fs.readFile(real), mime };
}

module.exports = { readDocument, writeDocument, getRevision, encodeDocument, normalizeNewlines, resolveAsset, isWithin, isNetworkPath, markdownExtensions, MAX_DOCUMENT_BYTES, MAX_ASSET_BYTES };
