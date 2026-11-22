// Element Zapper v2.0.0 (Background Service Worker)
const EZ_VERSION = "2.0.0";
const queues = new Map();

function buildCss(rules = []) {
  if (!rules.length) return "";
  return rules
    .map(
      (rule) =>
        `${rule.selector} { display: none !important; visibility: hidden !important; }`
    )
    .join("\n");
}

function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(task, task).finally(() => {
    if (queues.get(key) === next) {
      queues.delete(key);
    }
  });
  queues.set(key, next);
  return next;
}

async function syncTabCss(tabId, frameId, hostname, docId) {
  const sessionKey = `ez_css_${tabId}_${frameId}`;

  return enqueue(sessionKey, async () => {
    const stored = await chrome.storage.local.get([hostname]);
    const rules = stored[hostname] || [];
    const newCss = buildCss(rules);

    const sessionData = await chrome.storage.session.get([sessionKey]);
    const prev = sessionData[sessionKey];

    if (prev && prev.docId === docId && prev.css === newCss) {
      return { ok: true, count: rules.length, version: EZ_VERSION };
    }

    const target = { tabId, frameIds: [frameId] };

    if (prev && prev.docId === docId && prev.css) {
      try {
        await chrome.scripting.removeCSS({
          target,
          css: prev.css,
          origin: "USER"
        });
      } catch {
        // Tab or frame may have navigated away
      }
    }

    if (newCss) {
      try {
        await chrome.scripting.insertCSS({
          target,
          css: newCss,
          origin: "USER"
        });
      } catch {
        return { ok: false, version: EZ_VERSION };
      }
    }

    await chrome.storage.session.set({
      [sessionKey]: { docId, css: newCss }
    });

    return { ok: true, count: rules.length, version: EZ_VERSION };
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  // Clear stale session tracking after extension install or upgrade
  try {
    await chrome.storage.session.clear();
  } catch {
    // Ignore if session storage is unavailable
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SYNC_TAB_CSS" && sender.tab && typeof sender.tab.id === "number") {
    const tabId = sender.tab.id;
    const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
    syncTabCss(tabId, frameId, msg.hostname, msg.docId)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false, version: EZ_VERSION }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const all = await chrome.storage.session.get(null);
  const prefix = `ez_css_${tabId}_`;
  const toRemove = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (toRemove.length) {
    await chrome.storage.session.remove(toRemove);
  }
});