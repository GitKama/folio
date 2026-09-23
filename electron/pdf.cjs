const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function pdfPrintOptions(title, profile) {
  const label = ({ technical: 'Technical', studio: 'Studio', editorial: 'Editorial' })[profile] || 'Technical';
  const safeTitle = escape(String(title || 'Document').slice(0, 180));
  const style = 'width:100%;margin:0 17mm;font:9px Arial,sans-serif;color:#58667c;display:flex;align-items:center;justify-content:space-between;gap:12px;';
  return {
    printBackground: true, preferCSSPageSize: true, pageSize: 'A4',
    margins: { top: 0.75, bottom: 0.79, left: 0.67, right: 0.67 },
    generateDocumentOutline: true, generateTaggedPDF: true, displayHeaderFooter: true,
    headerTemplate: `<div style="${style}border-bottom:1px solid #dce1ed;padding-bottom:6px"><span style="white-space:nowrap;letter-spacing:1px">FOLIO / ${label}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeTitle}</span></div>`,
    footerTemplate: `<div style="${style}border-top:1px solid #dce1ed;padding-top:6px"><span>Folio · Markdown, clearly.</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  };
}
module.exports = { pdfPrintOptions };
