// background.js - Robust cross-tab locator
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const workspace = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/i);
    if (u.hostname === 'docs.google.com' && workspace) {
      // Treat an editor URL and its text-readable view as the same open file.
      return `docs.google.com/${workspace[1].toLowerCase()}/d/${workspace[2]}`;
    }
    // Strip hash, query params, trailing slashes, and 'www.'
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/+$/, '').toLowerCase();
  } catch (e) {
    return url.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
  }
}

// Google Workspace editors paint document content onto canvases, so there are
// no DOM text nodes for CSS text highlights. Their read-only views expose the
// same content as real text. Keep using the existing tab, but switch that tab
// to the corresponding readable view before applying the highlight.
function googleWorkspaceViewUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'docs.google.com') return '';
    const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/i);
    if (!m) return '';
    const type = m[1].toLowerCase(), id = m[2];
    if (type === 'document') return `https://docs.google.com/document/d/${id}/mobilebasic`;
    if (type === 'spreadsheets') {
      const hashGid = u.hash.match(/(?:^#|[&#])gid=([^&]+)/i);
      const gid = u.searchParams.get('gid') || (hashGid && hashGid[1]);
      return `https://docs.google.com/spreadsheets/d/${id}/htmlview${gid ? `?gid=${encodeURIComponent(gid)}` : ''}`;
    }
    const slide = u.searchParams.get('slide');
    return `https://docs.google.com/presentation/d/${id}/htmlpresent${slide ? `?slide=${encodeURIComponent(slide)}` : ''}`;
  } catch (e) {
    return '';
  }
}


// Inverse of googleWorkspaceViewUrl: guides point at the live editor's own UI,
// so a tab left in a read-only view by an earlier citation must go back to it.
function googleWorkspaceEditorUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'docs.google.com') return '';
    const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)\/(mobilebasic|htmlview|htmlpresent)/i);
    if (!m) return '';
    const [, type, id] = m;
    if (type.toLowerCase() === 'spreadsheets') {
      const gid = u.searchParams.get('gid');
      return `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `?gid=${encodeURIComponent(gid)}#gid=${encodeURIComponent(gid)}` : ''}`;
    }
    return `https://docs.google.com/${type.toLowerCase()}/d/${id}/edit`;
  } catch (e) {
    return '';
  }
}

// Step-by-step guide link: #pg-guide=1&step=<UI label>~<instruction>&step=...
function parseGuideLink(url) {
  let value = url || '';
  if (!/[#&]pg-guide=/i.test(value)) { try { value = decodeURIComponent(value); } catch (e) {} }
  try {
    const params = new URLSearchParams(new URL(value).hash.replace(/^#/, ''));
    if (!params.has('pg-guide')) return null;
    const steps = params.getAll('step').slice(0, 12).map((s) => {
      const cut = s.indexOf('~');
      return {
        target: (cut === -1 ? s : s.slice(0, cut)).trim().slice(0, 80),
        say: (cut === -1 ? '' : s.slice(cut + 1)).trim().slice(0, 240)
      };
    }).filter(step => step.target);
    return steps.length ? { steps } : null;
  } catch (e) {
    return null;
  }
}

// Deliver the highlight request; if the page has no content script yet
// (tab opened before the extension was reloaded), inject it and retry.
function sendHighlight(tabId, payload, attempt = 0) {
  chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_JUMP_AND_HIGHLIGHT', payload }, () => {
    if (!chrome.runtime.lastError) return;
    if (attempt >= 3) { console.warn('[PageGuide] could not highlight in tab', tabId, chrome.runtime.lastError.message); return; }
    chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => sendHighlight(tabId, payload, attempt + 1), 400);
    });
  });
}

const isPdfUrl = (u) => /\.pdf($|[?#])|arxiv\.org\/pdf\//i.test(u || '');

// Chrome's PDF viewer blocks extension scripts but understands #:~:text= natively,
// so for PDFs hand the full URL to the existing tab and let Chrome highlight.
function showEvidence(tab, fullUrl, citeId, quote, box, cell, guide) {
  if (guide) {
    // Guides run on the live page, never on a read-only view or a PDF.
    const editorUrl = googleWorkspaceEditorUrl(tab.url);
    if (editorUrl) {
      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => sendHighlight(tab.id, { citeId, guide }), 600);
      };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tab.id, { url: editorUrl }, () => void chrome.runtime.lastError);
    } else {
      sendHighlight(tab.id, { citeId, guide });
    }
    return;
  }
  if (isPdfUrl(tab.url)) {
    chrome.tabs.update(tab.id, { url: fullUrl }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => chrome.tabs.reload(tab.id, () => void chrome.runtime.lastError), 250);
    });
  } else {
    const workspaceView = googleWorkspaceViewUrl(fullUrl);
    if (workspaceView && tab.url !== workspaceView) {
      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => sendHighlight(tab.id, { citeId, quote, box, cell }), 350);
      };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tab.id, { url: workspaceView }, () => void chrome.runtime.lastError);
    } else {
      sendHighlight(tab.id, { citeId, quote, box, cell });
    }
  }
}

