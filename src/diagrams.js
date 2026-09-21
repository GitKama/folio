import DOMPurify from 'dompurify';
let mermaidModule;
let serial = 0;
const jobs = new WeakMap();

function graphviz(source) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./graphviz.worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Diagram layout exceeded 8 seconds. Simplify the graph to preview it.')); }, 8000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.svg); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Graphviz could not start.')); };
    worker.postMessage({ source });
  });
}

export async function hydrateDiagrams(container, { theme = 'light' } = {}) {
  const run = Symbol('render');
  jobs.set(container, run);
  const warnings = [];
  const diagrams = [...container.querySelectorAll('pre.mermaid, pre.graphviz')];
  for (const [index, block] of diagrams.entries()) {
    if (jobs.get(container) !== run) break;
    const source = block.textContent;
    const kind = block.classList.contains('mermaid') ? 'Mermaid' : 'Graphviz';
    try {
      if (index >= 50 || source.length > 30000) throw new Error('Diagram preview limit reached; its source is preserved below.');
      let svg;
      if (kind === 'Mermaid') {
        mermaidModule ||= import('mermaid').then(module => module.default);
        const mermaid = await mermaidModule;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', maxTextSize: 30000, maxEdges: 500, suppressErrorRendering: true, htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'Segoe UI, sans-serif', secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'themeCSS', 'themeVariables', 'flowchart', 'fontFamily', 'htmlLabels', 'dompurifyConfig', 'altFontFamily'] });
        ({ svg } = await mermaid.render(`folio-diagram-${++serial}`, source));
      } else svg = await graphviz(source);
      if (jobs.get(container) !== run || !block.parentNode) continue;
      const figure = document.createElement('figure');
      figure.className = `diagram ${kind === 'Mermaid' ? 'mermaid' : 'graphviz'}`;
      figure.dataset.diagramTheme = kind === 'Mermaid' ? theme : 'light';
      figure.setAttribute('aria-label', `${kind} diagram`);
      // Diagram-generated SVG stays isolated from raw HTML and is sanitized again.
      figure.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'a', 'script'], FORBID_ATTR: ['onload', 'onclick'] });
      const rendered = figure.querySelector('svg');
      if (rendered) {
        rendered.removeAttribute('height');
        rendered.style.maxWidth = '100%';
        rendered.setAttribute('role', 'img');
        rendered.setAttribute('aria-label', `${kind} diagram`);
      }
      const details = document.createElement('details');
      details.className = 'diagram-source';
      const summary = document.createElement('summary');
      summary.textContent = `${kind} source`;
      const pre = document.createElement('pre');
      const code = document.createElement('code'); code.textContent = source;
      pre.append(code); details.append(summary, pre); figure.append(details);
      block.replaceWith(figure);
    } catch (error) {
      warnings.push({ code: 'diagram', message: `${kind}: ${error.message}` });
      if (block.parentNode && jobs.get(container) === run) {
        block.classList.remove('mermaid', 'graphviz');
        block.classList.add('diagram-error');
        const caption = document.createElement('p');
        caption.className = 'diagram-error-label';
        caption.textContent = `${kind} preview unavailable — source preserved`;
        block.before(caption);
      }
    }
  }
  return { warnings };
}
