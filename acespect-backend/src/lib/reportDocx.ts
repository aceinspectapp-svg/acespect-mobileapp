import {
  AlignmentType,
  LineRuleType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
} from 'docx';
import type { Page } from 'puppeteer';
import { REPORT_EXTRACT_SOURCE } from './reportDocxExtract';
import { ADDRESS_LINE_1, ADDRESS_LINE_2, BRAND_NAVY, BRAND_RED, COMPANY_ABN_ACN, COMPANY_NAME, FOOTER_LABEL_COLOR, FOOTER_META_COLOR, withReportPage } from './reportPdf';
import { HOUSPECT_LOGO_DATA_URI } from './assets/houspectLogoBase64';

/**
 * The inspection report as an editable Word file. It is made from the same page the PDF is printed from: the page is read as it prints
 * (reportDocxExtract.ts) into paragraphs, tables and pictures, which are written out here with the report's own page, header and footer.
 * One report layout therefore feeds both files -- change the report and both follow.
 */

// ---- the extracted blocks (see reportDocxExtract.ts) -----------------------------------------------------------------------
interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  color?: string;
  size?: number;
  bg?: string | null;
  href?: string;
}
interface Box {
  top?: { w: number; color: string } | null;
  right?: { w: number; color: string } | null;
  bottom?: { w: number; color: string } | null;
  left?: { w: number; color: string } | null;
}
interface ParaBlock {
  k: 'para';
  runs: Run[];
  align: 'left' | 'center' | 'right' | 'justify';
  bg: string | null;
  box: Box | null;
  before: number;
  after: number;
  indent: number;
  lineHeight?: number;
}
interface ImgBlock {
  k: 'img';
  src: string;
  w: number;
  h: number;
}
interface Cell {
  w: number;
  bg: string | null;
  blocks: Block[];
}
interface TableBlock {
  k: 'table';
  width: number;
  center?: boolean;
  rows: { cells: Cell[]; border: Box | null }[];
}
interface BreakBlock {
  k: 'break';
}
type Block = ParaBlock | ImgBlock | TableBlock | BreakBlock;
interface Extracted {
  error?: string;
  contentWidth: number;
  blocks: Block[];
}

// ---- page geometry ----------------------------------------------------------------------------------------------------------
const TWIPS_PER_CM = 567;
const A4 = { width: Math.round(21 * TWIPS_PER_CM), height: Math.round(29.7 * TWIPS_PER_CM) };
const SIDE_MARGIN = Math.round(2.2 * TWIPS_PER_CM); // the PDF's 22mm
const TEXT_WIDTH_TWIPS = A4.width - 2 * SIDE_MARGIN;
const TEXT_WIDTH_PX = (TEXT_WIDTH_TWIPS / 1440) * 96; // the same width, at 96 pixels to the inch (a Word picture's unit)

/** CSS `rgb(…)`/`rgba(…)` to the six-digit hex Word wants. */
function hex(color: string | null | undefined, fallback = '000000'): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color ?? '');
  if (!m) return fallback;
  return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const halfPoints = (px: number | undefined): number => Math.max(2, Math.round((px ?? 15) * 0.75 * 2));
const pxToTwips = (px: number): number => Math.round(px * 15);

function border(side: { w: number; color: string } | null | undefined, space = 4): IBorderOptions | undefined {
  if (!side) return undefined;
  return { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(side.w * 6)), color: hex(side.color), space };
}

// ---- pictures ---------------------------------------------------------------------------------------------------------------
type ImageKind = 'png' | 'jpg' | 'gif';
function kindOf(buf: Buffer): ImageKind | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 4 && buf.toString('latin1', 0, 3) === 'GIF') return 'gif';
  return null;
}

