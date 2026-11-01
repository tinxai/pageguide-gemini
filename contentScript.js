// contentScript.js - Shadow-DOM piercing click interceptor & highlighter
(() => {
  if (window.__pgv4Loaded) return;
  window.__pgv4Loaded = true;
  const COLOR_PALETTE = [
    { bg: 'rgba(255, 224, 102, 0.55)', border: '#d4a017' },
    { bg: 'rgba(102, 217, 232, 0.55)', border: '#1098ad' },
    { bg: 'rgba(178, 242, 187, 0.60)', border: '#2f9e44' },
    { bg: 'rgba(255, 192, 203, 0.60)', border: '#e64980' },
    { bg: 'rgba(216, 180, 254, 0.60)', border: '#7950f2' },
    { bg: 'rgba(255, 212, 166, 0.60)', border: '#d9480f' }
  ];

  const highlightRegistry = new Map();

  function getColorForId(citeId) {
    const num = parseInt(citeId, 10);
    const idx = isNaN(num) ? 0 : (num - 1) % COLOR_PALETTE.length;
    return COLOR_PALETTE[Math.max(0, idx)];
  }

  function highlightAllOccurrences(citeId, quoteText) {
    if (!quoteText) return [];
    const cleanQuote = decodeURIComponent(quoteText).trim().replace(/\s+/g, ' ');
    if (cleanQuote.length < 3) return [];

    const color = getColorForId(citeId);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_SKIP;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.classList && parent.classList.contains('pg-evidence-mark')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    const matchedSpans = [];

    while ((node = walker.nextNode())) {
      const nodeText = node.textContent;
      const matchIndex = nodeText.toLowerCase().indexOf(cleanQuote.toLowerCase());

      if (matchIndex !== -1) {
        const range = document.createRange();
        range.setStart(node, matchIndex);
        range.setEnd(node, matchIndex + cleanQuote.length);

        const mark = document.createElement('mark');
        mark.className = 'pg-evidence-mark';
        mark.setAttribute('data-pg-cite-id', citeId);
        mark.style.backgroundColor = color.bg;
        mark.style.borderBottom = `2px solid ${color.border}`;
        mark.style.borderRadius = '3px';
        mark.style.padding = '1px 3px';
        mark.style.color = 'inherit';
        mark.style.transition = 'all 0.4s ease';

        try {
          range.surroundContents(mark);
          matchedSpans.push(mark);
        } catch (e) {}
      }
    }

    if (matchedSpans.length > 0) {
      highlightRegistry.set(String(citeId), matchedSpans);
    }
    return matchedSpans;
  }

  // ---- DOM reading (modelled on PageGuide's page index) ----
  // Only visible text, open shadow roots included, our own overlay excluded.
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT']);
  const LANDMARK = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"]';

  function isHidden(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    if (typeof el.checkVisibility === 'function') {
      return !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const st = getComputedStyle(el);
    return st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0';
  }

  // Nearest block-level ancestor, used to keep a quote inside one paragraph/card/list item.
  function blockOf(node) {
    let el = node.parentElement;
    while (el) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && d !== 'contents') return el;
      el = el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
    }
    return document.body;
  }

  function collectText() {
    const nodes = [];
    (function walk(root) {
      for (const child of root.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent.trim()) nodes.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (SKIP_TAGS.has(child.tagName.toUpperCase()) || child.id === 'pg-annot-root') continue;
          if (isHidden(child)) continue;
          if (child.shadowRoot) walk(child.shadowRoot);
          walk(child);
        }
      }
    })(document.body);
    return nodes;
  }

  // Letters/numbers-only lowercase string plus a map back to (node, offset, block, inLandmark),
  // so punctuation, whitespace and quote-style differences never break a match.
  function buildIndex() {
    let flat = ''; const map = [];
    for (const node of collectText()) {
      const block = blockOf(node);
      const landmark = !!(node.parentElement && node.parentElement.closest(LANDMARK));
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        if (/[\p{L}\p{N}]/u.test(t[i])) { flat += t[i].toLowerCase(); map.push({ node, off: i, block, landmark }); }
      }
    }
    return { flat, map };
  }

  const alnum = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).join('').toLowerCase();

  function occurrences(flat, needle) {
    const out = [];
    for (let i = flat.indexOf(needle); i !== -1; i = flat.indexOf(needle, i + 1)) out.push(i);
    return out;
  }

  // quote is "start" or "start,end" (text-fragment range).
  // A valid match keeps start and end in the same text block (one paragraph / card / list item),
  // and prefers main content over nav, sidebars and footers.
  function buildRange(quote) {
    let q = quote; try { q = decodeURIComponent(quote); } catch (e) {}
    const parts = q.split(',').map(alnum).filter(Boolean);
    if (!parts.length) return null;
    const { flat, map } = buildIndex();

    const candidates = [];
    for (const s of occurrences(flat, parts[0])) {
      let e = s + parts[0].length;
      // Never let a flattened match spill across table cells, cards, or
      // paragraphs that only appear adjacent in the text index.
      if (!map[s] || !map[e - 1] || map[e - 1].block !== map[s].block) continue;
      let paired = false;
      if (parts[1]) {
        for (const ei of occurrences(flat.slice(e), parts[1])) {
          const end = e + ei + parts[1].length;
          if (map[end - 1].block === map[s].block) { e = end; paired = true; break; }
        }
      }
      candidates.push({ s, e, paired, landmark: map[s].landmark, dataCell: map[s].block.tagName === 'TD' });
    }
    // If a start/end range cannot be paired inside one block, prefer a valid
    // end match. This avoids treating a label or header as the evidence when
    // the intended value is in a separate block or table cell.
    if (parts[1] && !candidates.some(candidate => candidate.paired)) {
      const endCandidates = [];
      for (const s of occurrences(flat, parts[1])) {
        const e = s + parts[1].length;
        if (map[s] && map[e - 1] && map[e - 1].block === map[s].block) {
          endCandidates.push({ s, e, paired: false, landmark: map[s].landmark, dataCell: map[s].block.tagName === 'TD' });
        }
      }
      if (endCandidates.length) candidates.splice(0, candidates.length, ...endCandidates);
    }
    if (!candidates.length) { console.debug('[PageGuide] no match for', parts[0]); return null; }

    // best: paired start/end > unpaired; spreadsheet data cell > row/column
    // header; main content > landmark; then document order.
    candidates.sort((x, y) => (y.paired - x.paired) || (y.dataCell - x.dataCell) || (x.landmark - y.landmark) || (x.s - y.s));
    const { s, e } = candidates[0];
    const a = map[s], b = map[e - 1];
    const r = document.createRange();
    r.setStart(a.node, a.off);
    r.setEnd(b.node, b.off + 1);
    return r;
  }

  function jumpToEvidence(citeId, quoteText) {
    let range = null;
    try { range = buildRange(quoteText); } catch (e) {}
    if (!range) {
      if (isGoogleWorkspaceReadableView()) {
        showNoEvidenceNotice(citeId);
      } else if (window.find) {
        window.find(String(quoteText).split(',')[0], false, false, true);
      }
      return false;
    }
    const color = getColorForId(citeId);
    if (window.CSS && CSS.highlights) {
      // the ::highlight rule must live in the same tree as the text (document or shadow root)
      const tree = range.startContainer.getRootNode();
      const host = tree instanceof ShadowRoot ? tree : document.head;
      if (!host.querySelector('#pg-hl-style')) {
        const st = document.createElement('style'); st.id = 'pg-hl-style';
        st.textContent = '::highlight(pg-evidence){background-color:rgba(255,224,102,.65);color:inherit}';
        host.appendChild(st);
      }
      CSS.highlights.set('pg-evidence', new Highlight(range));  // replaces the previous citation's highlight
    } else {
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    const el = range.startContainer.parentElement;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    annotate(range, citeId);
    return true;
  }

  function applyTextHighlight(range, citeId) {
    if (window.CSS && CSS.highlights) {
      const tree = range.startContainer.getRootNode();
      const host = tree instanceof ShadowRoot ? tree : document.head;
      if (!host.querySelector('#pg-hl-style')) {
        const st = document.createElement('style'); st.id = 'pg-hl-style';
        st.textContent = '::highlight(pg-evidence){background-color:rgba(255,224,102,.65);color:inherit}';
        host.appendChild(st);
      }
      CSS.highlights.set('pg-evidence', new Highlight(range));
    } else {
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    const el = range.startContainer.parentElement;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    annotate(range, citeId);
  }

  function jumpToSheetCell(citeId, spec) {
    if (!spec || !/\/htmlview\/sheet\/?$/i.test(location.pathname)) return false;
    const m = String(spec.ref || '').match(/^([A-Z]+)(\d+)$/i);
    if (!m) return false;
    let column = 0;
    for (const ch of m[1].toUpperCase()) column = column * 26 + ch.charCodeAt(0) - 64;
    column -= 1;
    const row = Number(m[2]);
    const rowHeader = [...document.querySelectorAll('th[id*="R"]')]
      .find(el => new RegExp(`R${row - 1}$`).test(el.id));
    const cell = rowHeader?.parentElement?.querySelectorAll('td')[column];
    if (!cell) { showNoEvidenceNotice(citeId); return false; }
    const visibleLabel = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    if (spec.label && visibleLabel(cell.textContent) !== visibleLabel(spec.label)) {
      showNoEvidenceNotice(citeId);
      return false;
    }
    const range = document.createRange();
    range.selectNodeContents(cell);
    applyTextHighlight(range, citeId);
    return true;
  }

  function isGoogleWorkspaceReadableView() {
    return location.hostname === 'docs.google.com' &&
      /^\/(document|spreadsheets|presentation)\/d\/[^/]+\/(mobilebasic|htmlview|htmlpresent)(?:\/|$)/i.test(location.pathname);
  }

  function showNoEvidenceNotice(citeId) {
    document.getElementById('pg-no-evidence')?.remove();
    const notice = document.createElement('div');
    notice.id = 'pg-no-evidence';
    notice.textContent = `Evidence ${citeId}: exact cited text not found`;
    Object.assign(notice.style, {
      position: 'fixed', left: '50%', top: '18px', translate: '-50% 0',
      zIndex: '2147483647', padding: '10px 16px', borderRadius: '9px',
      background: '#b3261e', color: '#fff', boxShadow: '0 3px 12px rgba(0,0,0,.3)',
      font: '700 14px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    });
    document.documentElement.appendChild(notice);
    setTimeout(() => notice.remove(), 5000);
  }

  // ---- Big arrow + sign annotation (click-through overlay that removes itself) ----
  let annotation = null;

  function clearAnnotation() {
    if (!annotation) return;
    cancelAnimationFrame(annotation.raf);
    clearTimeout(annotation.timer);
    annotation.root.remove();
    annotation = null;
  }

  // source: a Range (text evidence) or a function returning {r, first} rects (visual evidence)
  // opts.sign: exact sign text; opts.persist: stay until replaced/cleared (guide steps)
  function annotate(source, citeId, label = '', opts = {}) {
    clearAnnotation();
    const color = getColorForId(citeId).border;
    const NS = 'http://www.w3.org/2000/svg';

    if (!document.getElementById('pg-annot-style')) {
      const st = document.createElement('style');
      st.id = 'pg-annot-style';
      st.textContent = `
        @keyframes pg-pulse { 0%,100% { box-shadow: 0 0 0 0 var(--pg-c); } 50% { box-shadow: 0 0 0 9px transparent; } }
        @keyframes pg-bob-r { 0%,100% { translate: 0 0; } 50% { translate: -10px 0; } }
        @keyframes pg-bob-l { 0%,100% { translate: 0 0; } 50% { translate: 10px 0; } }
        @keyframes pg-bob-d { 0%,100% { translate: 0 0; } 50% { translate: 0 -10px; } }
        #pg-annot-root { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; transition: opacity .5s; }
        #pg-annot-root .pg-box { position: fixed; border: 3px solid var(--pg-c); border-radius: 6px; animation: pg-pulse 1.1s ease-in-out infinite; }
        #pg-annot-root .pg-arrow { position: fixed; width: 90px; height: 56px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
        #pg-annot-root .pg-sign { position: fixed; max-width: 260px; padding: 6px 12px; border-radius: 8px; background: var(--pg-c); color: #fff;
          font: 700 14px/1.3 -apple-system, system-ui, sans-serif; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4); pointer-events: auto; }
        #pg-annot-root .pg-sign b { cursor: pointer; margin-left: 8px; opacity: .8; }`;
      document.head.appendChild(st);
    }

    const root = document.createElement('div');
    root.id = 'pg-annot-root';
    root.style.setProperty('--pg-c', color);

    const box = document.createElement('div');
    box.className = 'pg-box';

    const arrow = document.createElementNS(NS, 'svg');
    arrow.setAttribute('class', 'pg-arrow');
    arrow.setAttribute('viewBox', '0 0 90 56');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M2 20 H52 V4 L88 28 L52 52 V36 H2 Z');  // block arrow pointing right
    path.setAttribute('fill', color);
    path.setAttribute('stroke', '#fff');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linejoin', 'round');
    arrow.appendChild(path);

    const sign = document.createElement('div');
    sign.className = 'pg-sign';
    sign.append(opts.sign || (label ? `Evidence ${citeId}: ${label}` : `Evidence ${citeId}`));
    if (!opts.persist) {
      const close = document.createElement('b');
      close.textContent = '\u00d7';
      close.addEventListener('click', clearAnnotation);
      sign.appendChild(close);
    }

    root.append(box, arrow, sign);
    document.documentElement.appendChild(root);

    const place = () => {
      let r, first;
      if (typeof source === 'function') {
        const m = source();
        // target gone (e.g. a menu closed): hide the pointer rather than leave it stale
        for (const part of [box, arrow, sign]) part.style.display = m ? '' : 'none';
        if (!m) return;
        ({ r, first } = m);
        box.style.background = 'color-mix(in srgb, var(--pg-c) 14%, transparent)';
      } else {
        const rects = source.getClientRects();
        r = source.getBoundingClientRect();
        if (!rects.length || (!r.width && !r.height)) return;
        first = rects[0];
      }
      const pad = 4;
      Object.assign(box.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });

      const aw = 90, ah = 56;
      const midY = first.top + first.height / 2;
      if (first.left > aw + 20) {
        // arrow comes from the left, pointing right at the first line
        arrow.style.transform = '';
        arrow.style.left = first.left - aw - 8 + 'px';
        arrow.style.top = midY - ah / 2 + 'px';
        arrow.style.animation = 'pg-bob-r 0.9s ease-in-out infinite';
        sign.style.left = Math.max(8, first.left - aw - 8) + 'px';
        sign.style.top = Math.max(8, midY - ah / 2 - 44) + 'px';
      } else if (first.top > aw + 60) {
        // no room on the left, but enough above: point down at the evidence
        arrow.style.left = first.left + first.width / 2 - aw / 2 + 'px';
        arrow.style.top = Math.max(4, first.top - aw - 6) + 'px';
        arrow.style.transform = 'rotate(90deg)';
        arrow.style.animation = 'pg-bob-d 0.9s ease-in-out infinite';
        sign.style.left = Math.max(8, first.left) + 'px';
        sign.style.top = Math.max(8, first.top - aw - 52) + 'px';
      } else {
        // Evidence near the top-left (common in Sheets): use the open space on
        // the right instead of covering the cell with an arrow and sign.
        arrow.style.left = Math.min(innerWidth - aw - 4, first.right + 8) + 'px';
        arrow.style.top = midY - ah / 2 + 'px';
        arrow.style.transform = 'rotate(180deg)';
        arrow.style.animation = 'pg-bob-l 0.9s ease-in-out infinite';
        sign.style.left = Math.min(innerWidth - 268, first.right + 8) + 'px';
        sign.style.top = Math.max(8, midY - ah / 2 - 44) + 'px';
      }
    };

    const state = { root, raf: 0, timer: 0 };
    const tick = () => { place(); state.raf = requestAnimationFrame(tick); };  // follow the text while it scrolls
    state.raf = requestAnimationFrame(tick);
    if (!opts.persist) {
      state.timer = setTimeout(() => {
        root.style.opacity = '0';
        state.timer = setTimeout(clearAnnotation, 600);
      }, 7000);
    }
    annotation = state;
  }


  // ---- Visual evidence: boxes on images, canvases, maps, charts, video ----
  // Link form: #pg-box=ymin,xmin,ymax,xmax&img=hint&label=text  (0-1000, Gemini's box format)
  const VISUAL_SELECTOR = 'img, canvas, video, svg, picture, [role="img"], .leaflet-container, .gm-style, .mapboxgl-map, [class*="map" i], [aria-label*="map" i]';

  function findVisuals() {
    const out = [];
    (function walk(root) {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
      for (const el of root.querySelectorAll(VISUAL_SELECTOR)) out.push(el);
    })(document);
    return out.filter(el => el.id !== 'pg-annot-root' && !el.closest('#pg-annot-root') && !isHidden(el));
  }

  function visibleArea(rect) {
    const w = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
    const h = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
    return Math.max(0, w) * Math.max(0, h);
  }

  function pickVisual(hint) {
    const h = (hint || '').toLowerCase();
    let best = null, bestScore = 0;
    for (const el of findVisuals()) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      const hay = [el.getAttribute('alt'), el.getAttribute('src'), el.getAttribute('aria-label'), el.getAttribute('title'), el.id, typeof el.className === 'string' ? el.className : '']
        .join(' ').toLowerCase();
      let score = visibleArea(rect) + rect.width * rect.height * 0.001;
      if (h && hay.includes(h)) score += 1e9;       // named by Gemini: strongest signal
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  // Rendered content rectangle (accounts for object-fit letterboxing on img/video)
  function contentRect(el) {
    const rect = el.getBoundingClientRect();
    const nw = el.naturalWidth || el.videoWidth, nh = el.naturalHeight || el.videoHeight;
    const fit = getComputedStyle(el).objectFit;
    if (!nw || !nh || !(fit === 'contain' || fit === 'scale-down')) return rect;
    const scale = Math.min(rect.width / nw, rect.height / nh);
    const w = nw * scale, h = nh * scale;
    return { left: rect.left + (rect.width - w) / 2, top: rect.top + (rect.height - h) / 2, width: w, height: h };
  }

  function parseBoxLink(href) {
    const m = href.match(/pg-box=([\d.\s,]+)/i);
    if (!m) return null;
    const n = m[1].split(',').map(Number);
    if (n.length !== 4 || n.some(isNaN)) return null;
    const [y1, x1, y2, x2] = n;
    const get = (k) => { const v = href.match(new RegExp('[#&]' + k + '=([^&]*)', 'i')); return v ? v[1].trim() : ''; };
    return { y1, x1, y2, x2, img: get('img'), label: get('label') };
  }

  function parseCellLink(href) {
    let value = href || '';
    if (!/[?#&]pg-cell=/i.test(value)) {
      try { value = decodeURIComponent(value); } catch (e) {}
    }
    try {
      const params = new URLSearchParams(new URL(value, location.href).hash.replace(/^#/, ''));
      const ref = params.get('pg-cell');
      if (!/^[A-Z]+\d+$/i.test(ref || '')) return null;
      return { ref: ref.toUpperCase(), label: (params.get('label') || '').trim() };
    } catch (e) {
      return null;
    }
  }

  function jumpToBox(citeId, spec, keepText = false) {
    if (!keepText && window.CSS && CSS.highlights) CSS.highlights.delete('pg-evidence');  // drop any earlier text highlight
    const el = pickVisual(spec.img);
    const clamp = (v) => Math.min(1000, Math.max(0, v)) / 1000;
    const measure = () => {
      const cr = el ? contentRect(el) : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const left = cr.left + clamp(Math.min(spec.x1, spec.x2)) * cr.width;
      const top = cr.top + clamp(Math.min(spec.y1, spec.y2)) * cr.height;
      const right = cr.left + clamp(Math.max(spec.x1, spec.x2)) * cr.width;
      const bottom = cr.top + clamp(Math.max(spec.y1, spec.y2)) * cr.height;
      const r = { left, top, right, bottom, width: right - left, height: bottom - top };
      return { r, first: r };
    };
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const { r } = measure();
      const dy = r.top + r.height / 2 - innerHeight / 2;
      if (Math.abs(dy) > 40) window.scrollBy(0, dy);   // centre the box itself when the image is taller than the screen
    }
    annotate(measure, citeId, spec.label);
  }

  // ---- Step-by-step UI guide ----
  // Link form: #pg-guide=1&step=<UI label>~<instruction>&step=...
  // Each step points at a real control on the live page (a menu, button, tab...).
  // The overlay is click-through, so the user performs the action themselves;
  // clicking the highlighted control advances to the next step.
  const GUIDE_MAX_STEPS = 12;
  const GUIDE_INTERACTIVE = 'a, button, input, select, summary, label, li, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="option"], [role="checkbox"], [role="link"], [role="switch"], [tabindex], [aria-label], [data-tooltip], [title]';
  let guide = null;

  function parseGuideLink(href) {
    let value = href || '';
    if (!/[#&]pg-guide=/i.test(value)) { try { value = decodeURIComponent(value); } catch (e) {} }
    try {
      const params = new URLSearchParams(new URL(value, location.href).hash.replace(/^#/, ''));
      if (!params.has('pg-guide')) return null;
      const steps = params.getAll('step').slice(0, GUIDE_MAX_STEPS).map((s) => {
        const cut = s.indexOf('~');
        const target = (cut === -1 ? s : s.slice(0, cut)).trim().slice(0, 80);
        const say = (cut === -1 ? '' : s.slice(cut + 1)).trim().slice(0, 240);
        return { target, say };
      }).filter(s => s.target);
      return steps.length ? { steps } : null;
    } catch (e) {
      return null;
    }
  }

  const guideNorm = (s) => String(s || '').toLowerCase().replace(/[….]+\s*$/, '').replace(/\s+/g, ' ').trim();

  // Best visible control whose accessible name or text matches the label.
  // Returns null (never a guess) when nothing matches well enough.
  function findGuideTarget(label) {
    const want = guideNorm(label);
    if (!want) return null;
    let best = null, bestScore = 0, bestArea = Infinity;
    const consider = (el) => {
      if (el.closest('#pg-annot-root, #pg-guide-root')) return;
      const names = [el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.getAttribute('title'), el.getAttribute('alt')];
      if (el.childElementCount < 6) {
        const text = el.textContent;
        if (text && text.length <= 120) names.push(text);
      }
      let score = 0;
      for (const raw of names) {
        const n = guideNorm(raw);
        if (!n) continue;
        let s = 0;
        if (n === want) s = 100;
        else if (n.startsWith(want)) s = 70 - Math.min(25, (n.length - want.length) / 3);
        else if (new RegExp(`(^|[^\\p{L}\\p{N}])${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(n)) s = 40 - Math.min(20, (n.length - want.length) / 4);
        score = Math.max(score, s);
      }
      if (score < 30) return;
      if (isHidden(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4 || visibleArea(rect) <= 0) return;
      const area = rect.width * rect.height;
      if (area > innerWidth * innerHeight * 0.6) return;   // a page-sized container is never "the button"
      if (score > bestScore || (score === bestScore && area < bestArea)) { best = el; bestScore = score; bestArea = area; }
    };
    (function walk(root) {
      for (const el of root.querySelectorAll(GUIDE_INTERACTIVE)) {
        consider(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    })(document);
    return best;
  }

  function ensureGuideStyle() {
    if (document.getElementById('pg-guide-style')) return;
    const st = document.createElement('style');
    st.id = 'pg-guide-style';
    st.textContent = `
      #pg-guide-root { position: fixed; left: 50%; bottom: 72px; translate: -50% 0; z-index: 2147483647; width: min(420px, calc(100vw - 24px));
        box-sizing: border-box; padding: 12px 14px; border-radius: 12px; background: #1f1f1f; color: #fff; border: 2px solid #e86f00;
        box-shadow: 0 6px 22px rgba(0,0,0,.45); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #pg-guide-root .pg-g-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: #ffb066; margin-bottom: 4px; }
      #pg-guide-root .pg-g-say { font-size: 15px; font-weight: 600; }
      #pg-guide-root .pg-g-status { margin-top: 4px; font-size: 12.5px; color: #c9c9c9; min-height: 1em; }
      #pg-guide-root .pg-g-nav { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
      #pg-guide-root button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; background: #3a3a3a; color: #fff; font-weight: 600; font-size: 13px; }
      #pg-guide-root button:hover { background: #4a4a4a; }
      #pg-guide-root button.pg-g-primary { background: #e86f00; }
      #pg-guide-root button.pg-g-primary:hover { background: #ff8412; }
      #pg-guide-root button[disabled] { opacity: .4; cursor: default; }
      #pg-guide-root .pg-g-x { padding: 0 6px; background: none; font-size: 18px; line-height: 1; }`;
    document.head.appendChild(st);
  }

  function endGuide() {
    if (!guide) return;
    clearInterval(guide.poll);
    clearTimeout(guide.advance);
    document.removeEventListener('pointerdown', onGuidePointer, true);
    guide.root.remove();
    guide = null;
    clearAnnotation();
  }

  function startGuide({ steps }) {
    endGuide();
    clearAnnotation();
    if (window.CSS && CSS.highlights) CSS.highlights.delete('pg-evidence');
    ensureGuideStyle();

    const root = document.createElement('div');
    root.id = 'pg-guide-root';
    root.innerHTML = '<div class="pg-g-head"><span class="pg-g-step"></span><button class="pg-g-x" aria-label="Close guide">×</button></div>' +
      '<div class="pg-g-say"></div><div class="pg-g-status"></div>' +
      '<div class="pg-g-nav"><button class="pg-g-prev">Previous</button><button class="pg-g-next pg-g-primary">Next</button></div>';
    document.documentElement.appendChild(root);
    root.querySelector('.pg-g-x').addEventListener('click', endGuide);
    root.querySelector('.pg-g-prev').addEventListener('click', () => guide && showGuideStep(guide.i - 1));
    root.querySelector('.pg-g-next').addEventListener('click', () => guide && nextGuideStep());

    guide = { steps, i: 0, root, el: null, poll: 0, advance: 0, deadline: 0 };
    document.addEventListener('pointerdown', onGuidePointer, true);
    showGuideStep(0, true);
  }

  function nextGuideStep() {
    if (!guide) return;
    if (guide.i >= guide.steps.length - 1) finishGuide();
    else showGuideStep(guide.i + 1);
  }

  function finishGuide() {
    if (!guide) return;
    clearInterval(guide.poll);
    clearAnnotation();
    guide.root.querySelector('.pg-g-step').textContent = 'All done';
    guide.root.querySelector('.pg-g-say').textContent = 'You have completed all steps.';
    guide.root.querySelector('.pg-g-status').textContent = '';
    guide.root.querySelector('.pg-g-nav').style.display = 'none';
    const g = guide;
    setTimeout(() => { if (guide === g) endGuide(); }, 2200);
  }

  function showGuideStep(i, first = false) {
    if (!guide || i < 0 || i >= guide.steps.length) return;
    clearInterval(guide.poll);
    clearTimeout(guide.advance);
    clearAnnotation();
    const step = guide.steps[i];
    const total = guide.steps.length;
    guide.i = i;
    guide.el = null;
    // Sheets and other web apps load slowly after the tab is focused: wait longer on step 1.
    guide.deadline = Date.now() + (first ? 15000 : 8000);

    const { root } = guide;
    root.querySelector('.pg-g-step').textContent = `Step ${i + 1} of ${total}`;
    root.querySelector('.pg-g-say').textContent = step.say || step.target;
    root.querySelector('.pg-g-status').textContent = `Looking for “${step.target}”…`;
    root.querySelector('.pg-g-prev').disabled = i === 0;
    root.querySelector('.pg-g-next').textContent = i === total - 1 ? 'Done' : 'Next';

    const g = guide;
    const attach = () => {
      if (guide !== g || g.i !== i) return true;
      const el = findGuideTarget(step.target);
      if (!el) {
        if (Date.now() > g.deadline) {
          root.querySelector('.pg-g-status').textContent =
            `Couldn’t find “${step.target}” on screen. Follow the instruction above, then press ${i === total - 1 ? 'Done' : 'Next'}.`;
          return true;
        }
        return false;
      }
      g.el = el;
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > innerHeight) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      root.querySelector('.pg-g-status').textContent = 'Click the highlighted control.';
      let lastLookup = 0;
      annotate(() => {
        // controls such as menu items are re-created when a menu reopens: re-find, throttled
        if (!g.el.isConnected || isHidden(g.el)) {
          if (Date.now() - lastLookup > 300) { lastLookup = Date.now(); g.el = findGuideTarget(step.target) || g.el; }
          if (!g.el.isConnected || isHidden(g.el)) return null;
        }
        const r = g.el.getBoundingClientRect();
        return r.width ? { r, first: r } : null;
      }, i + 1, '', { sign: `Step ${i + 1} of ${total}`, persist: true });
      return true;
    };
    if (!attach()) g.poll = setInterval(() => { if (attach()) clearInterval(g.poll); }, 300);
  }

  // The overlay never intercepts clicks. When the user clicks the highlighted
  // control themselves, move on once the page has reacted (menu opened, etc.).
  function onGuidePointer(e) {
    if (!guide || !guide.el) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.some(n => n && n.id === 'pg-guide-root')) return;
    if (!path.includes(guide.el)) return;
    clearTimeout(guide.advance);
    guide.advance = setTimeout(nextGuideStep, 350);
  }

  // Google Workspace evidence is shown in a DOM-based read-only view because
  // the normal editors paint their content onto canvases. Give users an
  // explicit route back instead of relying on them to discover browser Back.
  function workspaceEditorUrl() {
    if (location.hostname !== 'docs.google.com') return '';
    const m = location.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)\/(mobilebasic|htmlview|htmlpresent)/i);
    if (!m) return '';
    const [, type, id] = m;
    if (type === 'document') return `https://docs.google.com/document/d/${id}/edit`;
    if (type === 'spreadsheets') {
      const gid = new URL(location.href).searchParams.get('gid');
      return `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `?gid=${encodeURIComponent(gid)}#gid=${encodeURIComponent(gid)}` : ''}`;
    }
    const slide = new URL(location.href).searchParams.get('slide');
    return `https://docs.google.com/presentation/d/${id}/edit${slide ? `?slide=${encodeURIComponent(slide)}#slide=${encodeURIComponent(slide)}` : ''}`;
  }

  function addBackToEditorButton() {
    if (window !== window.top || document.getElementById('pg-back-to-editor')) return;
    const editorUrl = workspaceEditorUrl();
    if (!editorUrl) return;
    const button = document.createElement('a');
    button.id = 'pg-back-to-editor';
    button.href = editorUrl;
    button.textContent = '\u2190 Back to editor';
    button.setAttribute('aria-label', 'Back to Google editor');
    Object.assign(button.style, {
      position: 'fixed', top: '12px', right: '16px', zIndex: '2147483647',
      padding: '9px 14px', borderRadius: '999px', background: '#e86f00', color: '#fff',
      font: '700 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textDecoration: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.28)', cursor: 'pointer'
    });
    document.documentElement.appendChild(button);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addBackToEditorButton, { once: true });
  } else {
    addBackToEditorButton();
  }

  function isSheetsReadableViewContainer() {
    return window === window.top &&
      location.hostname === 'docs.google.com' &&
      /^\/spreadsheets\/d\/[^/]+\/htmlview\/?$/i.test(location.pathname);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EXECUTE_JUMP_AND_HIGHLIGHT') {
      const { citeId, quote, box, cell, guide: guideSpec } = message.payload;
      if (guideSpec) {
        // Guides act on the live page's own UI, so only the top frame runs one.
        if (window === window.top) startGuide(guideSpec);
        return;
      }
      // tabs.sendMessage reaches every frame. In Sheets' readable view, the
      // outer frame contains UI labels such as "Sheet1", while the nested
      // /htmlview/sheet frame contains the actual cells. Let only the content
      // frame process text so short values cannot highlight unrelated UI.
      if ((quote || cell) && isSheetsReadableViewContainer()) return;
      const spec = box && parseBoxLink(box);
      // a link may carry both: highlight the text AND box the same thing on the map/image
      if (cell) jumpToSheetCell(citeId, cell);
      else if (quote) jumpToEvidence(citeId, quote);
      if (spec) jumpToBox(citeId, spec, !!quote);
      else if (!quote && !cell) jumpToEvidence(citeId, quote);
    }
  });

  // Intercept clicks using composedPath() to pierce Gemini's Shadow DOM
  const onCitationClick = (e) => {
    const path = e.composedPath ? e.composedPath() : [];
    const link = path.find(el => el && el.tagName === 'A' && el.getAttribute && el.getAttribute('href'));

    if (!link) return;

    const href = link.href || link.getAttribute('href') || '';
    let decodedHref = href; try { decodedHref = decodeURIComponent(href); } catch (e) {}
    // PDFs: let Chrome open the link natively so its viewer highlights; background dedupes the tab
    if (/\.pdf($|[?#])|arxiv\.org\/pdf\//i.test(href)) return;
    if (decodedHref.includes(':~:text=') || /pg-box=|pg-cell=|pg-guide=/i.test(decodedHref)) {
      // STOP browser from opening new tab
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const matchId = (link.textContent || '').match(/\d+/);
      const citeId = matchId ? matchId[0] : '1';
      const targetText = decodedHref.includes(':~:text=') ? decodedHref.split(':~:text=')[1].split('&')[0] : '';

      chrome.runtime.sendMessage({
        type: 'NAVIGATE_OR_FOCUS_TAB',
        payload: {
          targetUrl: href,
          citeId: citeId,
          quote: targetText,
          box: /pg-box=/i.test(decodedHref) ? decodedHref : '',
          cell: parseCellLink(href),
          guide: parseGuideLink(href)
        }
      });
    }
  };
  // click plus auxclick (middle-click) and pointer/mouse down are all used to open links
  window.addEventListener('click', onCitationClick, true);
  window.addEventListener('auxclick', onCitationClick, true);
})();
