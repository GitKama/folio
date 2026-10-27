import { renderMarkdown } from './engine.js';

// Teams' compose shortcuts are not a paste API. Supply semantic clipboard HTML
// and readable Unicode text; never try to make pasted Markdown trigger typing.
export const MAX_TEAMS_BYTES = 80 * 1024;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pair = (html = '', text = '') => ({ html, text });
const literal = value => pair(escape(value), value);
const join = parts => pair(parts.map(p => p.html).join(''), parts.map(p => p.text).join(''));
const wrap = (tag, part, block = false, attrs = '') => pair(`<${tag}${attrs}>${part.html}</${tag}>`, block ? `\n${part.text}\n` : part.text);
const publicUrl = value => {
  if (!/^(https?:\/\/|mailto:)/i.test(value || '') || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
};

export function buildTeamsClipboard(source, options = {}) {
  if (typeof source !== 'string') throw new Error('No Markdown document is available to copy.');
  // Fail before the reader's large-document preview can truncate the export.
  if (source.length > 2_000_000) throw new Error('This document is too large for a Teams message. Copy a shorter section or export HTML/PDF.');
  const rendered = renderMarkdown(source, options);
  if (rendered.warnings.some(w => ['render-error', 'document-size'].includes(w.code))) throw new Error('The whole document could not be converted. Use Source to copy a shorter section or export HTML/PDF.');
  const notes = new Map(rendered.warnings.map(w => [w.code, w.message]));
  const note = (key, message) => notes.set(key, message);
  const root = document.createElement('template');
  root.innerHTML = rendered.html;
  if (Object.keys(rendered.metadata).length) note('metadata', 'Document front matter is metadata and is not included in the Teams message.');

  function children(node, depth) { return join([...node.childNodes].map(child => visit(child, depth + 1))); }
  function visit(node, depth = 0) {
    if (!node) return pair();
    if (depth > 100) throw new Error('This document is nested too deeply to copy safely. Simplify it or export HTML/PDF.');
    if (node.nodeType === 3) return literal(node.textContent);
    if (node.nodeType !== 1) return pair();
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'button', 'template'].includes(tag)) return pair();
    if (node.classList.contains('footnote-backref')) return pair();
    if (node.classList.contains('katex')) {
      note('math', 'Math is copied as its TeX source; Teams chat paste does not run KaTeX.');
      return wrap('code', literal(node.querySelector('annotation[encoding="application/x-tex"]')?.textContent || node.textContent));
    }
    if (node.classList.contains('code-block') && node.querySelector('pre')) {
      // The visible language label is UI, not a line in the user's code.
      return visit(node.querySelector('pre'), depth + 1);
    }
    if (tag === 'pre') {
      if (node.matches('.mermaid, .graphviz')) note('diagrams', 'Diagrams are copied as source code. Use HTML/PDF to share the rendered drawing.');
      note('code', 'Code is copied as preformatted text. Teams controls its appearance; language selection and syntax highlighting are not exported.');
      return wrap('pre', literal(node.textContent), true);
    }
    if (['svg', 'canvas', 'math', 'video', 'audio'].includes(tag)) {
      note('media', 'Embedded media is represented by a text label. Attach the media separately in Teams.');
      return literal(`[${node.getAttribute('aria-label') || node.querySelector('title')?.textContent || tag}]`);
    }
    if (tag === 'img') {
      note('images', 'Images become descriptive links or labels. Local images must be attached separately; local paths are not shared.');
      const label = literal(`[Image: ${node.getAttribute('alt') || 'image'}]`);
      const url = publicUrl(node.getAttribute('src'));
      return url ? pair(`<a href="${escape(url)}">${label.html}</a>`, `${label.text} (${url})`) : label;
    }
    if (tag === 'input') return node.getAttribute('type') === 'checkbox' ? literal(node.hasAttribute('checked') ? '☑ ' : '☐ ') : pair();
    if (tag === 'table') {
      note('tables', 'Tables become labeled rows so every cell stays readable when Teams removes table layout.');
      const rows = [...node.rows];
      const header = rows[0] && [...rows[0].cells].every(cell => cell.tagName === 'TH') ? rows.shift() : null;
      const labels = header ? [...header.cells].map(cell => cell.textContent.trim()) : [];
      const caption = node.querySelector(':scope > caption');
      const content = caption ? [wrap('p', children(caption, depth))] : [];
      if (!rows.length && header) content.push(wrap('p', children(header, depth)));
      rows.forEach((row, index) => {
        const cells = [...row.cells].map((cell, column) => {
          const label = labels[column] || `Column ${column + 1}`;
          const span = cell.colSpan > 1 || cell.rowSpan > 1 ? ` (spans ${cell.colSpan} columns, ${cell.rowSpan} rows)` : '';
          return join([wrap('strong', literal(label + span + ': ')), children(cell, depth)]);
        });
        const fields = join(cells.flatMap((cell, i) => i ? [pair('<br>', '\n'), cell] : [cell]));
        content.push(wrap('p', join([wrap('strong', literal(`Row ${index + 1}`)), pair('<br>', '\n'), fields]), true));
      });
      return join(content);
    }
    if (tag === 'ul' || tag === 'ol') {
      const start = Number.parseInt(node.getAttribute('start') || '1', 10);
      let number = Number.isSafeInteger(start) ? start : 1;
      const items = [...node.children].filter(item => item.tagName === 'LI').map(item => {
        const part = children(item, depth);
        const prefix = tag === 'ol' ? `${number++}. ` : '• ';
        const lines = part.text.trim().split('\n');
        return pair(`<li>${part.html}</li>`, prefix + lines.join('\n  ') + '\n');
      });
      const attrs = tag === 'ol' && start !== 1 && Number.isSafeInteger(start) ? ` start="${start}"` : '';
      return wrap(tag, join(items), true, attrs);
    }
    if (tag === 'br') return pair('<br>', '\n');
    if (tag === 'hr') return pair('<p>—</p>', '\n—\n');
    const part = children(node, depth);
    if (tag === 'a') {
      const href = node.getAttribute('href');
      const url = publicUrl(href);
      if (!url) {
        if (!node.closest('.footnote-ref')) note('local-links', 'Local, document-anchor and unsupported links keep their labels, without a broken link or private file path.');
        return part;
      }
      return pair(`<a href="${escape(url)}">${part.html || escape(url)}</a>`, part.text === url || !part.text ? url : `${part.text} (${url})`);
    }
    if (/^h[1-6]$/.test(tag)) return wrap(Number(tag[1]) <= 3 ? tag : 'p', wrap('strong', part), true);
    if (['strong', 'b'].includes(tag)) return wrap('strong', part);
    if (['em', 'i'].includes(tag)) return wrap('em', part);
    if (['s', 'del', 'strike'].includes(tag)) return wrap('s', part);
    if (['u', 'ins'].includes(tag)) return wrap('u', part);
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') return wrap('code', part);
    if (tag === 'blockquote') return pair(`<blockquote>${part.html}</blockquote>`, '\n' + part.text.trim().split('\n').map(line => `> ${line}`).join('\n') + '\n');
    if (node.classList.contains('callout-title') || tag === 'summary' || tag === 'dt') return wrap('p', wrap('strong', part), true);
    if (tag === 'sub' || tag === 'sup') {
      if (node.classList.contains('footnote-ref')) return part;
      note('scripts', 'Subscript and superscript use explicit _(text) and ^(text) notation.');
      return join([literal(tag === 'sub' ? '_(' : '^('), part, literal(')')]);
    }
    if (tag === 'mark' || node.hasAttribute('style')) note('styles', 'Document colors, highlighting and custom layout are simplified for the Teams composer.');
    if (['p', 'div', 'section', 'article', 'aside', 'details', 'dd', 'dl', 'figure', 'figcaption', 'address'].includes(tag)) return wrap('div', part, true);
    return part;
  }

  const result = children(root.content, 0);
  const html = `<html><head><meta charset="utf-8"></head><body><!--StartFragment-->${result.html}<!--EndFragment--></body></html>`;
  const text = result.text.replace(/^\n+|\n+$/g, '');
  if (!text.trim()) throw new Error('There is no message text to copy. Add text or use HTML/PDF for image-only documents.');
  // Check both common encodings. Teams adds its own message metadata on paste.
  const bytes = Math.max(new TextEncoder().encode(html).length, html.length * 2, new TextEncoder().encode(text).length, text.length * 2);
  if (bytes > MAX_TEAMS_BYTES) throw new Error('This export exceeds Folio’s 80 KB Teams message budget. Copy a shorter section into a new document, or share HTML/PDF. Nothing was copied or truncated.');
  return { html, text, notes: [...notes.values()], bytes };
}
