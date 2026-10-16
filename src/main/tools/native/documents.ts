import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ToolError } from '../../errors';
import { readZipFiles } from '../../lib/zip';
import type { PathGuard } from '../../security/path-guard';
import { defineTool, fail, type Tool } from '../types';

/**
 * read_document (idea from Tencent/WeKnora's document parsing; code is ours): the text of PDF, Word,
 * Excel and PowerPoint files, so Jarvis can summarise a contract or a spreadsheet without Office.
 * PDF through unpdf (pdf.js); the Office formats are zip files of XML, read with our own lib/zip.
 * Text only: no macros, scripts or embedded objects are ever run, and the result is untrusted.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Zip-bomb guards: one part, and all the parts read, may not inflate past these. */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 120 * 1024 * 1024;
const MAX_SHEET_ROWS = 2000;
const MAX_PDF_PAGES = 300;
const DEFAULT_CHARS = 30_000;
export const DOCUMENT_EXT = /\.(pdf|docx|xlsx|pptx)$/i;
const UNIT: Record<string, string> = { '.pdf': 'page', '.xlsx': 'sheet', '.pptx': 'slide' };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** XML text → plain text: decodes the five named entities and numeric character references. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** word/document.xml → paragraphs, tabs and line breaks kept. */
export function docxText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>|<w:cr\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One slide's XML → its text runs, one paragraph per line. */
export function slideText(xml: string): string {
  return decodeXml(xml.replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** xl/sharedStrings.xml → the string table cells point into. */
export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml((m[1] ?? '').replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, '')),
  );
}

/** One worksheet's XML → tab-separated rows (cell values as Excel last saved them). */
export function sheetRows(xml: string, strings: string[], maxRows = MAX_SHEET_ROWS): string[] {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= maxRows) break;
    const cells = [...(row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const attrs = c[1] ?? '';
      const inner = c[2] ?? '';
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      if (type === 'inlineStr') return decodeXml(inner.replace(/<[^>]+>/g, ''));
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      return type === 's' ? (strings[Number(v)] ?? '') : decodeXml(v);
    });
    if (cells.some((x) => x.trim())) rows.push(cells.join('\t'));
  }
  return rows;
}

/** The Office parts worth reading; anything else in the zip (media, macros) is never opened. */
const OFFICE_PARTS: Record<string, RegExp> = {
  '.docx': /^word\/document\.xml$/,
  '.pptx': /^ppt\/slides\/slide\d+\.xml$/,
  '.xlsx':
    /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/,
};

/**
 * Sheet names by worksheet part: workbook.xml names each sheet and points at it by relationship id;
 * workbook.xml.rels turns the id into a part (sheet3.xml may be the first sheet after a reorder).
 */
export function sheetNamesByPart(workbook: string, rels: string): Map<string, string> {
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const to = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && to) target.set(id, `xl/${to.replace(/^\/?xl\//, '').replace(/^\//, '')}`);
  }
  const names = new Map<string, string>();
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const id = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const part = id ? target.get(id) : undefined;
    if (name !== undefined && part) names.set(part, decodeXml(name));
  }
  return names;
}

const partNumber = (name: string): number => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

async function officeText(file: string, ext: string): Promise<{ text: string; parts: number }> {
  const want = OFFICE_PARTS[ext];
  if (!want) throw new ToolError(`Can't read ${ext} files.`);
  let parts: Array<{ name: string; data: Buffer }>;
  try {
    parts = await readZipFiles(file, (n) => want.test(n), MAX_ENTRY_BYTES, MAX_UNZIPPED_BYTES);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new ToolError(`That file is damaged or not a real Office document (${why}).`);
  }
  const xml = (name: string): string =>
    parts.find((x) => x.name === name)?.data.toString('utf8') ?? '';
  const numbered = (re: RegExp) =>
    parts.filter((x) => re.test(x.name)).sort((a, b) => partNumber(a.name) - partNumber(b.name));
  if (ext === '.docx') {
    if (!parts.length) throw new ToolError('That .docx has no document body.');
    return { text: docxText(xml('word/document.xml')), parts: 1 };
  }
  if (ext === '.pptx') {
    const slides = numbered(/slide\d+\.xml$/);
    const text = slides
      .map((x, i) => `--- Slide ${i + 1} ---\n${slideText(x.data.toString('utf8'))}`)
      .join('\n\n');
    return { text, parts: slides.length };
  }
  const strings = sharedStrings(xml('xl/sharedStrings.xml'));
  const sheetNames = sheetNamesByPart(xml('xl/workbook.xml'), xml('xl/_rels/workbook.xml.rels'));
  const sheets = numbered(/worksheets\/sheet\d+\.xml$/);
  const text = sheets
    .map((x) => {
      const rows = sheetRows(x.data.toString('utf8'), strings);
      const name = sheetNames.get(x.name) ?? `Sheet${partNumber(x.name)}`;
      return `--- Sheet: ${name} (${rows.length} rows) ---\n${rows.join('\n')}`;
    })
    .join('\n\n');
  return { text, parts: sheets.length };
}

