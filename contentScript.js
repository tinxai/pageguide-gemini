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

  function collectText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = []; let text = ''; let n;
    while ((n = walker.nextNode())) { nodes.push({ node: n, start: text.length }); text += n.textContent + ' '; }
    return { nodes, text };
  }

  // Build a letters/numbers-only lowercase string plus a map back to (node, offset),
  // so punctuation, whitespace and quote-style differences never break a match.
  function buildIndex() {
    const { nodes } = collectText();
    let flat = ''; const map = [];
    for (const { node } of nodes) {
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        if (/[\p{L}\p{N}]/u.test(t[i])) { flat += t[i].toLowerCase(); map.push({ node, off: i }); }
      }
    }
    return { flat, map };
  }

  const alnum = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).join('').toLowerCase();

  // quote is "start" or "start,end" (text-fragment range); matches across nodes
  function buildRange(quote) {
    let q = quote; try { q = decodeURIComponent(quote); } catch (e) {}
    const parts = q.split(',').map(alnum).filter(Boolean);
    if (!parts.length) return null;
    const { flat, map } = buildIndex();
    let s = flat.indexOf(parts[0]);
    if (s === -1 && parts[1]) { s = flat.indexOf(parts[1]); parts.length = 1; }  // start missing: fall back to end
    if (s === -1) { console.debug('[PageGuide] no match for', parts[0]); return null; }
    let e = s + parts[0].length;
    if (parts[1]) {
      const ei = flat.indexOf(parts[1], e);
      if (ei !== -1) e = ei + parts[1].length;
    }
    const a = map[s], b = map[e - 1];
    if (!a || !b) return null;
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
      if (!document.getElementById('pg-hl-style')) {
        const st = document.createElement('style'); st.id = 'pg-hl-style';
        st.textContent = '::highlight(pg-evidence){background-color:rgba(255,224,102,.65);color:inherit}';
        document.head.appendChild(st);
      }
      let hl = CSS.highlights.get('pg-evidence');
      if (!hl) { hl = new Highlight(); CSS.highlights.set('pg-evidence', hl); }
      hl.add(range);  // accumulate: keep earlier citations highlighted
    } else {
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    const el = range.startContainer.parentElement;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
