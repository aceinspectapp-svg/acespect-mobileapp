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
import { BRAND_NAVY, BRAND_RED, COMPANY_ABN_ACN, COMPANY_NAME, withReportPage } from './reportPdf';
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
  /** Letter-spacing in CSS pixels. Only the cover's own drawing uses it; everything else ignores it. */
  ls?: number;
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
/** The first page, read from the marks CoverPage.tsx puts on its parts (see coverBlock in reportDocxExtract.ts). Sizes are CSS pixels. */
interface CoverBlock {
  k: 'cover';
  date: ParaBlock | null;
  dateGap: number;
  clientLabel: ParaBlock | null;
  clientName: ParaBlock | null;
  clientNameGap: number;
  clientNotes: ParaBlock[];
  refs: { gap: number; label: ParaBlock | null; value: ParaBlock | null; valueGap: number }[];
  banner: {
    bg: string;
    edge: { w: number; color: string } | null;
    pad: { t: number; r: number; b: number; l: number };
    marginTop: number;
    marginBottom: number;
    kicker: ParaBlock | null;
    kickerOpacity: number;
    title: ParaBlock | null;
    titleGap: number;
  };
  rows: { label: ParaBlock | null; labelGap: number; value: ParaBlock[] }[];
  rowPad: { t: number; b: number };
  rule: { w: number; color: string } | null;
  labelColumn: number;
  signature: { gap: number; name: ParaBlock | null; title: ParaBlock | null } | null;
}
type Block = ParaBlock | ImgBlock | TableBlock | BreakBlock | CoverBlock;
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

