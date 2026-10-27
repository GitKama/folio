import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html>', { url: 'https://folio.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { buildTeamsClipboard, MAX_TEAMS_BYTES } = await import('../src/teams-export.js');
const doc = value => new JSDOM(value.html).window.document;

test('Teams receives semantic formatting, not literal Markdown shortcuts', () => {
  const out = buildTeamsClipboard('# Heading\n\n**Bold** *italic* ~~gone~~ `a < b` [Link](https://example.com/a?q=1&b=2)\n\n> A quote\n\n#### Small heading');
  const html = doc(out);
  assert.equal(html.querySelector('h1').textContent, 'Heading');
  assert.equal(html.querySelector('strong').textContent, 'Heading');
  assert.equal(html.querySelector('em').textContent, 'italic');
  assert.equal(html.querySelector('s').textContent, 'gone');
  assert.equal(html.querySelector('code').textContent, 'a < b');
  assert.equal(html.querySelector('a').href, 'https://example.com/a?q=1&b=2');
  assert.match(out.text, /Link \(https:\/\/example.com/);
  assert.match(out.text, /> A quote/);
  assert.doesNotMatch(out.text, /\*\*|####/);
  assert.equal(html.querySelector('h4'), null);
});

test('ordered, nested and task lists retain structure and readable plain text', () => {
  const out = buildTeamsClipboard('3. Three\n4. Four\n   - Nested **bold**\n\n- [x] Done\n- [ ] Pending');
  const html = doc(out);
  assert.equal(html.querySelector('ol').getAttribute('start'), '3');
  assert.ok(html.querySelector('ol li ul li strong'));
  assert.equal(html.querySelector('input'), null);
  assert.match(out.text, /3\. Three/);
  assert.match(out.text, /4\. Four/);
  assert.match(out.text, /☑\s+Done/);
  assert.match(out.text, /☐\s+Pending/);
});

test('tables use labeled rows without losing empty cells, Unicode or links', () => {
  const out = buildTeamsClipboard('| Name | Status | Link |\n|---|---|---|\n| Café 你好 | **Ready** | [Open](https://example.com) |\n| Empty | | Last |');
  assert.equal(doc(out).querySelector('table'), null);
  assert.match(out.text, /Row 1\nName: Café 你好\nStatus: Ready\nLink: Open/);
  assert.match(out.text, /Row 2\nName: Empty\nStatus: \nLink: Last/);
  assert.ok(out.notes.some(n => n.includes('Tables')));
});

test('spanning and nested HTML tables retain all cell contents with span information', () => {
  const out = buildTeamsClipboard('<table><caption>Report</caption><tr><td colspan="2">Wide</td></tr><tr><td>Left</td><td><table><tr><td>Nested</td></tr></table></td></tr></table>');
  assert.match(out.text, /Report/);
  assert.match(out.text, /spans 2 columns, 1 rows/);
  assert.match(out.text, /Left/);
  assert.match(out.text, /Nested/);
  assert.equal(doc(out).querySelector('table'), null);
});

test('code preserves whitespace, literal Markdown, backticks and unsafe-looking text', () => {
  const source = '  **literal**\n\n\n\t<script>alert(1)</script>\n```\n';
  const out = buildTeamsClipboard('````js\n' + source + '````');
  assert.equal(doc(out).querySelector('pre').textContent, source);
  assert.ok(out.text.startsWith('  **literal**'));
  assert.match(out.text, /\n\n\n\t<script>/);
  assert.equal(doc(out).querySelector('script'), null);
  assert.doesNotMatch(out.html, /class=|style=/);
});

test('math, diagrams, folded callouts and footnotes preserve meaningful content once', () => {
  const out = buildTeamsClipboard('$x^2$\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n> [!note]- Hidden heading\n> Hidden **body**\n\nReference[^n].\n\n[^n]: Footnote body.');
  assert.match(out.text, /x\^2/);
  assert.equal(out.text.match(/x\^2/g).length, 1);
  assert.match(out.text, /A --> B/);
  assert.match(out.text, /Hidden heading/);
  assert.match(out.text, /Hidden body/);
  assert.match(out.text, /Footnote body/);
  assert.doesNotMatch(out.html, /<svg|<math|<details|katex|footnote-backref/);
  assert.ok(out.notes.some(n => n.startsWith('Math')));
  assert.ok(out.notes.some(n => n.startsWith('Diagrams')));
});

test('images and local links do not expose local paths or load remote content', () => {
  const out = buildTeamsClipboard('![Public](https://example.com/image.png)\n\n![Local](private/image.png)\n\n[Private](private/note.md) [Anchor](#secret) [Mail](mailto:test@example.com)');
  assert.equal(doc(out).querySelector('img'), null);
  assert.match(out.text, /\[Image: Public\] \(https:\/\/example.com\/image.png\)/);
  assert.match(out.text, /\[Image: Local\]/);
  assert.doesNotMatch(out.html + out.text, /private\/|#secret/);
  assert.equal(doc(out).querySelectorAll('a').length, 2);
});

test('raw HTML is rebuilt from a narrow allowlist with no source attributes or executable links', () => {
  const out = buildTeamsClipboard('<div class="code-block" style="color:red" id="export-teams">Safe <b onclick="alert(1)">bold</b><img src="x" onerror="alert(1)" alt="label"><a href="javascript:alert(1)">bad</a><a href="https://user:password@example.com">secret URL</a><svg><title>Drawing</title></svg></div>');
  assert.doesNotMatch(out.html, /onclick|onerror|javascript:|password|class=|style=|id=|<img|<svg/);
  assert.match(out.text, /Safe bold/);
  assert.match(out.text, /bad/);
  assert.match(out.text, /secret URL/);
});

test('chosen dialect and line breaks are honored; metadata omission is explicit', () => {
  const markdown = '---\ntitle: Hidden metadata\n---\n\n~~strike~~\nnext';
  const broad = buildTeamsClipboard(markdown, { breaks: true });
  assert.ok(doc(broad).querySelector('s'));
  assert.ok(doc(broad).querySelector('br'));
  assert.doesNotMatch(broad.text, /Hidden metadata/);
  assert.ok(broad.notes.some(n => n.includes('front matter')));
  const common = buildTeamsClipboard('~~strike~~', { profile: 'commonmark' });
  assert.equal(common.text, '~~strike~~');
  assert.equal(doc(common).querySelector('s'), null);
});

test('empty and oversized documents fail without truncation, with Unicode byte accounting', () => {
  assert.throws(() => buildTeamsClipboard(''), /no message text/);
  assert.throws(() => buildTeamsClipboard('a'.repeat(2_000_001)), /too large/);
  assert.throws(() => buildTeamsClipboard('é'.repeat(45_000)), /80 KB/);
  assert.throws(() => buildTeamsClipboard('你'.repeat(28_000)), /80 KB/);
  const out = buildTeamsClipboard('Hello 👋');
  assert.ok(out.bytes <= MAX_TEAMS_BYTES);
  assert.equal(out.text, 'Hello 👋');
});
