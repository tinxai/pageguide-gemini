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
      // Never let a single flattened match spill across table cells, cards, or
      // paragraphs. This is especially important for Google Sheets, where
      // adjacent cells such as "Product", "Unit", and "Cost" otherwise look
      // like one continuous string in the punctuation-insensitive index.
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
    // If a start/end range cannot be paired inside one block, prefer the end
    // words when they exist. In Sheets, Gemini may emit "Product,C" even
    // though Product is a header and C is the actual evidence cell; selecting
    // the end prevents the annotation from landing on the header.
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
      if (window.find) window.find(String(quoteText).split(',')[0], false, false, true);
      return;
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
  function annotate(source, citeId, label = '') {
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
    sign.append(label ? `Evidence ${citeId}: ${label}` : `Evidence ${citeId}`);
    const close = document.createElement('b');
    close.textContent = '\u00d7';
    close.addEventListener('click', clearAnnotation);
    sign.appendChild(close);

    root.append(box, arrow, sign);
    document.documentElement.appendChild(root);

    const place = () => {
      let r, first;
      if (typeof source === 'function') {
        const m = source();
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
    state.timer = setTimeout(() => {
      root.style.opacity = '0';
      state.timer = setTimeout(clearAnnotation, 600);
    }, 7000);
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EXECUTE_JUMP_AND_HIGHLIGHT') {
      const { citeId, quote, box } = message.payload;
      const spec = box && parseBoxLink(box);
      // a link may carry both: highlight the text AND box the same thing on the map/image
      if (quote) jumpToEvidence(citeId, quote);
      if (spec) jumpToBox(citeId, spec, !!quote);
      else if (!quote) jumpToEvidence(citeId, quote);
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
    if (decodedHref.includes(':~:text=') || /pg-box=/i.test(decodedHref)) {
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
          box: /pg-box=/i.test(decodedHref) ? decodedHref : ''
        }
      });
    }
  };
  // click plus auxclick (middle-click) and pointer/mouse down are all used to open links
  window.addEventListener('click', onCitationClick, true);
  window.addEventListener('auxclick', onCitationClick, true);
})();