async function loadImage(src: string, token: string): Promise<{ data: Buffer; kind: ImageKind } | null> {
  try {
    let data: Buffer;
    if (src.startsWith('data:')) {
      data = Buffer.from(src.slice(src.indexOf(',') + 1), src.includes(';base64') ? 'base64' : 'utf8');
    } else {
      const res = await fetch(src, { headers: src.includes('/api/') ? { Authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      data = Buffer.from(await res.arrayBuffer());
    }
    const kind = kindOf(data);
    return kind ? { data, kind } : null;
  } catch {
    return null;
  }
}

// ---- blocks to Word ---------------------------------------------------------------------------------------------------------
type Loaded = { data: Buffer; kind: ImageKind } | null;

class Writer {
  constructor(
    private readonly scale: number, // report CSS pixels -> Word pixels
    private readonly images: Map<string, Loaded>,
  ) {}

  private image(src: string): Loaded {
    return this.images.get(src) ?? null;
  }

  private runs(runs: Run[]): (TextRun | ExternalHyperlink)[] {
    return runs.map((r) => {
      if (r.t === '\n') return new TextRun({ break: 1 });
      const run = new TextRun({
        text: r.t,
        bold: r.b,
        italics: r.i,
        underline: r.u || r.href ? {} : undefined,
        color: r.href ? '0563C1' : hex(r.color),
        size: halfPoints(r.size),
        font: 'Arial',
        shading: r.bg ? { type: ShadingType.CLEAR, fill: hex(r.bg), color: 'auto' } : undefined,
      });
      return r.href ? new ExternalHyperlink({ link: r.href, children: [run] }) : run;
    });
  }

  private para(b: ParaBlock, extra: { pageBreakBefore?: boolean; inCell?: boolean } = {}): Paragraph {
    const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }[b.align];
    const box = b.box;
    return new Paragraph({
      children: this.runs(b.runs),
      alignment,
      pageBreakBefore: extra.pageBreakBefore,
      spacing: { before: pxToTwips(extra.inCell ? 0 : b.before), after: pxToTwips(extra.inCell ? Math.min(b.after, 4) : b.after), line: Math.round(Math.min(2, Math.max(1, b.lineHeight || 1.15)) * 240), lineRule: LineRuleType.AUTO },
      indent: b.indent > 4 ? { left: Math.min(pxToTwips(b.indent), 4000) } : undefined,
      shading: b.bg ? { type: ShadingType.CLEAR, fill: hex(b.bg), color: 'auto' } : undefined,
      border: box ? { top: border(box.top), right: border(box.right), bottom: border(box.bottom), left: border(box.left) } : undefined,
    });
  }

  async blocks(list: Block[], inCell = false, maxWidthPx = TEXT_WIDTH_PX): Promise<(Paragraph | Table)[]> {
    const out: (Paragraph | Table)[] = [];
    let breakNext = false;
    for (let n = 0; n < list.length; n++) {
      const b = list[n]!;
      if (b.k === 'break') {
        breakNext = true;
        continue;
      }
      if (b.k === 'para') {
        out.push(this.para(b, { pageBreakBefore: breakNext, inCell }));
      } else if (b.k === 'img') {
        if (breakNext) out.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0, line: 20 }, children: [] }));
        const loaded = this.image(b.src);
        // never wider than the column it sits in (a picture wider than its cell makes Word stretch the column and push the row about)
        const fit = Math.min(1, maxWidthPx / Math.max(1, b.w * this.scale));
        const width = Math.max(8, Math.round(b.w * this.scale * fit));
        const height = Math.max(8, Math.round(b.h * this.scale * fit));
        out.push(
          loaded
            ? new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new ImageRun({ type: loaded.kind, data: loaded.data, transformation: { width, height }, altText: { name: 'Photograph', description: 'Photograph', title: 'Photograph' } })],
              })
            : new Paragraph({ children: [new TextRun({ text: '[photograph not available]', italics: true, color: '8A97A8', size: 16, font: 'Arial' })] }),
        );
      } else if (b.k === 'table') {
        if (breakNext) out.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0, line: 20 }, children: [] }));
        out.push(await this.table(b));
        // Word joins two tables with nothing between them into one; a hairline paragraph keeps each row group its own.
        if (n < list.length - 1 && list[n + 1]!.k === 'table') out.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [] }));
      }
      breakNext = false;
    }
    return out;
  }

  private async table(t: TableBlock): Promise<Table> {
    const total = TEXT_WIDTH_TWIPS;
    const rows: TableRow[] = [];
    let grid: number[] = [];
    for (const row of t.rows) {
      // each column as wide as it is on the page, shrunk together if the row is somehow wider than the text column
      let widths = row.cells.map((c) => Math.max(240, Math.round(Math.max(1, c.w) * this.scale * 15)));
      const sum = widths.reduce((s, w) => s + w, 0);
      if (sum > total) widths = widths.map((w) => Math.max(240, Math.floor((w / sum) * total)));
      if (!grid.length || widths.length > grid.length) grid = widths;
      const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
      const cells = await Promise.all(
        row.cells.map(async (c, i) => {
          const children = await this.blocks(c.blocks, true, ((widths[i]! - 140) / 1440) * 96);
          return new TableCell({
            width: { size: widths[i]!, type: WidthType.DXA },
            shading: c.bg ? { type: ShadingType.CLEAR, fill: hex(c.bg), color: 'auto' } : undefined,
            margins: { top: 20, bottom: 20, left: 40, right: 60 },
            borders: { top: none, left: none, right: none, bottom: row.border?.bottom ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(row.border.bottom.w * 6)), color: hex(row.border.bottom.color) } : none },
            // a cell must end in a paragraph (a picture is a paragraph already; a nested table is not)
            children: children.length && children[children.length - 1] instanceof Paragraph ? children : [...children, new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [] })],
          });
        }),
      );
      rows.push(new TableRow({ children: cells, cantSplit: true }));
    }
    return new Table({
      rows,
      alignment: t.center ? AlignmentType.CENTER : undefined,
      columnWidths: grid,
      width: { size: grid.reduce((s, w) => s + w, 0), type: WidthType.DXA },
      borders: { top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' }, insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
    });
  }
}

