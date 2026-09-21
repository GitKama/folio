import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://folio.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { renderMarkdown, profiles } = await import('../src/engine.js');
const documentFor = html => new JSDOM(html).window.document;

test('profile catalog is complete and CommonMark preserves unsupported syntax', () => {
  assert.deepEqual(profiles.map(profile => profile.id), ['auto', 'commonmark', 'gfm', 'extended', 'obsidian']);
  const source = '| A | B |\n|---|---|\n| 1 | 2 |\n\n~~strike~~ ==mark== [[Note]] $x^2$';
  const basic = renderMarkdown(source, { profile: 'commonmark' });
  assert.doesNotMatch(basic.html, /<table|<del|<mark|class="wiki|class="katex/);
  assert.match(basic.html, /\[\[Note\]\]/);
  const gfm = renderMarkdown(source, { profile: 'gfm' });
  assert.match(gfm.html, /<table/);
  assert.match(gfm.html, /<s>strike<\/s>/);
  assert.doesNotMatch(gfm.html, /<mark|class="wiki/);
  assert.match(renderMarkdown(source).html, /class="wiki-link"/);
});

test('GFM tables, disabled tasks, links, footnotes and emoji render together', () => {
  const output = renderMarkdown('# Read me :rocket:\n\n| A | B |\n|:---|---:|\n| one | two |\n\n- [x] Done\n- [ ] Open\n\nhttps://example.com ~~old~~ [^note]\n\n[^note]: A footnote.', { profile: 'gfm' });
  const document = documentFor(output.html);
  assert.equal(document.querySelectorAll('table tbody tr').length, 1);
  assert.equal(document.querySelectorAll('input[type="checkbox"][disabled]').length, 2);
  assert.equal(document.querySelectorAll('input[checked]').length, 1);
  assert.equal(document.querySelector('a[href="https://example.com"]').textContent, 'https://example.com');
  assert.match(document.querySelector('h1').textContent, /🚀/);
  assert.ok(document.querySelector('.footnotes'));
  assert.deepEqual(output.warnings, []);
});

test('duplicate headings and explicit IDs produce usable TOC anchors', () => {
  const output = renderMarkdown('# Café **title**\n\n## Café title\n\n## Café title-1\n\n## Café title\n\n### Named {#custom}');
  assert.deepEqual(output.headings.map(heading => heading.id), ['café-title', 'café-title-1', 'café-title-1-1', 'café-title-2', 'custom']);
  const document = documentFor(output.html);
  for (const heading of output.headings) assert.equal(document.getElementById(heading.id).textContent.trim(), heading.text);
  const reserved = renderMarkdown('# location\n\n# attributes\n\n# constructor\n\n[Jump](#location) [[#constructor]]');
  const reservedDoc = documentFor(reserved.html);
  for (const heading of reserved.headings) assert.ok(reservedDoc.getElementById(heading.id), `reserved heading ${heading.text} has a real anchor`);
  assert.equal(reservedDoc.querySelector('a').getAttribute('href'), `#${reserved.headings[0].id}`);
  assert.equal(reservedDoc.querySelector('a.wiki-link').getAttribute('href'), `#${reserved.headings[2].id}`);
});

test('YAML metadata is parsed without losing invalid or non-mapping source', () => {
  const output = renderMarkdown('---\ntitle: "A sample"\ntags: [one, two]\n---\n# Body');
  assert.deepEqual(output.metadata, { title: 'A sample', tags: ['one', 'two'] });
  assert.doesNotMatch(output.html, /tags:/);
  assert.equal(output.headings[0].text, 'Body');
  const invalid = renderMarkdown('---\ntitle: [broken\n---\n# Body');
  assert.ok(invalid.warnings.some(warning => warning.code === 'frontmatter-invalid'));
  assert.match(invalid.html, /title: \[broken/);
  const scalar = renderMarkdown('---\nJust text\n---\n# Body');
  assert.ok(scalar.warnings.some(warning => warning.code === 'frontmatter-shape'));
  assert.match(scalar.html, /Just text/);
  assert.deepEqual(renderMarkdown('---\ntitle: Source\n---', { profile: 'commonmark' }).metadata, {});
  const cyclic = renderMarkdown('---\na: &cycle\n  self: *cycle\n---\n# Body');
  assert.deepEqual(cyclic.metadata, {});
  assert.ok(cyclic.warnings.some(warning => warning.code === 'frontmatter-invalid'));
  assert.doesNotThrow(() => JSON.stringify(cyclic));
  assert.match(cyclic.html, /self:/);
});

test('extended math includes dollars, brackets, environments and fenced formulas', () => {
  const output = renderMarkdown('Inline $x^2$ and \\(y+1\\).\n\n$$\\frac{1}{2}$$\n\n\\[a+b\\]\n\n```math\nE = mc^2\n```\n\n\\begin{align} a &= b \\end{align}');
  const document = documentFor(output.html);
  assert.equal(document.querySelectorAll('.katex').length, 6);
  assert.ok(document.querySelector('.katex [style]'), 'generated KaTeX layout styles remain');
  assert.ok(document.querySelector('math'), 'accessible MathML remains');
  assert.doesNotMatch(output.html, /katex-error/);
  assert.equal(documentFor(renderMarkdown('$`x^2`$').html).querySelectorAll('.katex').length, 1);
  assert.equal(documentFor(renderMarkdown('$x$\n\n```math\ny\n```', { profile: 'gfm' }).html).querySelectorAll('.katex').length, 2);
  assert.equal(documentFor(renderMarkdown('Before $$x$$ after.').html).querySelectorAll('p').length, 1);
});

test('invalid TeX remains visible and reports a compatibility warning', () => {
  const result = renderMarkdown('$\\notARealCommand{x}$');
  assert.ok(result.warnings.some(warning => warning.code === 'math-error'));
  assert.match(result.html, /notARealCommand/);
});

test('diagram source is escaped and unsupported diagram languages remain code', () => {
  const output = renderMarkdown('```mermaid\ngraph TD\n A["<img src=x onerror=alert(1)>"] --> B\n```\n\n```dot\ndigraph { A -> B }\n```\n\n```plantuml\nAlice -> Bob\n```');
  const document = documentFor(output.html);
  assert.equal(document.querySelectorAll('pre.mermaid').length, 1);
  assert.equal(document.querySelectorAll('pre.graphviz').length, 1);
  assert.match(document.querySelector('pre.mermaid').textContent, /<img src=x onerror/);
  assert.equal(document.querySelectorAll('img').length, 0);
  assert.match(document.querySelector('.language-plantuml').textContent, /Alice -> Bob/);
  assert.ok(output.warnings.some(warning => warning.code === 'diagram-plantuml'));
});

test('alerts and nested foldable callouts retain body paragraphs and lists', () => {
  const result = renderMarkdown('> [!NOTE]\n> First **body**.\n>\n> - One\n> - Two\n\n> [!warning]- Collapsed *title*\n> Hidden body.\n>\n> > [!tip]+ Inner\n> > Nested body.');
  const document = documentFor(result.html);
  assert.equal(document.querySelectorAll('.callout').length, 3);
  assert.equal(document.querySelector('.callout-note .callout-title').textContent, 'Note');
  assert.equal(document.querySelector('.callout-note strong').textContent, 'body');
  assert.equal(document.querySelectorAll('.callout-note li').length, 2);
  assert.equal(document.querySelector('details.callout-warning').hasAttribute('open'), false);
  assert.equal(document.querySelector('details.callout-tip').hasAttribute('open'), true);
  assert.match(document.querySelector('.callout-warning .callout-content').textContent, /Hidden body/);
  assert.match(document.querySelector('.callout-warning .callout-tip').textContent, /Nested body/);
});

test('callouts and admonitions share document footnotes without duplicating lists or references', () => {
  const source = 'An earlier reference[^first].\n\n> [!TIP] Title with a reference[^title]\n> Body with another reference[^body].\n\n> [!NOTE]+ Nested case\n> > [!WARNING] Inner title\n> > Nested text.\n\n!!! note "An admonition title"\n    Ordinary body.\n\n[^first]: First note.\n[^title]: Title note.\n[^body]: Body note.';
  const result = renderMarkdown(source);
  const document = documentFor(result.html);
  assert.equal(document.querySelectorAll('.footnotes').length, 1);
  assert.equal(document.querySelectorAll('.callout-title .footnotes, .admonition-title .footnotes').length, 0);
  assert.equal(document.querySelectorAll('.footnote-ref').length, 3);
  assert.equal(document.querySelectorAll('.footnote-backref').length, 3);
  assert.equal(document.querySelectorAll('.footnotes li').length, 3);
  assert.equal(document.querySelector('.callout-tip .callout-title .footnote-ref').textContent, '[2]');
  assert.equal(document.querySelector('.callout-tip .callout-content .footnote-ref').textContent, '[3]');
  assert.match(document.querySelector('.footnotes li:nth-child(2)').textContent, /Title note/);
  assert.deepEqual(result.warnings, []);
});

test('colon and indented admonitions handle nesting and Markdown content', () => {
  const result = renderMarkdown('::: warning "Careful"\nBody **strong**.\n\n::: note Inside\nNested.\n:::\n:::\n\n!!! tip "Try this"\n    A body.\n\n    - List item\n\nAfter.\n\n???+ note "Expandable"\n    Details body.');
  const document = documentFor(result.html);
  assert.equal(document.querySelectorAll('.admonition').length, 4);
  assert.equal(document.querySelector('.admonition-warning .admonition-title').textContent, 'Careful');
  assert.equal(document.querySelector('.admonition-warning strong').textContent, 'strong');
  assert.equal(document.querySelector('.admonition-tip li').textContent, 'List item');
  assert.ok(document.querySelector('details.admonition[open]'));
  assert.match(result.html, /<p>After\.<\/p>/);
  assert.equal(documentFor(renderMarkdown('!!! tip\n\tTabbed body.').html).querySelector('.admonition-content').textContent.trim(), 'Tabbed body.');
});

test('wiki target-label convention, block references and image dimensions are explicit', () => {
  const output = renderMarkdown('[[A Note|Readable name]] [[#A heading]]\n\n![[assets/photo.png|320x200]] ![[Another Note#Section]]\n\nBlock text. ^block-one', { profile: 'obsidian' });
  const document = documentFor(output.html);
  assert.equal(document.querySelector('a[data-wikilink="A Note"]').textContent, 'Readable name');
  assert.equal(document.querySelector('a[data-wikilink="#A heading"]').getAttribute('href'), '#a-heading');
  const image = document.querySelector('img.wiki-embed');
  assert.equal(image.getAttribute('width'), '320');
  assert.equal(image.getAttribute('height'), '200');
  assert.ok(output.warnings.some(warning => warning.code === 'note-embed'));
  assert.equal(document.getElementById('block-one').textContent.trim(), 'Block text.');
});

test('extended typography and CriticMarkup avoid code-span interpretation', () => {
  const result = renderMarkdown('==highlight== H~2~O x^2^ {++added++} {--gone--} {~~old~>new~~} {>>comment<<}\n\n`==literal== [[Note]] {++source++}`\n\nTerm\n: Definition\n\n*[HTML]: Hyper Text Markup Language\n\nHTML works.');
  const document = documentFor(result.html);
  assert.ok(document.querySelector('mark'));
  assert.equal(document.querySelector('sub').textContent, '2');
  assert.equal(document.querySelector('sup').textContent, '2');
  assert.equal(document.querySelectorAll('ins.critic-add').length, 2);
  assert.equal(document.querySelector('code').textContent, '==literal== [[Note]] {++source++}');
  assert.equal(document.querySelector('dt').textContent, 'Term');
  assert.equal(document.querySelector('abbr').getAttribute('title'), 'Hyper Text Markup Language');
});

test('unsafe HTML, URLs, CSS and attribute extensions cannot introduce execution', () => {
  const source = `<script>globalThis.compromised=true</script>\n<style>body{display:none}</style>\n<iframe src="https://evil.test"></iframe>\n<form action="https://evil.test"><button>send</button></form>\n\n<span style="position:fixed;inset:0" onclick="alert(1)">visible</span>\n\n<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">bad</a> [link](javascript:alert(1)) [[javascript:alert(1)]]\n\n# Heading {onclick="alert(1)" style="position:fixed"}\n\n<svg><a href="javascript:alert(1)"><text>svg</text></a><script>alert(1)</script></svg>\n\n$\\href{javascript:alert(1)}{click}$`;
  const output = renderMarkdown(source);
  const document = documentFor(output.html);
  assert.equal(document.querySelectorAll('script,style,iframe,form,button,object,embed').length, 0);
  assert.equal(document.querySelectorAll('[onclick],[onerror],[onload],[srcdoc]').length, 0);
  for (const element of document.querySelectorAll('[href],[src]')) {
    assert.doesNotMatch(element.getAttribute('href') || element.getAttribute('src'), /^\s*(javascript|vbscript):/i);
  }
  assert.equal(document.querySelector('span')?.getAttribute('style'), null);
  assert.ok(output.warnings.some(warning => warning.code === 'sanitized-html'));
  assert.match(document.body.textContent, /visible/);
});

test('benign inline HTML preserves surrounding emphasis and sanitized attributes', () => {
  const result = renderMarkdown('Before <span title="explanation" style="color:red">inside **bold**</span> after.\n\n<details>\n<summary>More</summary>\n<p>HTML body</p>\n</details>');
  const document = documentFor(result.html);
  assert.equal(document.querySelector('span strong').textContent, 'bold');
  assert.equal(document.querySelector('span').getAttribute('title'), 'explanation');
  assert.equal(document.querySelector('span').style.color, 'red');
  assert.equal(document.querySelector('details p').textContent, 'HTML body');
});

test('static source CSS supports README formatting while stripping overlay and URL attacks', () => {
  const source = '<p style="text-align: center; color: #123456; background-color: rgb(240, 240, 240); font-weight: 600; font-style: italic; text-decoration: underline; vertical-align: middle; width: 80%; max-width: 640px; height: auto">Formatted text</p>\n\n<span style="color: rebeccapurple; position: fixed; inset: 0; z-index: 99999; display: block; background-image: url(https://evil.test/pixel); width: 99999999px; --payload: red; left: 0">Safe remainder</span>\n\n<span style="color: var(--payload); background-color: u\\72l(https://evil.test); text-align: expression(alert(1)); width: calc(100vw); height: -100px; font-weight: 900 !important; co/**/lor: red">Blocked values</span>\n\n<style>body { display: none }</style>';
  const result = renderMarkdown(source);
  const document = documentFor(result.html);
  const paragraph = document.querySelector('p');
  assert.equal(paragraph.style.textAlign, 'center');
  assert.equal(paragraph.style.color, 'rgb(18, 52, 86)');
  assert.equal(paragraph.style.fontWeight, '600');
  assert.equal(paragraph.style.maxWidth, '640px');
  const spans = document.querySelectorAll('span');
  assert.equal(spans[0].style.color, 'rebeccapurple');
  assert.equal(spans[0].style.position, '');
  assert.equal(spans[0].style.backgroundImage, '');
  assert.equal(spans[0].style.width, '');
  assert.equal(spans[1].hasAttribute('style'), false);
  assert.equal(document.querySelectorAll('style').length, 0);
  assert.ok(result.warnings.some(warning => warning.code === 'sanitized-html'));
  assert.deepEqual(renderMarkdown('<span style="color:red;text-align:center">safe</span>').warnings, []);
});

test('document HTML and attribute extensions cannot borrow any current application UI class or ID', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const classes = [...new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map(match => match[1]))];
  const ids = [...new Set(['app', ...[...app.matchAll(/\bid="([A-Za-z_][A-Za-z0-9_-]*)"/g)].map(match => match[1])])];
  const source = `<div class="${classes.join(' ')} legitimate-document-class">Readable</div>\n\n` +
    ids.map(id => `<div id="${id}">${id}</div>`).join('\n') +
    '\n\n# Document heading {.drop-overlay .uppercase-html #source-content}\n\n[Jump](#source-content)\n\n<div class="drop-overlay toast sidebar" style="color:red">Inline styles remain scoped</div>';
  const result = renderMarkdown(source);
  const document = documentFor(result.html);
  for (const cls of classes) assert.equal(document.getElementsByClassName(cls).length, 0, `UI class .${cls} is reserved`);
  for (const id of ids) assert.equal(document.getElementById(id), null, `UI ID #${id} is reserved`);
  assert.equal(document.querySelector('.legitimate-document-class').textContent, 'Readable');
  assert.equal(document.querySelector('h1.uppercase-html').id, 'section-source-content');
  assert.equal(result.headings[0].id, 'section-source-content');
  assert.equal(document.querySelector('a').getAttribute('href'), '#section-source-content');
  assert.ok(result.warnings.some(warning => warning.code === 'document-scope'));
  assert.deepEqual(renderMarkdown('<div class="uppercase-html">Ordinary content</div>').warnings, []);
  const dialog = documentFor(renderMarkdown('<dialog open>Untrusted dialog body</dialog>').html);
  assert.equal(dialog.querySelector('dialog'), null);
  assert.match(dialog.body.textContent, /Untrusted dialog body/);
});

