// background.js - Robust cross-tab locator
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Strip hash, query params, trailing slashes, and 'www.'
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/+$/, '').toLowerCase();
  } catch (e) {
    return url.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
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
function showEvidence(tab, fullUrl, citeId, quote, box) {
  if (isPdfUrl(tab.url)) {
    chrome.tabs.update(tab.id, { url: fullUrl }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => chrome.tabs.reload(tab.id, () => void chrome.runtime.lastError), 250);
    });
  } else {
    sendHighlight(tab.id, { citeId, quote, box });
  }
}

// Visual evidence link: #pg-box=ymin,xmin,ymax,xmax&img=hint&label=text (returns the decoded URL or '')
function parseBoxLink(url) {
  let u = url || '';
  try { u = decodeURIComponent(u); } catch (e) {}
  return /pg-box=/i.test(u) ? u : '';
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
  if (!url || !/^(https?|file):/.test(url) || !/:~:text=|%3A~%3Atext=|pg-box=|pg-box%3D/i.test(url)) return;
  const clean = normalizeUrl(url);
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(t => t.id !== newTab.id && t.url && normalizeUrl(t.url) === clean);
    if (!existing) return;
    if (isPdfUrl(url) || isPdfUrl(existing.url)) {
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
        showEvidence(existing, url, '1', parseTextFragment(url), parseBoxLink(url));
      });
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NAVIGATE_OR_FOCUS_TAB') {
    const { targetUrl, citeId, quote, box } = message.payload;
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
            showEvidence(targetTab, targetUrl, citeId, quote, box);
          });
        });
      } else {
        // Only if no relevant tab exists anywhere, open target
        chrome.tabs.create({ url: targetUrl }, (newTab) => {
          const listener = (tabId, info) => {
            if (tabId === newTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(() => {
                sendHighlight(newTab.id, { citeId, quote, box });
              }, 600);
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