// ---- the page header and footer ---------------------------------------------------------------------------------------------
function buildHeader(): Header {
  const data = Buffer.from(HOUSPECT_LOGO_DATA_URI.slice(HOUSPECT_LOGO_DATA_URI.indexOf(',') + 1), 'base64');
  // 742 x 276 pixels at the PDF's 20mm height
  const height = Math.round((20 / 25.4) * 96);
  const width = Math.round(height * (742 / 276));
  return new Header({
    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: 'png', data, transformation: { width, height }, altText: { name: 'Houspect', description: 'Houspect Building Inspections', title: 'Houspect' } })] })],
  });
}

function buildFooter(clientName: string, jobNo: string): Footer {
  const today = new Date();
  const date = [today.getDate(), today.getMonth() + 1, today.getFullYear()].map((n, i) => (i < 2 ? String(n).padStart(2, '0') : String(n))).join('.');
  const meta = (text: string, bold = false) => new TextRun({ text, bold, color: hex2(FOOTER_META_COLOR), size: 18, font: 'Arial' });
  const pipe = () => new TextRun({ text: '  |  ', color: hex2(BRAND_RED), size: 18, font: 'Arial' });
  const address = (parts: { label: string; value: string }[]) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 0 },
      children: parts.flatMap((p, i) => [
        ...(i ? [new TextRun({ text: '  |  ', color: hex2(BRAND_RED), size: 16, font: 'Arial' })] : []),
        ...(p.label ? [new TextRun({ text: `${p.label} `, color: hex2(FOOTER_LABEL_COLOR), size: 16, font: 'Arial' })] : []),
        new TextRun({ text: p.value, color: hex2(BRAND_NAVY), size: 16, font: 'Arial' }),
      ]),
    });
  return new Footer({
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [meta('Client Name: ', true), meta(clientName || '—')] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 20, after: 60 },
        children: [
          pipe(),
          meta('Date: ', true),
          meta(date),
          pipe(),
          meta('Job No: ', true),
          meta(jobNo || '—'),
          pipe(),
          meta('Page No: ', true),
          new TextRun({ children: [PageNumber.CURRENT], color: hex2(FOOTER_META_COLOR), size: 18, font: 'Arial' }),
          meta(' of '),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: hex2(FOOTER_META_COLOR), size: 18, font: 'Arial' }),
        ],
      }),
      // the red bar, then the navy bar
      new Paragraph({ spacing: { before: 0, after: 0, line: 60 }, shading: { type: ShadingType.CLEAR, fill: hex2(BRAND_RED), color: 'auto' }, children: [] }),
      new Paragraph({ spacing: { before: 0, after: 0, line: 200 }, shading: { type: ShadingType.CLEAR, fill: hex2(BRAND_NAVY), color: 'auto' }, children: [] }),
      address(ADDRESS_LINE_1),
      address(ADDRESS_LINE_2),
    ],
  });
}
const hex2 = (css: string): string => css.replace('#', '').toUpperCase();

/**
 * The Construction Report's footer, the same as its PDF footer (reportPdf.ts buildConstructionFooterTemplate): a thin rule, then Client /
 * Date (the inspection date) / Job No / Page, the company details, and a red and a navy bar.
 */
