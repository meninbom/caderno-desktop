import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const out = path.resolve('tests/fixtures/media');
fs.mkdirSync(out, { recursive: true });

function rasterPage(lines) {
  const canvas = createCanvas(1100, 420), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1100, 420);
  ctx.fillStyle = '#111'; ctx.font = 'bold 72px Arial'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, 54, 120 + i * 120));
  return canvas.toBuffer('image/jpeg', 88);
}

function makePdf(pages) {
  const objects = [];
  const add = body => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary')); return objects.length; };
  const catalog = add(''); const pageTree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (let i = 0; i < pages.length; i++) {
    const image = pages[i].image;
    const imageId = image ? add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1100 /Height 420 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`, 'binary'), image, Buffer.from('\nendstream', 'binary')])) : null;
    const native = pages[i].nativeText ? `BT /F1 30 Tf 48 365 Td (${pages[i].nativeText}) Tj ET\n` : '';
    const draw = imageId ? `q 800 0 0 305 0 0 cm /Im${i + 1} Do Q\n` : '';
    const commands = Buffer.from(`${draw}${native}`, 'binary');
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${commands.length} >>\nstream\n`, 'binary'), commands, Buffer.from('endstream', 'binary')]));
    const xobjects = imageId ? `/XObject << /Im${i + 1} ${imageId} 0 R >>` : '';
    const pageId = add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 800 420] /Resources << /Font << /F1 ${font} 0 R >> ${xobjects} >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
  objects[pageTree - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')], offsets = [0];
  let length = chunks[0].length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(length);
    const entry = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'binary'), objects[i], Buffer.from('\nendobj\n', 'binary')]);
    chunks.push(entry); length += entry.length;
  }
  const xref = length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'binary'));
  return Buffer.concat(chunks);
}

const scan = [rasterPage(['ORCHID 2046', 'SCAN PAGE ONE']), rasterPage(['AÇÃO PÚBLICA 2026', 'SCAN PAGE TWO'])];
fs.writeFileSync(path.join(out, 'ocr-scan-two-pages.pdf'), makePdf(scan.map(image => ({ image }))));
const mixed = [rasterPage(['RASTER ORCHID 2046', 'MIXED PAGE TWO']), rasterPage(['RASTER ACESSO LOCAL', 'MIXED PAGE THREE'])];
fs.writeFileSync(path.join(out, 'ocr-mixed-three-pages.pdf'), makePdf([
  { image: rasterPage(['RASTER BACKGROUND PAGE ONE']), nativeText: 'DIGITAL LAYER COBALT 731' },
  { image: mixed[0] },
  { image: mixed[1] },
]));
const cancelImage = rasterPage(['CANCEL PIPELINE 2046', 'LOCAL OCR PAGE']);
fs.writeFileSync(path.join(out, 'ocr-cancel-24-pages.pdf'), makePdf(Array.from({ length: 24 }, () => ({ image: cancelImage }))));
fs.writeFileSync(path.join(out, 'ocr-page-limit-501.pdf'), makePdf(Array.from({ length: 501 }, () => ({ image: null }))));
