import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';
import { full as emoji } from 'markdown-it-emoji';
import attrs from 'markdown-it-attrs';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import YAML from 'yaml';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

export const profiles = Object.freeze([
  { id: 'auto', label: 'Auto · broad compatibility', description: 'GFM with math, diagrams, wiki links, callouts and common publishing extensions.' },
  { id: 'commonmark', label: 'CommonMark', description: 'Conservative CommonMark parsing. Extension punctuation stays literal.' },
  { id: 'gfm', label: 'GitHub', description: 'GitHub-style tables, tasks, strikethrough, alerts, footnotes, math and diagrams.' },
  { id: 'extended', label: 'Extended Markdown', description: 'Broad reading support for scientific, documentation and publishing Markdown.' },
  { id: 'obsidian', label: 'Obsidian', description: 'Extended syntax plus Obsidian wiki links, image embeds, callouts and block references.' }
]);

const MAX_SOURCE_LENGTH = 2_000_000;
const MAX_HIGHLIGHT_LENGTH = 80_000;
const MAX_DIAGRAM_LENGTH = 60_000;
const MAX_MATH_LENGTH = 20_000;
const MAX_CONTAINER_DEPTH = 24;
const forbiddenTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'dialog', 'textarea', 'select', 'option', 'button', 'base', 'link', 'meta'];
const standardTags = new Set(('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg g path rect circle ellipse line polyline polygon text tspan textpath defs symbol use image marker pattern mask clippath lineargradient radialgradient stop filter foreignobject math semantics annotation mrow mi mn mo mtext mspace msqrt mfrac msup msub msubsup mtable mtr mtd mover munder munderover mstyle menclose mroot mpadded mphantom').split(' '));
// Application UI selectors must never be borrowed by document HTML. This list
// mirrors style.css and app.js; the test suite checks it against both sources.
const reservedUiClasses = new Set(('active app-shell brand brand-caption brand-dot brand-mark busy checkbox-setting compatibility-button compatibility-clear compatibility-note context-dot current detail-group detail-label detail-path detail-small details-panel dialog-actions dialog-heading document-bar document-context document-end document-facts document-kicker document-options drop-overlay error export-button file-identity file-modified folio-dialog folio-document help-body help-dialog help-version icon icon-button kicker-line level-1 level-2 level-3 level-4 level-5 level-6 main-shell menu metadata-facts note-dot open-button optional-status outline-link panel-heading paste-link popover popover-anchor popover-eyebrow primary-button profile-selector quiet-button reader-scroll reading-paper recent-file recent-section search-bar search-field setting-row settings-note settings-panel shortcut-row sidebar sidebar-empty sidebar-foot sidebar-hidden sidebar-scrim sidebar-scroll sidebar-section sidebar-version size-hints source-foot source-heading source-pane sr-only status-bar status-ready-dot status-separator status-stats toast toolbar toolbar-actions toolbar-leading view-switch visible workspace').split(' '));
const reservedUiIds = new Set(('app app-shell compatibility-label compatibility-toggle copy-source details-close details-content details-panel document-content document-kicker document-location document-title drop-overlay export-html export-menu export-pdf export-toggle file-input file-modified font-size font-size-value format-status help-button help-dialog kicker-label line-breaks open-file outline paste-content paste-dialog paste-open paste-submit profile-select reader-scroll reading-time recent-files remote-images search-bar search-close search-count search-input search-next search-prev search-toggle settings-panel settings-toggle sidebar-scrim sidebar-toggle source-content source-pane source-paste status-dot status-message theme-toggle toast warning-count welcome-button word-count workspace').split(' '));
const hasJsxElement = value => [...value.matchAll(/<\/?([A-Z][\w.]*)(?:\s|\/?\>)/g)].some(match => !standardTags.has(match[1].toLowerCase()));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = value => String(value).normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s+/g, '-') || 'section';
const isReservedId = value => reservedUiIds.has(value) || value in window.document || value in window.document.createElement('form');
const envHasAlias = (env, id) => Object.hasOwn(env.headingAliases, id);
let sourcePurifier;
let sourceWarningEnv;
let finalPurifier;
let finalWarningEnv;

