const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDocument, writeDocument, getRevision, encodeDocument, MAX_DOCUMENT_BYTES } = require('../electron/files.cjs');
let root;
test.before(async () => {
  const parent = path.resolve(__dirname, '../test-results/edit-files');
  await fs.mkdir(parent, { recursive: true });
  root = await fs.mkdtemp(path.join(parent, 'run-'));
});

test('Edits preserve UTF-8 BOM and UTF-16 byte order, BOM, CRLF and Unicode', async () => {
  for (const format of [{ encoding: 'UTF-8', bom: true }, { encoding: 'UTF-16 LE' }, { encoding: 'UTF-16 BE' }]) {
    const name = path.join(root, `${format.encoding}.md`);
    await fs.writeFile(name, encodeDocument('# Original\nCafé 日本語\n', { ...format, eol: '\r\n' }));
    const original = await readDocument(name);
    const saved = await writeDocument(name, '# Edited\nCafé 日本語 😀\n', { expectedRevision: original.revision, format: original });
    assert.equal(saved.content, '# Edited\r\nCafé 日本語 😀\r\n');
    assert.equal(saved.encoding, original.encoding);
    assert.equal(saved.bom, original.bom);
    assert.notEqual(saved.revision, original.revision);
  }
});

test('Unedited mixed line endings round trip exactly', async () => {
  const name = path.join(root, 'mixed.md');
  const bytes = Buffer.from('# Mixed\r\nFirst\nSecond\rThird');
  await fs.writeFile(name, bytes);
  const original = await readDocument(name);
  await writeDocument(name, original.content, { expectedRevision: original.revision, format: original });
  assert.deepEqual(await fs.readFile(name), bytes);
});

test('Legacy encoding is preserved; unrepresentable characters never corrupt the original', async () => {
  const name = path.join(root, 'legacy.md');
  const bytes = Buffer.from([0x23, 0x20, 0xe9, 0x20, 0x80]);
  await fs.writeFile(name, bytes);
  const original = await readDocument(name);
  await assert.rejects(writeDocument(name, '# 日本語', { expectedRevision: original.revision, format: original }), /Save As.*UTF-8/);
  assert.deepEqual(await fs.readFile(name), bytes);
  const saved = await writeDocument(name, '# Café €', { expectedRevision: original.revision, format: original });
  assert.match(saved.encoding, /1252/);
  assert.equal(saved.content, '# Café €');
});

test('Conflict and deleted-file checks preserve the other writer and do not recreate stale files', async () => {
  const name = path.join(root, 'conflict.md');
  await fs.writeFile(name, '# Original');
  const doc = await readDocument(name);
  await fs.writeFile(name, '# External');
  await assert.rejects(writeDocument(name, '# Mine', { expectedRevision: doc.revision, format: doc }), /changed on disk/);
  assert.equal(await fs.readFile(name, 'utf8'), '# External');
  await fs.unlink(name);
  await assert.rejects(writeDocument(name, '# Mine', { expectedRevision: doc.revision, format: doc }), /changed on disk/);
  assert.equal(await getRevision(name), null);
});

test('New saves enforce local Markdown destinations and preserve existing files by default', async () => {
  const name = path.join(root, 'new.md');
  await writeDocument(name, '# New');
  await assert.rejects(writeDocument(name, '# Overwrite'), /changed on disk/);
  await assert.rejects(writeDocument(path.join(root, 'new.html'), '# Bad'), /filename/);
  await assert.rejects(writeDocument('relative.md', '# Bad'), /local drive/);
  await assert.rejects(writeDocument('\\\\invalid-host\\share\\note.md', '# Bad'), /local drive/);
  assert.equal(await fs.readFile(name, 'utf8'), '# New');
});

test('Failed writes and size checks leave originals and directories intact', async () => {
  const name = path.join(root, 'size.md');
  await fs.writeFile(name, '# Keep');
  const original = await readDocument(name);
  await assert.rejects(writeDocument(name, 'a'.repeat(MAX_DOCUMENT_BYTES + 1), { expectedRevision: original.revision }), /12 MB/);
  await assert.rejects(writeDocument(path.join(root, 'missing', 'file.md'), '# Error'), /ENOENT/);
  assert.equal(await fs.readFile(name, 'utf8'), '# Keep');
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});