// Visual evidence link: #pg-box=ymin,xmin,ymax,xmax&img=hint&label=text (returns the decoded URL or '')
function parseBoxLink(url) {
  let u = url || '';
  try { u = decodeURIComponent(u); } catch (e) {}
  return /pg-box=/i.test(u) ? u : '';
}

// Exact Google Sheets cell evidence: #pg-cell=C4&label=visible%20value
function parseCellLink(url) {
  let value = url || '';
  if (!/[?#&]pg-cell=/i.test(value)) {
    try { value = decodeURIComponent(value); } catch (e) {}
  }
  try {
    const params = new URLSearchParams(new URL(value).hash.replace(/^#/, ''));
    const ref = params.get('pg-cell');
    if (!/^[A-Z]+\d+$/i.test(ref || '')) return null;
    return { ref: ref.toUpperCase(), label: (params.get('label') || '').trim() };
  } catch (e) {
    return null;
  }
}

function parseTextFragment(url) {
  let u = url || '';
  try { u = decodeURIComponent(u); } catch (e) {}
  const m = u.match(/:~:text=([^&]+)/);
  if (!m) return '';
  // keep "start,end" (drop prefix-/-suffix context terms)
  return m[1].split(',').filter(p => !p.endsWith('-') && !p.startsWith('-')).join(',');
}

// Safety net: if a citation click slips past the content script and Chrome opens
// the link in a new tab, close it and reuse the tab that already has the page.
chrome.tabs.onCreated.addListener((newTab) => {
  const url = newTab.pendingUrl || newTab.url;
  if (!url || !/^(https?|file):/.test(url) || !/:~:text=|%3A~%3Atext=|pg-box=|pg-box%3D|pg-cell=|pg-cell%3D|pg-guide=|pg-guide%3D/i.test(url)) return;
  const clean = normalizeUrl(url);
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(t => t.id !== newTab.id && t.url && normalizeUrl(t.url) === clean);
    if (!existing) return;
    if (!/pg-guide/i.test(url) && (isPdfUrl(url) || isPdfUrl(existing.url))) {
      // Chrome only highlights #:~:text= when a click opens the page, so keep the
      // freshly opened tab and drop the stale one: still a single tab, now highlighted.
      chrome.tabs.update(newTab.id, { active: true }, () => {
        void chrome.runtime.lastError;
        chrome.tabs.remove(existing.id, () => void chrome.runtime.lastError);
      });
      return;
    }
    chrome.tabs.remove(newTab.id, () => {
      void chrome.runtime.lastError;
      chrome.tabs.update(existing.id, { active: true }, () => {
        chrome.windows.update(existing.windowId, { focused: true });
        showEvidence(existing, url, '1', parseTextFragment(url), parseBoxLink(url), parseCellLink(url), parseGuideLink(url));
      });
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NAVIGATE_OR_FOCUS_TAB') {
    const { targetUrl, citeId, quote, box, cell, guide } = message.payload;
    const cleanTarget = normalizeUrl(targetUrl);

    chrome.tabs.query({}, (tabs) => {
      // 1. First try: Exact or normalized URL match
      let targetTab = tabs.find(t => t.id !== sender.tab?.id && normalizeUrl(t.url) === cleanTarget);

      // 2. Second try: Partial path match (e.g. arXiv abstract vs HTML/PDF view)
      if (!targetTab && cleanTarget) {
        targetTab = tabs.find(t => t.id !== sender.tab?.id && (
          normalizeUrl(t.url) && (normalizeUrl(t.url).includes(cleanTarget) || cleanTarget.includes(normalizeUrl(t.url)))
        ));
      }

      if (targetTab) {
        // Switch to the existing tab without opening a new tab
        chrome.tabs.update(targetTab.id, { active: true }, () => {
          chrome.windows.update(targetTab.windowId, { focused: true }, () => {
            showEvidence(targetTab, targetUrl, citeId, quote, box, cell, guide);
          });
        });
      } else {
        // Only if no relevant tab exists anywhere, open target
        chrome.tabs.create({ url: guide ? targetUrl : (googleWorkspaceViewUrl(targetUrl) || targetUrl) }, (newTab) => {
          const listener = (tabId, info) => {
            if (tabId === newTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(() => {
                sendHighlight(newTab.id, guide ? { citeId, guide } : { citeId, quote, box, cell });
              }, guide ? 1500 : 600);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });

    sendResponse({ status: 'OK' });
    return true;
  }
});