async function pdfText(buf: Buffer): Promise<{ text: string; parts: number }> {
  const { getDocumentProxy } = await import('unpdf');
  try {
    // This pdf.js build has no eval path (fonts included); XFA forms stay off.
    const pdf = await getDocumentProxy(new Uint8Array(buf), { enableXfa: false });
    // ponytail: pdf.js runs on the main thread (its Node "fake worker"); the page cap bounds the
    // work. Move it to the utility process if a real PDF ever stalls the app.
    const count = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const pages: string[] = [];
    for (let i = 1; i <= count; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
      pages.push(`--- Page ${i} ---\n${text.replace(/[ \t]+\n/g, '\n').trim()}`);
    }
    if (pdf.numPages > count) pages.push(`… (stopped after ${count} of ${pdf.numPages} pages)`);
    return { text: pages.join('\n\n'), parts: pdf.numPages };
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError('That PDF could not be read (damaged, or protected with a password).');
  }
}

/** Plain text of a PDF / DOCX / XLSX / PPTX file (already path-checked and size-checked). */
export async function documentText(file: string): Promise<{ text: string; parts: number }> {
  const ext = path.extname(file).toLowerCase();
  return ext === '.pdf' ? pdfText(await readFile(file)) : officeText(file, ext);
}

export function createDocumentTool(guard: PathGuard): Tool {
  return defineTool({
    name: 'read_document',
    description:
      'Read the text of a PDF, Word (.docx), Excel (.xlsx) or PowerPoint (.pptx) file in the allowed folders, page by page, sheet by sheet or slide by slide. Use read_text_file for plain text files. Scanned PDFs (images only) return little or no text.',
    input: z.object({
      path: z.string().min(3).max(1024),
      maxChars: z.number().int().min(1000).max(200_000).default(DEFAULT_CHARS),
    }),
    tier: 'SAFE',
    untrustedOutput: true,
    timeoutMs: 60_000,
    summarize: ({ path: p }) => `Read ${path.basename(p)}`,
    guards: ({ path: p }) => ({ paths: [p] }),
    async run({ path: p, maxChars }) {
      const file = guard.resolve(p);
      const ext = path.extname(file);
      if (!DOCUMENT_EXT.test(file))
        return fail(`${path.basename(file)} isn't a PDF, .docx, .xlsx or .pptx file.`);
      const s = await stat(file).catch(() => {
        throw new ToolError(`Can't open ${file}: it doesn't exist or isn't readable.`);
      });
      if (!s.isFile()) return fail(`${file} is a folder, not a document.`);
      if (s.size > MAX_FILE_BYTES)
        return fail(`${file} is ${(s.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB.`);
      const { text, parts } = await documentText(file);
      const body = text.trim() || '(No text found: it may be a scanned image.)';
      const unit = UNIT[ext.toLowerCase()] ?? 'part';
      const head = `${path.basename(file)} (${parts} ${unit}${parts === 1 ? '' : 's'})`;
      const shown =
        body.length > maxChars
          ? `${body.slice(0, maxChars)}\n… (cut at ${maxChars} characters of ${body.length})`
          : body;
      return {
        content: [{ type: 'text', text: `${head}\n\n${shown}` }],
        untrustedSource: `file:${file}`,
      };
    },
  });
}
