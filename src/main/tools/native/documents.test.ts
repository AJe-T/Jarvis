import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeZip } from '../../lib/zip-fixture';
import type { PathGuard } from '../../security/path-guard';
import type { ToolContext } from '../types';
import { createDocumentTool, decodeXml, documentText, sheetRows, sharedStrings } from './documents';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-doc-'));
let n = 0;

/** Writes a zip (deflated parts, like Office saves them) and returns its path. */
function zip(files: Record<string, string>, ext: string): string {
  const file = join(dir, `doc${++n}${ext}`);
  writeFileSync(
    file,
    makeZip(Object.entries(files).map(([name, data]) => ({ name, data, deflate: true }))),
  );
  return file;
}

/** A one-page PDF saying `text`, with a correct xref table. */
function pdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const W = (body: string) => `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;

describe('read_document (idea from Tencent/WeKnora)', () => {
  it('decodes XML entities and character references', () => {
    expect(decodeXml('Tom &amp; Jerry &lt;3 &#8377;100 &#x2014; ok')).toBe(
      'Tom & Jerry <3 ₹100 — ok',
    );
  });

  it('reads Word paragraphs, tabs and breaks', async () => {
    const file = zip(
      {
        'word/document.xml': W(
          '<w:p><w:r><w:t>Invoice</w:t></w:r></w:p><w:p><w:r><w:t>Total</w:t><w:tab/><w:t>₹5,000</w:t></w:r></w:p>',
        ),
        'word/media/image1.png': 'not read',
      },
      '.docx',
    );
    expect((await documentText(file)).text).toBe('Invoice\nTotal\t₹5,000');
  });

  it('reads Excel sheets with shared, inline and number cells', async () => {
    const strings = sharedStrings(
      '<sst><si><t>Name</t></si><si><r><t>Pri</t></r><r><t>ya</t></r></si></sst>',
    );
    expect(strings).toEqual(['Name', 'Priya']);
    expect(
      sheetRows(
        '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Age</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>31</v></c></row><row r="3"><c r="A3"/></row></sheetData>',
        strings,
      ),
    ).toEqual(['Name\tAge', 'Priya\t31']);
    // After a reorder, the first sheet in the workbook ("People") lives in sheet2.xml.
    const file = zip(
      {
        'xl/workbook.xml':
          '<workbook><sheets><sheet name="People" sheetId="2" r:id="rId2"/><sheet name="Old" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
        'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Gone</t></si></sst>',
        'xl/worksheets/sheet1.xml': '<sheetData><row><c t="s"><v>1</v></c></row></sheetData>',
        'xl/worksheets/sheet2.xml': '<sheetData><row><c t="s"><v>0</v></c></row></sheetData>',
      },
      '.xlsx',
    );
    expect((await documentText(file)).text).toBe(
      '--- Sheet: Old (1 rows) ---\nGone\n\n--- Sheet: People (1 rows) ---\nName',
    );
  });

  it('reads PowerPoint slides in order', async () => {
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const file = zip(
      { 'ppt/slides/slide10.xml': slide('Ten'), 'ppt/slides/slide2.xml': slide('Two') },
      '.pptx',
    );
    const r = await documentText(file);
    expect(r.parts).toBe(2);
    expect(r.text.indexOf('Two')).toBeLessThan(r.text.indexOf('Ten'));
  });

  it('reads PDF text page by page', async () => {
    const file = join(dir, 'hello.pdf');
    writeFileSync(file, pdf('Hello from a PDF'));
    const r = await documentText(file);
    expect(r.parts).toBe(1);
    expect(r.text).toContain('Hello from a PDF');
  });

  it('refuses other files and damaged ones through the tool', async () => {
    const guard = { resolve: (p: string) => p } as unknown as PathGuard;
    const tool = createDocumentTool(guard);
    const ctx = {} as ToolContext;
    writeFileSync(join(dir, 'notes.txt'), 'hi');
    writeFileSync(join(dir, 'bad.docx'), 'not a zip');
    const ok = zip({ 'word/document.xml': W('<w:p><w:t>Fine</w:t></w:p>') }, '.docx');
    const txt = await tool.run({ path: join(dir, 'notes.txt'), maxChars: 30_000 }, ctx);
    expect(txt.isError).toBe(true);
    await expect(tool.run({ path: join(dir, 'bad.docx'), maxChars: 30_000 }, ctx)).rejects.toThrow(
      /damaged/,
    );
    const good = await tool.run({ path: ok, maxChars: 30_000 }, ctx);
    const first = good.content[0];
    expect(first?.type === 'text' ? first.text : '').toMatch(/\(1 part\)\n\nFine$/);
    expect(good.untrustedSource).toContain(ok);
    expect(tool.untrustedOutput).toBe(true);
  });
});