function getFinalPurifier() {
  if (!finalPurifier) {
    finalPurifier = DOMPurify(window);
    finalPurifier.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName === 'class') {
        const original = data.attrValue.split(/\s+/).filter(Boolean);
        const safe = original.filter(name => !reservedUiClasses.has(name));
        if (safe.length !== original.length) {
          data.attrValue = safe.join(' ');
          if (!safe.length) data.keepAttr = false;
          if (finalWarningEnv) addWarning(finalWarningEnv, 'document-scope', 'A document class or ID conflicted with application controls and was adjusted for safe display.');
        }
      }
      if (data.attrName === 'id' && reservedUiIds.has(data.attrValue)) {
        data.attrValue = `section-${data.attrValue}`;
        if (finalWarningEnv) addWarning(finalWarningEnv, 'document-scope', 'A document class or ID conflicted with application controls and was adjusted for safe display.');
      }
      if (data.attrName === 'href' && data.attrValue.startsWith('#')) {
        try {
          const id = decodeURIComponent(data.attrValue.slice(1));
          if (reservedUiIds.has(id)) data.attrValue = `#section-${id}`;
        } catch { /* Invalid fragment stays inert. */ }
      }
    });
  }
  return finalPurifier;
}

function safeCssLength(value, allowNegative = false) {
  if (value === '0') return true;
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|em|rem|%)$/.exec(value);
  if (!match) return false;
  const amount = Number(match[1]);
  if (!allowNegative && amount < 0) return false;
  const limit = allowNegative ? (match[2] === 'px' ? 100 : 10) : (match[2] === 'px' ? 4096 : 100);
  return Math.abs(amount) <= limit;
}

function sanitizeSourceCss(source) {
  let removed = false;
  const declarations = [];
  for (const item of source.split(';')) {
    if (!item.trim()) continue;
    const colon = item.indexOf(':');
    if (colon < 0) { removed = true; continue; }
    const property = item.slice(0, colon).trim().toLowerCase();
    const value = item.slice(colon + 1).trim().toLowerCase();
    if (!value || /[\\@<>{}\x00-\x1f\x7f]|!\s*important|\/\*|\*\//.test(value)) { removed = true; continue; }
    let allowed = false;
    switch (property) {
      case 'color':
      case 'background-color':
        allowed = /^(?:[a-z]{1,30}|#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([\d.+,% /-]+\))$/.test(value);
        break;
      case 'text-align': allowed = /^(?:left|right|center|justify|start|end)$/.test(value); break;
      case 'font-weight': allowed = /^(?:normal|bold|bolder|lighter)$/.test(value) || (/^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= 1000); break;
      case 'font-style': allowed = /^(?:normal|italic|oblique)$/.test(value); break;
      case 'text-decoration': allowed = value.split(/\s+/).every(word => /^(?:none|underline|overline|line-through|solid|double|dotted|dashed|wavy)$/.test(word)); break;
      case 'vertical-align': allowed = /^(?:baseline|sub|super|text-top|text-bottom|middle|top|bottom)$/.test(value) || safeCssLength(value, true); break;
      case 'width':
      case 'max-width':
      case 'height': allowed = value === 'auto' || safeCssLength(value); break;
      default: allowed = false;
    }
    if (allowed) declarations.push(`${property}: ${value}`);
    else removed = true;
  }
  return { css: declarations.length ? declarations.join('; ') + ';' : '', removed };
}

function getSourcePurifier() {
  if (!sourcePurifier) {
    sourcePurifier = DOMPurify(window);
    sourcePurifier.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName !== 'style') return;
      const result = sanitizeSourceCss(data.attrValue);
      data.attrValue = result.css;
      if (!result.css) data.keepAttr = false;
      if (result.removed && sourceWarningEnv) addWarning(sourceWarningEnv, 'sanitized-html', 'Active or unsafe HTML/CSS was removed. Only a small set of static inline styles is allowed; scripts, forms, frames and page-level styles are blocked.');
    });
  }
  return sourcePurifier;
}
function resolveHeadingLink(href, env) {
  if (!href?.startsWith('#')) return href;
  try { return `#${env.headingAliases[decodeURIComponent(href.slice(1))] || href.slice(1)}`; } catch { return href; }
}

