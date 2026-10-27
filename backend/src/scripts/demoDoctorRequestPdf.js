/**
 * A doctor's request for a demo booking, as a one-page PDF. [1.106.0]
 *
 * Every online booking carries one now, and the seed books online as the demo patient. Its own
 * module so repairMissingDemoFiles.js can draw the same page for a booking whose file is gone. Written
 * out by hand because the backend has no PDF library and this needs nothing but lines of text in
 * Helvetica: a valid file with a correct xref, which every browser's viewer opens. The doctor and
 * the licence number are invented, like every person the seed creates.
 */
function doctorRequestPdf({ patientName, testName, date }) {
  const lines = [
    'Dr. Ramon C. Villanueva, MD',
    'Internal Medicine - Clinic Hours Mon-Sat 9:00-3:00',
    'Bugo, Cagayan de Oro City',
    '',
    `Name: ${patientName}`,
    `Date: ${date}`,
    '',
    'Rx: Please do the following:',
    `    ${testName}`,
    '',
    'Clinical impression: routine check-up, for evaluation',
    '',
    '',
    '______________________________',
    'Ramon C. Villanueva, MD',
    'PRC Lic. No. 0098213',
  ];
  const esc = (s) => String(s).replace(/[\\()]/g, (c) => `\\${c}`);
  const content = ['BT', '/F1 11 Tf', '40 540 Td', '15 TL', ...lines.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { doctorRequestPdf };