function buildConstructionFooter(clientName: string, jobNo: string, inspectionDate: string): Footer {
  const grey = '6B7280';
  const text = (t: string, bold = false, size = 13) => new TextRun({ text: t, bold, color: grey, size, font: 'Arial' });
  const sep = () => text('  |  ');
  const line = (children: TextRun[], size: number, before: number) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before, after: 0 }, children: children.length ? children : [text('', false, size)] });
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB', space: 4 } },
        children: [
          text('Client:', true),
          text(` ${clientName || '—'}`),
          sep(),
          text('Date:', true),
          text(` ${inspectionDate || '—'}`),
          sep(),
          text('Job No:', true),
          text(` ${jobNo || '—'}`),
          sep(),
          text('Page', true),
          new TextRun({ children: [' ', PageNumber.CURRENT], color: grey, size: 13, font: 'Arial' }),
          text(' of '),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: grey, size: 13, font: 'Arial' }),
        ],
      }),
      line([text('PO BOX 2521 Mt Waverley VIC 3149', false, 12), sep(), text('P (03) 9808 4000', false, 12), sep(), text('E info@houspectvic.com.au', false, 12), sep(), text('W www.houspect.com.au/victoria', false, 12)], 12, 60),
      line([text(`${COMPANY_NAME}  ${COMPANY_ABN_ACN}`, false, 12)], 12, 20),
      new Paragraph({ spacing: { before: 90, after: 0, line: 68, lineRule: LineRuleType.EXACT }, shading: { type: ShadingType.CLEAR, fill: hex2(BRAND_RED), color: 'auto' }, children: [] }),
      new Paragraph({ spacing: { before: 0, after: 0, line: 136, lineRule: LineRuleType.EXACT }, shading: { type: ShadingType.CLEAR, fill: '1B3A6B', color: 'auto' }, children: [] }),
    ],
  });
}

/** Every picture the report shows, as bytes Word can hold. A format Word does not take (SVG, WebP...) is drawn by the browser itself and kept as a PNG. */
async function loadPictures(blocks: Block[], page: Page, token: string): Promise<Map<string, Loaded>> {
  const srcs = new Set<string>();
  const collect = (list: Block[]): void => {
    for (const b of list) {
      if (b.k === 'img') srcs.add(b.src);
      else if (b.k === 'table') b.rows.forEach((r) => r.cells.forEach((c) => collect(c.blocks)));
    }
  };
  collect(blocks);
  const out = new Map<string, Loaded>();
  await Promise.all(
    [...srcs].map(async (src) => {
      let loaded = await loadImage(src, token);
      if (!loaded) loaded = await rasterise(page, src);
      out.set(src, loaded);
    }),
  );
  return out;
}

async function rasterise(page: Page, src: string): Promise<Loaded> {
  // On a page of its own, so nothing of the report is in the way of the screenshot.
  const scratch = await page.browser().newPage();
  try {
    await scratch.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
    await scratch.setContent(`<html><body style="margin:0;background:#fff"><img id="p" src="${src.replace(/"/g, '&quot;')}" style="display:block;max-width:1600px"></body></html>`, { waitUntil: 'load', timeout: 20_000 });
    const el = await scratch.$('#p');
    const box = await el?.boundingBox();
    if (!el || !box || box.width < 2) return null;
    const shot = (await el.screenshot({ type: 'png' })) as Uint8Array;
    return { data: Buffer.from(shot), kind: 'png' };
  } catch {
    return null;
  } finally {
    await scratch.close().catch(() => undefined);
  }
}

// ---- the file ---------------------------------------------------------------------------------------------------------------
export async function generateInspectionReportDocx(
  inspectionId: string,
  authToken: string,
  meta: { clientName: string; jobNo: string; title: string; kind?: 'construction'; inspectionDate?: string },
): Promise<Buffer> {
  const { extracted, pictures } = await withReportPage(
    inspectionId,
    authToken,
    async (page) => {
      const read = (await page.evaluate(REPORT_EXTRACT_SOURCE)) as Extracted;
      return { extracted: read, pictures: read.error ? new Map<string, Loaded>() : await loadPictures(read.blocks, page, authToken) };
    },
    // A4 (794px at 96 dpi) less the PDF's 22mm side margins: the width the PDF is laid out at.
    { print: true, width: Math.round((TEXT_WIDTH_TWIPS / 1440) * 96) },
  );
  if (extracted.error) throw new Error(`Could not read the report page: ${extracted.error}`);

  // Report CSS pixels -> Word pixels, so the page's text column is the Word text column.
  const scale = TEXT_WIDTH_PX / (extracted.contentWidth || TEXT_WIDTH_PX);
  const body = await new Writer(scale, pictures).blocks(extracted.blocks);

  const doc = new Document({
    creator: 'Houspect Victoria',
    title: meta.title,
    description: meta.title,
    styles: { default: { document: { run: { font: 'Arial', size: 25 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height },
            margin: { top: Math.round(3.0 * TWIPS_PER_CM), bottom: Math.round(3.4 * TWIPS_PER_CM), left: SIDE_MARGIN, right: SIDE_MARGIN, header: Math.round(0.8 * TWIPS_PER_CM), footer: Math.round(0.5 * TWIPS_PER_CM) },
          },
        },
        headers: { default: buildHeader() },
        footers: { default: meta.kind === 'construction' ? buildConstructionFooter(meta.clientName, meta.jobNo, meta.inspectionDate ?? '') : buildFooter(meta.clientName, meta.jobNo) },
        children: body.length ? body : [new Paragraph({ children: [] })],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
