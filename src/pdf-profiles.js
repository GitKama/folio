export const pdfProfiles = Object.freeze([
  { id: 'technical', label: 'Technical', description: 'Clear sections and action cards. Great for meeting notes.' },
  { id: 'studio', label: 'Studio', description: 'Clean sans-serif type and quiet teal accents. A versatile report.' },
  { id: 'editorial', label: 'Editorial', description: 'Serif typography and warm accents. Comfortable longer reading.' },
]);

export function normalizePdfOptions(options = {}) {
  if (!options || typeof options !== 'object') options = {};
  return {
    profile: pdfProfiles.some(p => p.id === options.profile) ? options.profile : 'technical',
    cards: options.cards !== false,
    meetings: options.meetings === true,
  };
}

// Changes the export clone only. Never rewrites the document or its source.
export function preparePdfArticle(article, options = {}) {
  const { profile, cards, meetings } = normalizePdfOptions(options);
  const doc = article.ownerDocument;
  article.classList.add('pdf-document');
  article.dataset.pdfProfile = profile;
  article.dataset.theme = 'light';
  if (meetings) {
    for (const p of [...article.children]) {
      if (p.tagName !== 'P' || p.children.length !== 1 || p.firstElementChild.tagName !== 'STRONG') continue;
      if (p.textContent.trim() !== p.firstElementChild.textContent.trim() || p.textContent.length > 90) continue;
      const h = doc.createElement('h2');
      for (const attr of p.attributes) h.setAttribute(attr.name, attr.value);
      h.append(...p.firstElementChild.childNodes);
      p.replaceWith(h);
    }
    for (const heading of article.querySelectorAll(':scope > h2')) {
      const label = heading.textContent.trim().toLowerCase();
      if (/^(action items|discussion highlights|next steps|appendix)$/.test(label)) heading.classList.add('pdf-page-section');
    }
  }
  const firstHeading = article.querySelector(':scope > h1');
  firstHeading?.classList.add('pdf-title');
  const metadata = firstHeading?.nextElementSibling;
  if (metadata?.tagName === 'P' && metadata.querySelectorAll('strong').length >= 2 && /(?:date|meeting id|author|copied on):/i.test(metadata.textContent)) metadata.classList.add('pdf-metadata');

  if (!cards) return article;
  for (const table of [...article.querySelectorAll('table')]) {
    // Spanning cells, nested tables and multi-row headers need their original grid.
    if (table.querySelector('table') || table.tHead?.rows.length !== 1 || table.tFoot) continue;
    const headers = [...table.tHead.rows[0].cells];
    const rows = [...table.tBodies].flatMap(body => [...body.rows]);
    if (headers.length < 4 || !rows.length || [...table.querySelectorAll('th,td')].some(c => c.colSpan !== 1 || c.rowSpan !== 1) || rows.some(r => r.cells.length !== headers.length)) continue;
    const group = doc.createElement('div');
    group.className = 'pdf-cards';
    if (table.id) group.id = table.id;
    if (table.caption) { const caption = doc.createElement('p'); caption.className = 'pdf-caption'; caption.append(...table.caption.cloneNode(true).childNodes); group.append(caption); }
    rows.forEach((row, index) => {
      const card = doc.createElement('section'); card.className = 'pdf-card';
      const number = doc.createElement('span'); number.className = 'pdf-card-number'; number.textContent = String(index + 1).padStart(2, '0'); card.append(number);
      const fields = doc.createElement('dl'); fields.className = 'pdf-card-fields';
      const rail = doc.createElement('div'); rail.className = 'pdf-card-rail';
      const body = doc.createElement('div'); body.className = 'pdf-card-body';
      [...row.cells].forEach((cell, i) => {
        const field = doc.createElement('div'); field.className = 'pdf-card-field';
        const term = doc.createElement('dt'); term.textContent = headers[i].textContent.trim() || `Column ${i + 1}`;
        const value = doc.createElement('dd'); value.append(...cell.cloneNode(true).childNodes);
        field.append(term, value);
        (/^(owner|assignee|due|due date)$/i.test(term.textContent) ? rail : body).append(field);
      });
      if (rail.children.length && body.children.length) { fields.classList.add('has-rail'); fields.append(rail, body); }
      else fields.append(...rail.childNodes, ...body.childNodes);
      card.append(fields); group.append(card);
    });
    table.replaceWith(group);
  }
  return article;
}
