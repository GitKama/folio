const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDocument, resolveAsset, isWithin, MAX_DOCUMENT_BYTES, MAX_ASSET_BYTES } = require('../electron/files.cjs');

const resultsRoot = path.resolve(__dirname, '..', 'test-results', 'files');
let suiteRoot;
test.before(async () => {
  await fs.mkdir(resultsRoot, { recursive: true });
  suiteRoot = await fs.mkdtemp(path.join(resultsRoot, 'run-'));
});

async function write(name, bytes) {
  const filename = path.join(suiteRoot, name);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes);
  return filename;
}

test('Reads UTF-8 BOM, UTF-16 LE and UTF-16 BE without losing Unicode', async () => {
  const source = '# Café 日本語\r\n\nHello!';
  const utf8 = await write('encoding-utf8.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]));
  const utf16le = Buffer.from(source, 'utf16le');
  const little = await write('encoding-le.markdown', Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le]));
  const big = await write('encoding-be.mdown', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16le).swap16()]));
  for (const filename of [utf8, little, big]) {
    const actual = await readDocument(filename);
    assert.equal(actual.content, source);
    assert.equal(actual.path, await fs.realpath(filename));
    assert.equal(actual.name, path.basename(filename));
    assert.equal(typeof actual.modified, 'number');
  }
});

test('Refuses binary, unsupported, directory and oversized documents', async () => {
  await assert.rejects(readDocument(await write('binary.md', Buffer.from([0, 1, 2, 3]))), /binary/);
  await assert.rejects(readDocument(await write('application.html', '<h1>HTML is not a Markdown input file</h1>')), /file type/);
  const folder = path.join(suiteRoot, 'folder.md');
  await fs.mkdir(folder);
  await assert.rejects(readDocument(folder), /file.*folder/);
  const oversized = await write('oversized.md', '');
  const handle = await fs.open(oversized, 'r+');
  try { await handle.truncate(MAX_DOCUMENT_BYTES + 1); } finally { await handle.close(); }
  await assert.rejects(readDocument(oversized), /12 MB/);
});

test('Refuses incomplete UTF-16 BE before presenting a corrupted document', async () => {
  const incomplete = await write('incomplete.md', Buffer.from([0xfe, 0xff, 0x00]));
  await assert.rejects(readDocument(incomplete), /UTF-16.*incomplete/);
});

test('Refuses incomplete UTF-16 LE before presenting a corrupted document', async () => {
  const incomplete = await write('incomplete-le.md', Buffer.from([0xff, 0xfe, 0x41]));
  await assert.rejects(readDocument(incomplete), /UTF-16.*incomplete/);
});

test('Legacy Windows Markdown retains accents, smart quotes and euro signs', async () => {
  const candidate = await write('legacy-ansi.md', Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x75, 0x6f, 0x74, 0x65, 0x94, 0x20, 0x80]));
  const actual = await readDocument(candidate);
  assert.equal(actual.content, '# Café “quote” €');
  assert.match(actual.encoding, /1252/i);
});

test('UNC and network document paths are rejected before filesystem access', async () => {
  await assert.rejects(readDocument('\\\\invalid-folio-host.invalid\\share\\note.md'), /local drive/);
  await assert.rejects(readDocument('//invalid-folio-host.invalid/share/note.md'), /local drive/);
});

test('Local asset reads accept nested image files but reject other file types', async () => {
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  await write('assets/nested/image.svg', image);
  await write('assets/private.md', '# Not an image');
  const actual = await resolveAsset(suiteRoot, '/assets/nested/image.svg');
  assert.equal(actual.mime, 'image/svg+xml');
  assert.deepEqual(actual.bytes, image);
  await assert.rejects(resolveAsset(suiteRoot, '/assets/private.md'), /Only image files/);
});

test('Asset traversal, absolute drives, network paths and schemes are rejected', async () => {
  const root = path.join(suiteRoot, 'document-root');
  await fs.mkdir(root);
  await write('outside.png', Buffer.from([1, 2, 3]));
  for (const candidate of ['../outside.png', '..\\outside.png', '/../../outside.png']) {
    await assert.rejects(resolveAsset(root, candidate), /outside the document folder/);
  }
  for (const candidate of ['C:/outside.png', 'file:///C:/outside.png', 'https://example.com/pixel.png']) {
    await assert.rejects(resolveAsset(root, candidate), /relative to the document folder/);
  }
  await assert.rejects(resolveAsset(root, '//host/share/image.png'), /Invalid image path/);
  await assert.rejects(resolveAsset(root, '\\\\host\\share\\image.png'), /Invalid image path/);
  assert.equal(isWithin(root, `${root}-lookalike/file.png`), false);
});

test('A directory junction cannot escape the asset root', async (context) => {
  const root = path.join(suiteRoot, 'junction-root');
  const outside = path.join(suiteRoot, 'junction-outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'image.png'), Buffer.from([1, 2, 3]));
  try { await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return context.skip(`Filesystem cannot create a test junction: ${error.code}`); throw error; }
  await assert.rejects(resolveAsset(root, '/linked/image.png'), /outside the document folder/);
});

test('Oversized assets are rejected before reading their contents', async () => {
  const candidate = await write('large-image.png', '');
  const handle = await fs.open(candidate, 'r+');
  try { await handle.truncate(MAX_ASSET_BYTES + 1); } finally { await handle.close(); }
  await assert.rejects(resolveAsset(suiteRoot, '/large-image.png'), /20 MB/);
});
