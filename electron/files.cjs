const fs = require('node:fs/promises');
const path = require('node:path');

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
  return { path: real, name: path.basename(real), content, modified: stat.mtimeMs, encoding };
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

module.exports = { readDocument, resolveAsset, isWithin, isNetworkPath, markdownExtensions, MAX_DOCUMENT_BYTES, MAX_ASSET_BYTES };