test('standard uppercase HTML renders normally and explicit IDs keep their case', () => {
  const result = renderMarkdown('<DIV><TABLE><TR><TD>Cell</TD></TR></TABLE></DIV>\n\nUppercase <BR> line.\n\n# Heading {#Case-Sensitive}');
  const document = documentFor(result.html);
  assert.equal(document.querySelector('div table td').textContent, 'Cell');
  assert.ok(document.querySelector('p br'));
  assert.equal(document.getElementById('Case-Sensitive').textContent, 'Heading');
  assert.ok(!result.warnings.some(warning => warning.code === 'mdx-runtime'));
});

test('MDX and publishing directives are visible and reported without execution', () => {
  const result = renderMarkdown('import Widget from "./widget"\n\n<Widget enabled={true} />\n\nA citation [@doe2024].\n\n```{python}\nprint("never run")\n```\n\n::: {note}\nA directive.\n:::');
  assert.ok(result.warnings.some(warning => warning.code === 'mdx-runtime'));
  assert.ok(result.warnings.some(warning => warning.code === 'pandoc-citations'));
  assert.ok(result.warnings.some(warning => warning.code === 'runtime-directive'));
  assert.match(documentFor(result.html).body.textContent, /<Widget enabled=\{true\} \/>/);
  assert.match(result.html, /never run/);
});

test('size limits give honest source fallbacks and preserve original statistics', () => {
  const source = 'word '.repeat(400_001);
  const result = renderMarkdown(source);
  assert.ok(result.warnings.some(warning => warning.code === 'document-size'));
  assert.equal(result.stats.characters, source.length);
  assert.equal(result.stats.words, 400_001);
  assert.match(result.html, /source-fallback/);
  assert.ok(result.html.length < 250_000);
  const diagram = renderMarkdown('```mermaid\n' + 'a'.repeat(60_001) + '\n```');
  assert.ok(diagram.warnings.some(warning => warning.code === 'diagram-size'));
  assert.doesNotMatch(diagram.html, /class="mermaid"/);
});

test('empty and Unicode documents render with stable statistics and line-break options', () => {
  assert.deepEqual(renderMarkdown('').stats, { words: 0, characters: 0, readingMinutes: 0 });
  assert.equal(renderMarkdown('你好 café').stats.words, 2);
  assert.match(renderMarkdown('one\ntwo', { breaks: true }).html, /one<br>\ntwo/);
  assert.doesNotMatch(renderMarkdown('one\ntwo', { breaks: false }).html, /<br/);
});