/** The rotation note a phone puts in a JPEG ("EXIF orientation", 1 = as stored, 2-8 = to be turned or flipped when shown), or 1 when there is none. */
function exifOrientation(data: Buffer): number {
  if (data.length < 12 || data[0] !== 0xff || data[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < data.length) {
    if (data[i] !== 0xff) return 1;
    const marker = data[i + 1]!;
    const size = data.readUInt16BE(i + 2);
    if (marker === 0xe1 && data.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const tiff = i + 10;
      const little = data.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (at: number): number => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
      const u32 = (at: number): number => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
      const dir = tiff + u32(tiff + 4);
      if (dir + 2 > data.length) return 1;
      const entries = u16(dir);
      for (let e = 0; e < entries; e++) {
        const at = dir + 2 + e * 12;
        if (at + 12 > data.length) return 1;
        if (u16(at) === 0x0112) return u16(at + 8) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1; // start of the picture data: no Exif block came first
    i += 2 + size;
  }
  return 1;
}

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
      } else if (b.k === 'cover') {
        out.push(...this.cover(b));
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

  /**
   * The first page, drawn the way the PDF draws it: the date, Client and the references side by side, the navy banner with its red edge
   * and spaced kicker, ruled rows of details, and the sign-off. Used for the cover only; no other part of the report goes through here.
   */
  private cover(b: CoverBlock): (Paragraph | Table)[] {
    const tw = (px: number): number => Math.round(px * this.scale * 15); // CSS pixels -> twips
    const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
    const noBorders = { top: none, bottom: none, left: none, right: none };
    const spacer = (px: number): Paragraph => new Paragraph({ spacing: { before: 0, after: 0, line: Math.max(20, tw(px)), lineRule: LineRuleType.EXACT }, children: [] });
    /** Blend the text colour toward the background by the element's opacity (the kicker is white at 92% on navy). */
    const blend = (fg: string | undefined, bg: string, opacity: number): string => {
      const rgb = (c: string | undefined): number[] | null => { const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c ?? ''); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
      const f = rgb(fg), k = rgb(bg);
      if (!f || !k || !(opacity < 1)) return hex(fg);
      return f.map((v, i) => Math.round(v * opacity + k[i]! * (1 - opacity)).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const para = (p: ParaBlock | null, o: { before?: number; after?: number; keepNext?: boolean; bg?: string; opacity?: number } = {}): Paragraph =>
      new Paragraph({
        keepNext: o.keepNext,
        spacing: { before: tw(o.before ?? 0), after: tw(o.after ?? 0), line: Math.round(Math.min(2, Math.max(1, p?.lineHeight || 1.15)) * 240), lineRule: LineRuleType.AUTO },
        children: (p?.runs ?? []).map((r) =>
          r.t === '\n'
            ? new TextRun({ break: 1 })
            : new TextRun({
                text: r.t,
                bold: r.b,
                italics: r.i,
                color: o.bg ? blend(r.color, o.bg, o.opacity ?? 1) : hex(r.color),
                size: halfPoints(r.size),
                font: 'Arial',
                characterSpacing: r.ls && r.ls > 0 ? Math.round(r.ls * this.scale * 15) : undefined,
              }),
        ),
      });
    const cell = (width: number, children: Paragraph[], o: { fill?: string; margins?: { top: number; bottom: number; left: number; right: number }; bottom?: { w: number; color: string } | null } = {}): TableCell =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
        margins: o.margins ?? { top: 0, bottom: 0, left: 0, right: 0 },
        borders: { ...noBorders, bottom: o.bottom ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(o.bottom.w * 6)), color: hex(o.bottom.color) } : none },
        children: children.length ? children : [spacer(1)],
      });
    const table = (widths: number[], rows: TableRow[]): Table =>
      new Table({ rows, columnWidths: widths, width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA }, borders: { ...noBorders, insideHorizontal: none, insideVertical: none } });

    const total = TEXT_WIDTH_TWIPS;
    const out: (Paragraph | Table)[] = [];

    // the date, then Client (with any "Attn" / "Via email" lines) beside the references
    out.push(para(b.date, { after: b.dateGap }));
    const half = Math.floor(total / 2);
    const clientCell: Paragraph[] = [para(b.clientLabel), para(b.clientName, { before: b.clientNameGap }), ...b.clientNotes.map((n) => para(n))];
    const refCell: Paragraph[] = b.refs.flatMap((r, i) => [para(r.label, { before: i === 0 ? 0 : r.gap }), para(r.value, { before: r.valueGap })]);
    out.push(table([half, total - half], [new TableRow({ cantSplit: true, children: [cell(half, clientCell), cell(total - half, refCell)] })]));

    // the banner: a navy cell with a narrow red cell for its edge
    const k = b.banner;
    out.push(spacer(k.marginTop));
    const navy = hex(k.bg);
    const edge = k.edge ? Math.max(40, tw(k.edge.w)) : 0;
    const bannerMargins = { top: tw(k.pad.t), bottom: tw(k.pad.b), left: tw(k.pad.l), right: tw(k.pad.r) };
    const bannerCells = [cell(total - edge, [para(k.kicker, { bg: k.bg, opacity: k.kickerOpacity }), para(k.title, { before: k.titleGap })], { fill: navy, margins: bannerMargins })];
    if (k.edge) bannerCells.push(cell(edge, [spacer(1)], { fill: hex(k.edge.color) }));
    out.push(table(k.edge ? [total - edge, edge] : [total], [new TableRow({ cantSplit: true, children: bannerCells })]));
    out.push(spacer(k.marginBottom));

    // the ruled rows: label column, then the value
    if (b.rows.length) {
      const labelW = Math.min(tw(b.labelColumn), total - 1200);
      const rowMargins = { top: tw(b.rowPad.t), bottom: tw(b.rowPad.b), left: 0, right: 0 };
      out.push(
        table(
          [labelW, total - labelW],
          b.rows.map((r) => new TableRow({ cantSplit: true, children: [cell(labelW, [para(r.label, { before: r.labelGap })], { margins: rowMargins, bottom: b.rule }), cell(total - labelW, r.value.map((v) => para(v)), { margins: rowMargins, bottom: b.rule })] })),
        ),
      );
    }

    // the sign-off, kept together
    if (b.signature) {
      out.push(para(b.signature.name, { before: b.signature.gap, keepNext: true }));
      if (b.signature.title) out.push(para(b.signature.title));
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

const hex2 = (css: string): string => css.replace('#', '').toUpperCase();

/**
 * The footer of every report, the same as the PDF's (reportPdf.ts buildFooterTemplate): a thin rule, then Client /
 * Date (the inspection date) / Job No / Page, the company details, and a red and a navy bar.
 */
function buildFooter(clientName: string, jobNo: string, inspectionDate: string): Footer {
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
      new Paragraph({ spacing: { before: 0, after: 0, line: 136, lineRule: LineRuleType.EXACT }, shading: { type: ShadingType.CLEAR, fill: hex2(BRAND_NAVY), color: 'auto' }, children: [] }),
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
  // A few workers, each with one scratch page of its own that it reuses: a report can hold hundreds of pictures, and a page per picture, all at once, overloads the browser.
  const items = [...srcs];
  let next = 0;
  const worker = async (): Promise<void> => {
    let scratch: Page | undefined;
    try {
      while (next < items.length) {
        const src = items[next++]!;
        let loaded = await loadImage(src, token);
        // Word may not honour a phone photo's rotation note (the PDF does: the browser turns it), so a photo that carries one is redrawn by the browser, upright.
        if (loaded?.kind === 'jpg' && exifOrientation(loaded.data) > 1) {
          scratch ??= await page.browser().newPage();
          loaded = (await rasterise(scratch, src, 'jpeg')) ?? loaded;
        }
        if (!loaded) {
          scratch ??= await page.browser().newPage();
          loaded = await rasterise(scratch, src);
        }
        out.set(src, loaded);
      }
    } finally {
      await scratch?.close().catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return out;
}

async function rasterise(scratch: Page, src: string, type: 'png' | 'jpeg' = 'png'): Promise<Loaded> {
  // On a page of its own (the caller's scratch page), so nothing of the report is in the way of the screenshot.
  try {
    await scratch.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
    await scratch.setContent(`<html><body style="margin:0;background:#fff"><img id="p" src="${src.replace(/"/g, '&quot;')}" style="display:block;max-width:1600px"></body></html>`, { waitUntil: 'load', timeout: 20_000 });
    const el = await scratch.$('#p');
    const box = await el?.boundingBox();
    if (!el || !box || box.width < 2) return null;
    const shot = (await el.screenshot(type === 'jpeg' ? { type: 'jpeg', quality: 92 } : { type: 'png' })) as Uint8Array;
    return { data: Buffer.from(shot), kind: type === 'jpeg' ? 'jpg' : 'png' };
  } catch {
    return null;
  }
}

// ---- the file ---------------------------------------------------------------------------------------------------------------
export async function generateInspectionReportDocx(
  inspectionId: string,
  authToken: string,
  meta: { clientName: string; jobNo: string; title: string; inspectionDate?: string },
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
        footers: { default: buildFooter(meta.clientName, meta.jobNo, meta.inspectionDate ?? '') },
        children: body.length ? body : [new Paragraph({ children: [] })],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