function addWarning(env, code, message) {
  if (!env.warnings.some(warning => warning.code === code)) env.warnings.push({ code, message });
}

function purify(html, raw = false, env) {
  if (typeof DOMPurify.sanitize !== 'function') throw new Error('Folio rendering requires a browser DOM. In Node, initialize jsdom before importing the engine.');
  const sanitizer = raw ? getSourcePurifier() : getFinalPurifier();
  sourceWarningEnv = env;
  finalWarningEnv = env;
  try { return sanitizer.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: raw ? [...forbiddenTags, 'input'] : forbiddenTags,
    FORBID_ATTR: ['srcdoc', 'autofocus', 'formaction', 'contenteditable', 'name'],
    ALLOW_DATA_ATTR: !raw,
    ADD_ATTR: raw ? [] : ['data-wikilink', 'data-embed', 'data-language', 'encoding'],
    ADD_TAGS: ['eq', 'eqn', 'semantics', 'annotation'],
    SANITIZE_DOM: true
  }); } finally { sourceWarningEnv = undefined; finalWarningEnv = undefined; }
}

// Raw source gets only narrowly allowlisted static inline CSS. Generated KaTeX
// may use its own layout styles. Preserve closing tags in inline token streams;
// the complete output is sanitized again after Markdown rendering.
function rawHtml(token, env) {
  if (/^<input class="task-list-item-checkbox"(?: checked="")? disabled="" type="checkbox">$/.test(token.content)) return token.content;
  if (hasJsxElement(token.content)) {
    addWarning(env, 'mdx-runtime', 'MDX/JSX components need their original JavaScript project. Component source is shown without executing it.');
    return token.type === 'html_block' ? `<pre class="unsupported-source"><code>${escapeHtml(token.content)}</code></pre>\n` : escapeHtml(token.content);
  }
  const original = token.content;
  const hadUnsafe = /<(?:script|style|iframe|object|embed|form)\b|\son\w+\s*=|(?:javascript|vbscript)\s*:/i.test(original);
  if (hadUnsafe) addWarning(env, 'sanitized-html', 'Active or unsafe HTML/CSS was removed. Only a small set of static inline styles is allowed; scripts, forms, frames and page-level styles are blocked.');
  if (token.type === 'html_inline' && /^<\/[a-z][\w-]*\s*>$/i.test(original)) return original;
  let clean = purify(original, true, env);
  if (token.type === 'html_inline' && /^<[a-z][\w-]*(?:\s[^<>]*)?\/?\s*>$/i.test(original)) {
    const tag = original.match(/^<([a-z][\w-]*)/i)?.[1].toLowerCase();
    const suffix = `</${tag}>`;
    if (clean.endsWith(suffix)) clean = clean.slice(0, -suffix.length);
  }
  return clean;
}

