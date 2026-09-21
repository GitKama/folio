import { instance } from '@viz-js/viz';
let engine;
self.onmessage = async event => {
  try {
    engine ||= await instance();
    const svg = engine.renderString(event.data.source, { format: 'svg', engine: 'dot' });
    self.postMessage({ svg });
  } catch (error) { self.postMessage({ error: error.message || 'Graphviz could not render this diagram.' }); }
};
