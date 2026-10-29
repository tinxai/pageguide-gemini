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
      let paired = false;
      if (parts[1]) {
        for (const ei of occurrences(flat.slice(e), parts[1])) {
          const end = e + ei + parts[1].length;
          if (map[end - 1].block === map[s].block) { e = end; paired = true; break; }
        }
      }
      candidates.push({ s, e, paired, landmark: map[s].landmark });
    }
    if (!candidates.length && parts[1]) {  // start words missing: use the end words alone
      for (const s of occurrences(flat, parts[1])) candidates.push({ s, e: s + parts[1].length, paired: false, landmark: map[s].landmark });
    }
    if (!candidates.length) { console.debug('[PageGuide] no match for', parts[0]); return null; }

    // best: paired start/end > unpaired; main content > landmark; then document order
    candidates.sort((x, y) => (y.paired - x.paired) || (x.landmark - y.landmark) || (x.s - y.s));
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

  function annotate(range, citeId) {
    clearAnnotation();
    const color = getColorForId(citeId).border;
    const NS = 'http://www.w3.org/2000/svg';

    if (!document.getElementById('pg-annot-style')) {
      const st = document.createElement('style');
      st.id = 'pg-annot-style';
      st.textContent = `
        @keyframes pg-pulse { 0%,100% { box-shadow: 0 0 0 0 var(--pg-c); } 50% { box-shadow: 0 0 0 9px transparent; } }
        @keyframes pg-bob-r { 0%,100% { translate: 0 0; } 50% { translate: -10px 0; } }
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
    sign.append(`Evidence ${citeId}`);
    const close = document.createElement('b');
    close.textContent = '\u00d7';
    close.addEventListener('click', clearAnnotation);
    sign.appendChild(close);

    root.append(box, arrow, sign);
    document.documentElement.appendChild(root);

    const place = () => {
      const rects = range.getClientRects();
      const r = range.getBoundingClientRect();
      if (!rects.length || (!r.width && !r.height)) return;
      const first = rects[0];
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
      } else {
        // no room on the left: arrow comes from above, pointing down
        arrow.style.left = first.left + first.width / 2 - aw / 2 + 'px';
        arrow.style.top = first.top - aw - 6 + 'px';
        arrow.style.transform = 'rotate(90deg)';
        arrow.style.animation = 'pg-bob-d 0.9s ease-in-out infinite';
        sign.style.left = Math.max(8, first.left) + 'px';
        sign.style.top = Math.max(8, first.top - aw - 52) + 'px';
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EXECUTE_JUMP_AND_HIGHLIGHT') {
      const { citeId, quote } = message.payload;
      jumpToEvidence(citeId, quote);
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
    if (decodedHref.includes(':~:text=')) {
      // STOP browser from opening new tab
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const matchId = (link.textContent || '').match(/\d+/);
      const citeId = matchId ? matchId[0] : '1';
      const targetText = decodedHref.split(':~:text=')[1].split('&')[0];

      chrome.runtime.sendMessage({
        type: 'NAVIGATE_OR_FOCUS_TAB',
        payload: {
          targetUrl: href,
          citeId: citeId,
          quote: targetText
        }
      });
    }
  };
  // click plus auxclick (middle-click) and pointer/mouse down are all used to open links
  window.addEventListener('click', onCitationClick, true);
  window.addEventListener('auxclick', onCitationClick, true);
})();
