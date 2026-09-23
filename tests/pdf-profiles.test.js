import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { preparePdfArticle, normalizePdfOptions } from '../src/pdf-profiles.js';
import { createRequire } from 'node:module';
const { pdfPrintOptions } = createRequire(import.meta.url)('../electron/pdf.cjs');
const article = html => new JSDOM(`<article>${html}</article>`).window.document.querySelector('article');
const table = '<table id="actions"><caption>Tasks</caption><thead><tr><th>Owner</th><th>Task</th><th>Due</th><th>Reference</th></tr></thead><tbody><tr><td>Ada</td><td><a href="#target">Check <code>x</code></a></td><td></td><td>01:22</td></tr></tbody></table>';

test('wide cards preserve labels, empty cells, rich values, captions and anchors', () => {
  const a = article(table); preparePdfArticle(a, { cards: true });
  assert.equal(a.querySelectorAll('table').length, 0);
  assert.equal(a.querySelector('#actions .pdf-caption').textContent, 'Tasks');
  assert.equal(a.querySelectorAll('dt').length, 4);
  assert.deepEqual([...a.querySelectorAll('dt')].map(n=>n.textContent), ['Owner','Due','Task','Reference']);
  assert.equal(a.querySelector('a').getAttribute('href'), '#target');
  assert.equal(a.querySelector('code').textContent, 'x');
  assert.equal(a.querySelectorAll('dd')[1].textContent, '');
});
test('table opt-out and spanning cells preserve the original table', () => {
  for (const [html, options] of [[table,{cards:false}], [table.replace('<td>Ada','<td colspan="2">Ada'),{cards:true}]]) {
    const a=article(html), before=a.innerHTML; preparePdfArticle(a,options); assert.equal(a.innerHTML,before);
  }
});
test('meeting promotion is opt-in and does not promote mixed or long paragraphs', () => {
  const html='<h1>Review</h1><p><strong>Summary</strong></p><p>Some <strong>emphasis</strong></p><p><strong>Action Items</strong></p><p><strong>'+ 'x'.repeat(91)+'</strong></p>';
  const original=article(html), clone=original.cloneNode(true); preparePdfArticle(clone,{meetings:true});
  assert.equal(clone.querySelectorAll('h2').length,2); assert.equal(clone.querySelector('.pdf-page-section').textContent,'Action Items');
  assert.equal(original.innerHTML,html); preparePdfArticle(original,{meetings:false}); assert.equal(original.querySelectorAll('h2').length,0);
});
test('metadata stays intact and ordinary opening paragraphs are not reformatted', () => {
  const a=article('<h1>Report</h1><p><strong>Date:</strong> Today\n<strong>Author:</strong> Ada</p>');
  const text=a.textContent; preparePdfArticle(a); assert.equal(a.textContent,text); assert.ok(a.querySelector('.pdf-metadata'));
  const b=article('<h1>Report</h1><p>This is <strong>bold</strong> prose.</p>'); preparePdfArticle(b); assert.equal(b.querySelectorAll('.pdf-metadata').length,0);
});
test('ambiguous nested tables and multiple header rows retain the original grid', () => {
  for(const html of [table.replace('01:22','<table><tr><td>nested</td></tr></table>'),table.replace('</thead>','<tr><th>extra</th></tr></thead>')]) {
    const a=article(html); preparePdfArticle(a); assert.ok(a.querySelector('#actions')); assert.equal(a.querySelectorAll('.pdf-card').length,0);
  }
});
test('invalid preferences fall back and native print headers escape markup', () => {
  assert.deepEqual(normalizePdfOptions({profile:'<script>',cards:false,meetings:'yes'}),{profile:'technical',cards:false,meetings:false});
  const p=pdfPrintOptions('<img src=x onerror=alert(1)>','<script>');
  assert.doesNotMatch(p.headerTemplate,/<img|<script/); assert.match(p.headerTemplate,/&lt;img/); assert.match(p.headerTemplate,/Technical/);
  assert.equal(p.generateTaggedPDF,true); assert.match(p.footerTemplate,/totalPages/);
  assert.equal(article(p.headerTemplate).firstElementChild.style.fontSize, '9px');
  assert.equal(article(p.footerTemplate).firstElementChild.style.display, 'flex');
  assert.equal(normalizePdfOptions(null).profile, 'technical');
});
