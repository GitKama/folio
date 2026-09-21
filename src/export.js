import documentCss from './document.css?raw';
import mathCss from 'katex/dist/katex.min.css?raw';
import highlightLight from 'highlight.js/styles/github.css?raw';
import highlightDark from 'highlight.js/styles/github-dark.css?raw';
const fonts = import.meta.glob('../node_modules/katex/dist/fonts/*.woff2', { eager: true, query: '?url', import: 'default' });
let embeddedMathCss;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function toDataUrl(blob) {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('An image exceeds the 20 MB export limit.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('An image could not be embedded.')); reader.readAsDataURL(blob); });
}
async function embedMathCss() {
  embeddedMathCss ||= (async () => {
    let result = mathCss;
    const replacements = await Promise.all(Object.entries(fonts).map(async ([name, url]) => {
      if (url.startsWith('data:')) return [name.split('/').pop(), url];
      const response = await fetch(url);
      if (!response.ok) throw new Error('A bundled math font could not be read.');
      return [name.split('/').pop(), await toDataUrl(await response.blob())];
    }));
    const fontData = new Map(replacements);
    result = result.replace(/@font-face\{[^}]+\}/g, rule => {
      const filename = /url\(fonts\/([^)]+\.woff2)\)/.exec(rule)?.[1];
      const data = fontData.get(filename);
      if (!data) throw new Error('A math font is missing from the export bundle.');
      return rule.replace(/src:[^}]+/, `src:url("${data}") format("woff2")`);
    });
    return result;
  })();
  return embeddedMathCss;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
async function embedImage(image, original) {
  const source = original.currentSrc || original.src || image.getAttribute('src');
  if (!source) return;
  if (source.startsWith('data:')) { image.src = source; image.removeAttribute('srcset'); image.removeAttribute('loading'); return; }
  if (source.startsWith('folio://asset-') && window.folio?.embedResource) image.src = await window.folio.embedResource(source);
  else if (/^https?:/i.test(source)) {
    if (window.folio?.embedResource) {
      image.src = await window.folio.embedResource(source);
      image.removeAttribute('srcset'); image.removeAttribute('loading'); return;
    }
    // A loaded remote image can be embedded only if the host permits browser access.
    try {
      const response = await fetch(source, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('unavailable');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not an image');
      image.src = await toDataUrl(blob);
    } catch {
      if (!original.complete || !original.naturalWidth) throw new Error(`Image “${image.alt || source.split('/').pop()}” is not loaded. Save it beside the Markdown file and use a relative image path to export.`);
      try {
        const canvas = document.createElement('canvas'); canvas.width = original.naturalWidth; canvas.height = original.naturalHeight;
        canvas.getContext('2d').drawImage(original, 0, 0); image.src = canvas.toDataURL('image/png');
      } catch { throw new Error(`The host prevents embedding “${image.alt || source.split('/').pop()}”. Save that image beside the Markdown file and use a relative path.`); }
    }
  } else {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Local image “${image.alt || source}” could not be embedded.`);
    image.src = await toDataUrl(await response.blob());
  }
  image.removeAttribute('srcset');
  image.removeAttribute('loading');
}

export async function buildStandaloneHtml(articleElement, { title = 'Document', theme = 'light' } = {}) {
  const clone = articleElement.cloneNode(true);
  clone.className = 'folio-document';
  clone.dataset.theme = theme;
  clone.removeAttribute('id');
  clone.querySelectorAll('.search-hit, mark[data-search]').forEach(mark => mark.replaceWith(...mark.childNodes));
  clone.querySelectorAll('button, .copy-code, .diagram-source').forEach(element => element.remove());
  clone.querySelectorAll('details').forEach(details => { details.open = true; });
  const originals = [...articleElement.querySelectorAll('img')];
  await Promise.all([...clone.querySelectorAll('img')].map((image, index) => embedImage(image, originals[index])));
  const css = documentCss + (theme === 'dark' ? highlightDark : highlightLight) + (clone.querySelector('.katex') ? await embedMathCss() : '');
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  const dark = theme === 'dark';
  return `<!doctype html>
<html lang="en" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:${dark ? 'dark' : 'light'};--text:${dark ? '#e6e7e2' : '#28312f'};--muted:${dark ? '#a8b1ac' : '#68746d'};--border:${dark ? '#3b4541' : '#dce1d8'};--accent:${dark ? '#83d5b5' : '#257356'};--surface:${dark ? '#202823' : '#fffef9'};--paper:var(--surface);--code-bg:${dark ? '#151d19' : '#eef1e9'};--doc-font-size:17px;--reading-size:17px;--font-size:17px}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font-family:Segoe UI,system-ui,sans-serif}.folio-document{max-width:900px;margin:0 auto;padding:48px 56px}.folio-document svg{max-width:100%;height:auto}.folio-document img{max-width:100%}a{color:var(--accent)}
${safeCss}
@media print{.folio-document{--doc-text:#30372e!important;--doc-heading:#1d2b1b!important;--doc-muted:#697164!important;--doc-accent:#31552d!important;--doc-line:#d7dbd0!important;--doc-soft:#f4f5f0!important}.folio-document [data-diagram-theme="dark"]{background:#202823!important}.folio-document [data-diagram-theme="light"]{background:#f4f5f0!important}}
@media(max-width:600px){.folio-document{padding:24px 18px}}@page{size:A4;margin:16mm 16mm 18mm}@media print{html,body{background:white!important;color:#222!important;color-scheme:light;--text:#222;--muted:#555;--border:#ccc;--accent:#245f4e;--surface:white;--paper:white;--code-bg:#f3f4f3}.folio-document{max-width:none;margin:0;padding:0;font-size:10.5pt!important}h1,h2,h3,h4{break-after:avoid}pre,blockquote,figure,table{break-inside:avoid}pre{white-space:pre-wrap!important;overflow-wrap:anywhere}thead{display:table-header-group}tr,img{break-inside:avoid}a{color:#245f4e}details>*{display:block}.diagram-source{display:none!important}.diagram svg{max-height:220mm}.folio-document table{font-size:9pt}.folio-document .hljs{background:#f3f4f3;color:#222}}
</style></head><body>${clone.outerHTML}</body></html>`;
}
