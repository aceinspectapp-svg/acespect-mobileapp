/**
 * The script that reads the printed report page (the same `/report/:id` page the PDF is made from, in print layout) and turns what it
 * shows into a plain list of blocks -- paragraphs with their styled runs, images, tables and page breaks -- for reportDocx.ts to write
 * as a Word file. Reading the real page keeps the Word report the same document as the PDF: a wording or layout change in the report
 * reaches both with no second copy to keep in step.
 *
 * It is a STRING of plain browser JavaScript, not a TypeScript function: it is run inside the headless page by Puppeteer, and a function
 * compiled by tsx/esbuild would arrive with helper calls (`__name`) that do not exist there.
 *
 * Block shapes (all sizes in the page's CSS pixels; reportDocx.ts converts them):
 *   { k: "para",  runs: Run[], align, bg, box: {top,right,bottom,left}, before, after, indent }
 *   { k: "img",   src, w, h, align }
 *   { k: "table", width, center, rows: [{ cells: [{ w, bg, blocks }], border }] }
 *   { k: "break" }
 * Run: { t, b, i, u, color, size (px), bg, href }
 */
export const REPORT_EXTRACT_SOURCE = String.raw`
(() => {
  const root = document.querySelector('.report-page');
  if (!root) return { error: 'no report page' };
  const rootRect = root.getBoundingClientRect();
  const rootStyle = getComputedStyle(root);
  const contentWidth = rootRect.width - parseFloat(rootStyle.paddingLeft) - parseFloat(rootStyle.paddingRight);

  const isClear = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
  const px = (v) => parseFloat(v) || 0;
  const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-table', 'contents']);
  const hidden = (el) => {
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || el.hasAttribute('hidden');
  };
  const isInlineLevel = (el) => el.tagName === 'BR' || INLINE.has(getComputedStyle(el).display);
  const norm = (s) => s.replace(/[\s ]+/g, ' ');

  // Does this element (and everything in it) only hold inline content -- text, spans, links, line breaks?
  const inlineOnly = (el) => [...el.children].every((c) => hidden(c) || (isInlineLevel(c) && c.tagName !== 'IMG' && inlineOnly(c)));

  function runStyle(el) {
    const cs = getComputedStyle(el);
    return {
      b: parseInt(cs.fontWeight, 10) >= 600,
      i: cs.fontStyle === 'italic',
      u: (cs.textDecorationLine || '').includes('underline'),
      color: cs.color,
      size: px(cs.fontSize),
      bg: isClear(cs.backgroundColor) ? null : cs.backgroundColor,
      upper: cs.textTransform === 'uppercase',
    };
  }

  // The styled runs of an element's inline content.
  function runsOf(el, inherited) {
    const out = [];
    const style = el === inherited.el ? inherited.style : Object.assign({}, runStyle(el), { bg: isClear(getComputedStyle(el).backgroundColor) ? inherited.style.bg : runStyle(el).bg });
    const href = el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '') ? el.getAttribute('href') : inherited.href;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        let text = norm(node.textContent);
        if (!text) continue;
        if (style.upper) text = text.toUpperCase();
        out.push({ t: text, b: style.b, i: style.i, u: style.u, color: style.color, size: style.size, bg: style.bg, href });
      } else if (node.nodeType === 1) {
        if (hidden(node)) continue;
        if (node.tagName === 'BR') { out.push({ t: '\n' }); continue; }
        if (node.tagName === 'IMG') continue;
        const childStyle = Object.assign({}, runStyle(node));
        if (isClear(getComputedStyle(node).backgroundColor)) childStyle.bg = style.bg;
        out.push(...runsOf(node, { el: node, style: childStyle, href }));
      }
    }
    return out;
  }

  // Collapse whitespace across runs: no leading/trailing space, no doubled spaces.
  function tidy(runs) {
    const out = [];
    let prevSpace = true;
    for (const r of runs) {
      if (r.t === '\n') { out.push(r); prevSpace = true; continue; }
      let t = r.t;
      if (prevSpace) t = t.replace(/^ /, '');
      if (!t) continue;
      prevSpace = /\s$/.test(t);
      out.push(Object.assign({}, r, { t }));
    }
    while (out.length && out[out.length - 1].t !== '\n' && /\s$/.test(out[out.length - 1].t)) {
      out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '');
      if (!out[out.length - 1].t) out.pop(); else break;
    }
    return out;
  }

  function boxOf(cs) {
    const side = (s) => (px(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !isClear(cs['border' + s + 'Color']) ? { w: px(cs['border' + s + 'Width']), color: cs['border' + s + 'Color'] } : null);
    const box = { top: side('Top'), right: side('Right'), bottom: side('Bottom'), left: side('Left') };
    return box.top || box.right || box.bottom || box.left ? box : null;
  }

  function paragraph(el, runs) {
    const cs = getComputedStyle(el);
    const r = tidy(runs);
    if (!r.length) return null;
    return {
      k: 'para',
      runs: r,
      align: cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : cs.textAlign === 'justify' ? 'justify' : 'left',
      bg: isClear(cs.backgroundColor) ? null : cs.backgroundColor,
      box: boxOf(cs),
      before: Math.max(0, px(cs.marginTop)) + px(cs.paddingTop),
      after: Math.max(0, px(cs.marginBottom)) + px(cs.paddingBottom),
      indent: px(cs.marginLeft) + px(cs.paddingLeft),
      lineHeight: cs.lineHeight === 'normal' ? 0 : px(cs.lineHeight) / (px(cs.fontSize) || 1),
    };
  }

  function image(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { k: 'img', src: el.currentSrc || el.src, w: rect.width, h: rect.height, border: boxOf(getComputedStyle(el)) };
  }

  const breaksBefore = (el) => ['page', 'always', 'left', 'right'].includes(getComputedStyle(el).breakBefore);

  // A row of side-by-side things (a flex row, a table row) becomes one table row; each child is a cell.
  function tableFromRow(el, cells, rowBorder) {
    const rect = el.getBoundingClientRect();
    const total = cells.reduce((s, c) => s + c.rect.width, 0) || rect.width || 1;
    const centered = getComputedStyle(el).justifyContent === 'center' && total < rect.width - 4;
    return {
      k: 'table',
      width: rect.width,
      center: centered,
      rows: [
        {
          border: rowBorder,
          // each column runs to the next one's edge (the last to the row's), so the gaps between items stay and text is not squeezed to its own width
          cells: cells.map((c, i) => ({ w: centered ? c.rect.width : Math.max(c.rect.width, (i + 1 < cells.length ? cells[i + 1].rect.left : rect.right) - c.rect.left), bg: c.bg, blocks: c.blocks.length ? c.blocks : [{ k: 'para', runs: [], align: 'left', before: 0, after: 0, indent: 0 }] })),
        },
      ],
      total,
    };
  }

  function blocksOf(el, list) {
    if (hidden(el)) return;
    const cs = getComputedStyle(el);
    if (breaksBefore(el) && list.length) list.push({ k: 'break' });
    const tag = el.tagName;

    if (tag === 'IMG') { const b = image(el); if (b) list.push(b); return; }

    if (tag === 'TABLE') {
      const rows = [];
      for (const tr of el.querySelectorAll('tr')) {
        const cells = [...tr.children].filter((c) => !hidden(c)).map((c) => {
          const blocks = [];
          blocksInto(c, blocks);
          return { rect: c.getBoundingClientRect(), bg: isClear(getComputedStyle(c).backgroundColor) ? null : getComputedStyle(c).backgroundColor, blocks };
        });
        if (cells.length) {
          const t = tableFromRow(tr, cells, boxOf(getComputedStyle(cells.length ? tr.children[0] : tr)));
          rows.push(t.rows[0]);
        }
      }
      if (rows.length) list.push({ k: 'table', width: el.getBoundingClientRect().width, rows });
      return;
    }

    const kids = [...el.children].filter((c) => !hidden(c));

    // Side by side: a flex row with more than one child element.
    if ((cs.display === 'flex' || cs.display === 'inline-flex') && !cs.flexDirection.startsWith('column') && kids.length > 1 && kids.every((k) => !isInlineLevel(k) || k.tagName === 'DIV' || k.tagName === 'IMG' || true)) {
      const hasStructure = kids.some((k) => !isInlineLevel(k) || k.tagName === 'IMG' || k.querySelector('img') || getComputedStyle(k).display !== 'inline');
      if (hasStructure) {
        const cells = kids.map((k) => {
          const blocks = [];
          blocksOf(k, blocks);
          const kcs = getComputedStyle(k);
          return { rect: k.getBoundingClientRect(), bg: isClear(kcs.backgroundColor) ? null : kcs.backgroundColor, blocks };
        });
        const t = tableFromRow(el, cells, boxOf(cs));
        if (t.rows[0].border && !t.rows[0].border.bottom) t.rows[0].border = null;
        list.push(t);
        return;
      }
    }

    // Only inline content: one paragraph.
    if (inlineOnly(el) && !(cs.display === 'flex' && kids.length > 1)) {
      const p = paragraph(el, runsOf(el, { el, style: runStyle(el) }));
      if (p) list.push(p);
      return;
    }

    // A mix: walk the children, collecting inline pieces into paragraphs and recursing into the blocks.
    const before = list.length;
    blocksInto(el, list);
    // A box or tinted panel around one paragraph (the cover's title box) is drawn on that paragraph.
    const box = boxOf(cs);
    const bg = isClear(cs.backgroundColor) ? null : cs.backgroundColor;
    const added = list.slice(before);
    if ((box || bg) && added.length === 1 && added[0].k === 'para') {
      if (box && !added[0].box) added[0].box = box;
      if (bg && !added[0].bg) added[0].bg = bg;
      added[0].before += px(cs.marginTop) + px(cs.paddingTop);
      added[0].after += px(cs.marginBottom) + px(cs.paddingBottom);
    }
  }

  function blocksInto(el, list) {
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      const runs = [];
      for (const n of pending) {
        if (n.nodeType === 3) {
          const t = norm(n.textContent);
          if (t.trim()) { const st = runStyle(el); runs.push({ t: st.upper ? t.toUpperCase() : t, b: st.b, i: st.i, u: st.u, color: st.color, size: st.size, bg: st.bg }); }
        } else if (n.nodeType === 1) {
          runs.push(...runsOf(n, { el: n, style: runStyle(n) }));
        }
      }
      const p = paragraph(el, runs);
      if (p) { p.before = 0; p.after = 0; list.push(p); }
      pending = [];
    };
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { pending.push(node); continue; }
      if (node.nodeType !== 1 || hidden(node)) continue;
      if (node.tagName === 'IMG') { flush(); blocksOf(node, list); continue; }
      if (isInlineLevel(node) && inlineOnly(node) && !node.querySelector('img') && !breaksBefore(node)) { pending.push(node); continue; }
      flush();
      blocksOf(node, list);
    }
    flush();
  }

  const blocks = [];
  blocksInto(root, blocks);
  return { contentWidth, blocks };
})()
`;