function wikiPlugin(md) {
  md.inline.ruler.before('image', 'folio_wikilink', (state, silent) => {
    const start = state.pos;
    const embedded = state.src.startsWith('![[', start);
    if (!embedded && !state.src.startsWith('[[', start)) return false;
    const offset = embedded ? 3 : 2;
    const end = state.src.indexOf(']]', start + offset);
    if (end < 0 || end - start > 2048) return false;
    const body = state.src.slice(start + offset, end);
    if (body.includes('\n') || !body.trim()) return false;
    if (!silent) {
      const [target, ...labels] = body.split('|');
      const token = state.push('folio_wikilink', '', 0);
      token.content = target.trim();
      token.meta = { embedded, label: labels.join('|').trim() };
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.folio_wikilink = (tokens, index, options, env) => {
    const { content: target, meta } = tokens[index];
    const href = resolveHeadingLink(md.normalizeLink(target.startsWith('#') ? `#${slugify(target.slice(1))}` : target), env);
    if (!md.validateLink(href)) {
      addWarning(env, 'unsafe-link', 'An unsafe link was left as text.');
      return escapeHtml(`${meta.embedded ? '!' : ''}[[${target}${meta.label ? `|${meta.label}` : ''}]]`);
    }
    const label = meta.label || target.split('/').pop();
    if (meta.embedded && /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:[?#].*)?$/i.test(target)) {
      const size = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(meta.label);
      const dimensions = size ? ` width="${Math.min(4096, Number(size[1]))}"${size[2] ? ` height="${Math.min(4096, Number(size[2]))}"` : ''}` : '';
      return `<img class="wiki-embed" data-wikilink="${escapeHtml(target)}" data-embed="image" src="${escapeHtml(href)}" alt="${escapeHtml(size ? target : label)}" loading="lazy"${dimensions}>`;
    }
    if (meta.embedded) addWarning(env, 'note-embed', 'Embedded notes and other documents appear as links. Recursive vault transclusion is not performed.');
    return `<a class="${meta.embedded ? 'wiki-embed' : 'wiki-link'}" data-wikilink="${escapeHtml(target)}"${meta.embedded ? ' data-embed="note"' : ''} href="${escapeHtml(href)}">${meta.embedded ? '↗ ' : ''}${escapeHtml(label)}</a>`;
  };
}

function criticPlugin(md) {
  const kinds = { '++': ['ins', 'critic-add', '++'], '--': ['del', 'critic-del', '--'], '==': ['mark', 'critic-highlight', '=='], '>>': ['span', 'critic-comment', '<<'], '~~': ['span', 'critic-substitution', '~~'] };
  md.inline.ruler.before('text', 'folio_critic', (state, silent) => {
    if (state.src[state.pos] !== '{') return false;
    const key = state.src.slice(state.pos + 1, state.pos + 3);
    const kind = kinds[key];
    if (!kind) return false;
    const end = state.src.indexOf(`${kind[2]}}`, state.pos + 3);
    if (end < 0 || end - state.pos > 20_000) return false;
    if (!silent) {
      const token = state.push('folio_critic', '', 0);
      token.content = state.src.slice(state.pos + 3, end);
      token.meta = { key, tag: kind[0], className: kind[1] };
    }
    state.pos = end + 3;
    return true;
  });
  md.renderer.rules.folio_critic = (tokens, index) => {
    const { content, meta } = tokens[index];
    if (meta.key === '~~') {
      const split = content.indexOf('~>');
      if (split >= 0) return `<del class="critic-del">${escapeHtml(content.slice(0, split))}</del><ins class="critic-add">${escapeHtml(content.slice(split + 2))}</ins>`;
    }
    return `<${meta.tag} class="${meta.className}">${escapeHtml(content)}</${meta.tag}>`;
  };
}

function calloutPlugin(md) {
  md.core.ruler.before('inline', 'folio_callouts', state => {
    for (let index = 0; index < state.tokens.length; index++) {
      const open = state.tokens[index];
      const paragraph = state.tokens[index + 1];
      const inline = state.tokens[index + 2];
      if (open.type !== 'blockquote_open' || paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const match = /^\[!([\w-]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/.exec(inline.content);
      if (!match) continue;
      let depth = 1;
      let closeIndex = index + 1;
      for (; closeIndex < state.tokens.length; closeIndex++) {
        if (state.tokens[closeIndex].type === 'blockquote_open') depth++;
        if (state.tokens[closeIndex].type === 'blockquote_close' && --depth === 0) break;
      }
      if (closeIndex >= state.tokens.length) continue;
      const type = match[1].toLowerCase();
      const meta = { type, fold: match[2] || '', title: match[3]?.trim() || type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ') };
      open.type = 'folio_callout_open';
      open.meta = meta;
      state.tokens[closeIndex].type = 'folio_callout_close';
      state.tokens[closeIndex].meta = meta;
      inline.content = inline.content.slice(match[0].length);
      inline.children = [];
      if (!inline.content) {
        paragraph.hidden = true;
        state.tokens[index + 3].hidden = true;
      }
    }
  });
  md.renderer.rules.folio_callout_open = (tokens, index, options, env) => {
    const { type, fold, titleTokens } = tokens[index].meta;
    const titleHtml = md.renderer.renderInline(titleTokens || [], options, env);
    return fold
      ? `<details class="callout callout-${escapeHtml(type)}"${fold === '+' ? ' open' : ''}><summary class="callout-title">${titleHtml}</summary><div class="callout-content">\n`
      : `<aside class="callout callout-${escapeHtml(type)}"><div class="callout-title">${titleHtml}</div><div class="callout-content">\n`;
  };
  md.renderer.rules.folio_callout_close = (tokens, index) => `</div></${tokens[index].meta.fold ? 'details' : 'aside'}>\n`;
}

function admonitionPlugin(md) {
  md.block.ruler.before('fence', 'folio_admonition', (state, startLine, endLine, silent) => {
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    const match = /^(:::|!!!|\?\?\?\+?)\s+([\w-]+)(?:\s+(.*))?$/.exec(line);
    if (!match || state.sCount[startLine] - state.blkIndent >= 4) return false;
    if ((state.env.containerDepth || 0) >= MAX_CONTAINER_DEPTH) return false;
    if (silent) return true;
    const fenced = match[1] === ':::';
    let nextLine = startLine + 1;
    let content = '';
    if (fenced) {
      let depth = 1;
      let codeFence = null;
      for (; nextLine < endLine; nextLine++) {
        const raw = state.src.slice(state.bMarks[nextLine] + state.tShift[nextLine], state.eMarks[nextLine]);
        const fence = /^(\`{3,}|~{3,})/.exec(raw);
        if (fence) {
          if (!codeFence) codeFence = fence[1];
          else if (fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length) codeFence = null;
        }
        if (!codeFence) {
          if (/^:::\s+[\w-]+/.test(raw)) depth++;
          else if (/^:::\s*$/.test(raw) && --depth === 0) break;
        }
      }
      content = state.getLines(startLine + 1, nextLine, state.sCount[startLine], false);
      if (nextLine === endLine) {
        addWarning(state.env, 'unclosed-admonition', 'An admonition has no closing ::: marker; its remaining content was retained.');
      }
    } else {
      const indent = state.sCount[startLine] + 4;
      for (; nextLine < endLine; nextLine++) {
        const raw = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]);
        if (raw.trim() && state.sCount[nextLine] < indent) break;
      }
      content = state.getLines(startLine + 1, nextLine, indent, false);
    }
    let title = match[3]?.trim() || match[2].charAt(0).toUpperCase() + match[2].slice(1);
    title = title.replace(/^(["'])([\s\S]*)\1$/, '$2');
    const opening = state.push('folio_admonition_open', 'aside', 1);
    opening.block = true;
    opening.meta = { type: match[2].toLowerCase(), title, fold: match[1].startsWith('???') ? (match[1].endsWith('+') ? '+' : '-') : '' };
    const nested = [];
    state.env.containerDepth = (state.env.containerDepth || 0) + 1;
    try { state.md.block.parse(content, state.md, state.env, nested); } finally { state.env.containerDepth--; }
    for (const token of nested) { token.level += state.level; state.tokens.push(token); }
    const closing = state.push('folio_admonition_close', 'aside', -1);
    closing.block = true;
    closing.meta = opening.meta;
    state.line = fenced && nextLine < endLine ? nextLine + 1 : nextLine;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.folio_admonition_open = (tokens, index, options, env) => {
    const { type, titleTokens, fold } = tokens[index].meta;
    const titleHtml = md.renderer.renderInline(titleTokens || [], options, env);
    return fold
      ? `<details class="admonition admonition-${escapeHtml(type)}"${fold === '+' ? ' open' : ''}><summary class="admonition-title">${titleHtml}</summary><div class="admonition-content">\n`
      : `<aside class="admonition admonition-${escapeHtml(type)}"><div class="admonition-title">${titleHtml}</div><div class="admonition-content">\n`;
  };
  md.renderer.rules.folio_admonition_close = (tokens, index) => `</div></${tokens[index].meta.fold ? 'details' : 'aside'}>\n`;
}

function plainInline(tokens) {
  return (tokens || []).map(token => {
    if (token.type === 'image') return token.content;
    if (token.children) return plainInline(token.children);
    if (['text', 'code_inline', 'emoji', 'math_inline', 'math_inline_double', 'folio_critic'].includes(token.type)) return token.content;
    if (token.type === 'folio_wikilink') return token.meta.label || token.content;
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
    return '';
  }).join('');
}

function renderFormula(source, displayMode, env) {
  if (source.length > MAX_MATH_LENGTH) {
    addWarning(env, 'math-size', 'An unusually large formula was shown as source to keep the document responsive.');
    return `<code class="math-source">${escapeHtml(source)}</code>`;
  }
  try {
    return katex.renderToString(source, { displayMode, trust: false, strict: 'ignore', throwOnError: true, maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' });
  } catch {
    addWarning(env, 'math-error', 'A formula contains unsupported or invalid TeX; its source is retained in the document.');
    return `<code class="math-source">${escapeHtml(source)}</code>`;
  }
}

function createParser(profile, options) {
  const extended = ['auto', 'extended', 'obsidian'].includes(profile);
  const commonmark = profile === 'commonmark';
  const md = new MarkdownIt(commonmark ? 'commonmark' : 'default', {
    html: true, linkify: !commonmark, typographer: false, breaks: Boolean(options.breaks), maxNesting: 60
  });
  if (!commonmark) md.use(taskLists, { enabled: false, label: false }).use(footnote).use(emoji, { shortcuts: {} }).use(calloutPlugin);
  if (extended) {
    md.use(deflist).use(abbr).use(sub).use(sup).use(mark)
      .use(attrs, { allowedAttributes: ['id', 'class', 'title', 'width', 'height', 'align'] })
      .use(wikiPlugin).use(criticPlugin).use(admonitionPlugin);
  }
  if (!commonmark) {
    md.use(texmath, { engine: katex, delimiters: extended ? ['dollars', 'brackets', 'gitlab', 'beg_end'] : ['dollars', 'gitlab'], katexOptions: { trust: false, strict: 'ignore', throwOnError: false, maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' } });
    for (const name of ['math_inline', 'math_inline_double', 'math_block', 'math_block_eqno']) {
      if (!md.renderer.rules[name]) continue;
      md.renderer.rules[name] = (tokens, index, opts, env) => {
        const display = name !== 'math_inline';
        const result = renderFormula(tokens[index].content, display, env);
        const number = name === 'math_block_eqno' && tokens[index].info ? `<span class="equation-number">(${escapeHtml(tokens[index].info)})</span>` : '';
        return name.startsWith('math_block') ? `<div class="math-block">${result}${number}</div>\n` : `<span class="math-inline">${result}</span>`;
      };
    }
  }
  // Process titles in document order with ordinary inline content. Calling
  // md.renderInline during HTML rendering would rerun the footnote-tail core
  // against the shared document environment and emit duplicate footnote lists.
  md.core.ruler.at('inline', state => {
    for (const token of state.tokens) {
      if (token.type === 'folio_callout_open' || token.type === 'folio_admonition_open') {
        token.meta.titleTokens = [];
        state.md.inline.parse(token.meta.title, state.md, state.env, token.meta.titleTokens);
      }
      if (token.type === 'inline') {
        token.children ||= [];
        state.md.inline.parse(token.content, state.md, state.env, token.children);
      }
    }
  });
  md.renderer.rules.html_inline = (tokens, index, opts, env) => rawHtml(tokens[index], env);
  md.renderer.rules.html_block = (tokens, index, opts, env) => rawHtml(tokens[index], env);
  const originalImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, opts, env, renderer) => {
    tokens[index].attrSet('loading', 'lazy');
    return originalImage(tokens, index, opts, env, renderer);
  };
  const originalLink = md.renderer.rules.link_open || ((tokens, index, opts, env, renderer) => renderer.renderToken(tokens, index, opts));
  md.renderer.rules.link_open = (tokens, index, opts, env, renderer) => {
    tokens[index].attrSet('rel', 'noopener noreferrer');
    tokens[index].attrSet('href', resolveHeadingLink(tokens[index].attrGet('href'), env));
    return originalLink(tokens, index, opts, env, renderer);
  };
  md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  md.renderer.rules.fence = (tokens, index, opts, env) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (!commonmark && ['mermaid', 'dot', 'graphviz'].includes(language)) {
      if (token.content.length <= MAX_DIAGRAM_LENGTH) return `<pre class="${language === 'mermaid' ? 'mermaid' : 'graphviz'}">${escapeHtml(token.content)}</pre>\n`;
      addWarning(env, 'diagram-size', 'An unusually large diagram was shown as source to keep the document responsive.');
    }
    if (!commonmark && (language === 'math' || (extended && ['latex', 'tex'].includes(language)))) {
      return `<div class="math-block">${renderFormula(token.content, true, env)}</div>\n`;
    }
    if (['plantuml', 'puml', 'd2', 'tikz', 'vega', 'vega-lite', 'wavedrom', 'ditaa', 'nomnoml', 'pikchr', 'abc'].includes(language)) {
      addWarning(env, `diagram-${language}`, `${language} diagrams require an additional renderer. Their source is shown without contacting an external service.`);
    }
    if (/^\{/.test(language)) addWarning(env, 'runtime-directive', 'Executable notebook/Quarto directives are shown as source; code is never executed.');
    let highlighted = escapeHtml(token.content);
    if (token.content.length <= MAX_HIGHLIGHT_LENGTH && language && hljs.getLanguage(language)) {
      try { highlighted = hljs.highlight(token.content, { language, ignoreIllegals: true }).value; } catch { /* Escaped source remains readable. */ }
    }
    const safeLanguage = /^[\w+-]{1,50}$/.test(language) ? language : '';
    return `<div class="code-block"${safeLanguage ? ` data-language="${escapeHtml(safeLanguage)}"` : ''}>${token.info.trim() ? `<div class="code-language">${escapeHtml(token.info.trim())}</div>` : ''}<pre><code class="hljs${safeLanguage ? ` language-${escapeHtml(safeLanguage)}` : ''}">${highlighted}</code></pre></div>\n`;
  };
  md.core.ruler.push('folio_headings', state => {
    const used = new Set();
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token.type === 'heading_open') {
        const text = plainInline(state.tokens[index + 1]?.children).trim();
        const requestedId = token.attrGet('id');
        const originalId = requestedId ? requestedId.replace(/[^\p{L}\p{N}\p{M}_\-:.]/gu, '-') || 'section' : slugify(text);
        const base = isReservedId(originalId) ? `section-${originalId}` : originalId;
        if (base !== originalId && !envHasAlias(state.env, originalId)) state.env.headingAliases[originalId] = base;
        let id = base;
        let suffix = 1;
        while (used.has(id)) id = `${base}-${suffix++}`;
        used.add(id);
        token.attrSet('id', id);
        state.env.headings.push({ id, level: Number(token.tag.slice(1)), text });
      }
      if (extended && token.type === 'inline' && state.tokens[index - 1]?.type === 'paragraph_open') {
        const last = token.children?.at(-1);
        const reference = last?.type === 'text' && /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(last.content);
        if (reference) {
          last.content = last.content.slice(0, reference.index);
          const id = isReservedId(reference[1]) ? `block-${reference[1]}` : reference[1];
          if (id !== reference[1] && !envHasAlias(state.env, reference[1])) state.env.headingAliases[reference[1]] = id;
          state.tokens[index - 1].attrSet('id', id);
        }
      }
    }
  });
  return md;
}

function readFrontmatter(source, env, profile) {
  if (profile === 'commonmark' || !/^---\r?\n/.test(source)) return { source, metadata: {} };
  const end = /^(?:---|\.\.\.)\s*$/gm;
  end.lastIndex = source.indexOf('\n') + 1;
  const close = end.exec(source);
  if (!close || close.index > 65_536) return { source, metadata: {} };
  const yamlSource = source.slice(source.indexOf('\n') + 1, close.index);
  try {
    const metadata = YAML.parse(yamlSource, { maxAliasCount: 20, uniqueKeys: true, schema: 'core' });
    if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
      addWarning(env, 'frontmatter-shape', 'Front matter is not a metadata mapping and has been kept as source.');
      return { source, metadata: {} };
    }
    // YAML supports cyclic aliases and non-JSON values. The UI/export contract
    // deliberately returns bounded, acyclic JSON data, never native YAML graphs.
    const serialized = JSON.stringify(metadata || {});
    if (serialized.length > 131_072) throw new Error('Expanded metadata is too large');
    return { source: source.slice(close.index + close[0].length).replace(/^\r?\n/, ''), metadata: JSON.parse(serialized) };
  } catch {
    addWarning(env, 'frontmatter-invalid', 'Front matter could not be parsed safely and has been kept as source.');
    return { source, metadata: {} };
  }
}

function detectUnsupported(source, env, profile) {
  // Ignore fenced examples: a manual discussing syntax should not report that
  // every example is an unsupported feature of the manual itself.
  const prose = source.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[^\n]*(?=\n|$)/g, '\n').replace(/`[^`\n]*`/g, '');
  if (/^(?:import\s+.+\s+from\s+|export\s+(?:default|const|function)\b)/m.test(prose) || hasJsxElement(prose)) addWarning(env, 'mdx-runtime', 'MDX/JSX components need their original JavaScript project. Component source is shown without executing it.');
  if (/\[@[\w:-]+|\[-@[\w:-]+|(?<!\w)@[\w-]+(?=\s*[,;\]])/.test(prose)) addWarning(env, 'pandoc-citations', 'Bibliographic citation keys are retained; resolving citations requires a bibliography and citation processor.');
  if (/^\s*(?:\{[%{][\s\S]*?|:::\s*\{|\.\.\s+\w+::)/m.test(prose)) addWarning(env, 'runtime-directive', 'Template, Quarto or reStructuredText directives need their original publishing system; their source is retained.');
  if (/^\+[-=+]{3,}\+\s*$/m.test(prose)) addWarning(env, 'grid-table', 'Pandoc/reStructuredText grid tables are not parsed. Use a pipe table or inspect the original source.');
  if (/^\s*<<</m.test(prose)) addWarning(env, 'source-include', 'External file inclusion directives are kept as source; files are not loaded automatically.');
  if (profile === 'auto' && /\[\[[^\]\n]+\|[^\]\n]+\]\]/.test(prose)) addWarning(env, 'wiki-convention', 'Wiki links use the Obsidian convention [[target|label]]. Other wiki dialects may reverse those fields.');
}

export function renderMarkdown(input, options = {}) {
  const original = String(input ?? '').replace(/^\uFEFF/, '');
  const env = { warnings: [], headings: [], headingAliases: Object.create(null), containerDepth: 0 };
  const profile = profiles.some(item => item.id === options.profile) ? options.profile : 'auto';
  const characters = original.length;
  const words = (original.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu) || []).length;
  const stats = { words, characters, readingMinutes: words ? Math.max(1, Math.ceil(words / 220)) : 0 };
  if (original.length > MAX_SOURCE_LENGTH) {
    addWarning(env, 'document-size', 'This document exceeds the 2 million character rendering limit. A source preview is shown; the original file is unchanged.');
    return { html: `<pre class="source-fallback"><code>${escapeHtml(original.slice(0, 200_000))}</code></pre>`, headings: [], warnings: env.warnings, metadata: {}, stats, profile };
  }
  const { source, metadata } = readFrontmatter(original, env, profile);
  detectUnsupported(source, env, profile);
  const md = createParser(profile, options);
  let html;
  try {
    html = purify(md.render(source, env), false, env);
  } catch (error) {
    addWarning(env, 'render-error', `The renderer could not finish this document. Its source is shown instead (${String(error.message || error).slice(0, 140)}).`);
    env.headings.length = 0;
    html = `<pre class="source-fallback"><code>${escapeHtml(source)}</code></pre>`;
  }
  return { html, headings: env.headings, warnings: env.warnings, metadata, stats, profile };
}
