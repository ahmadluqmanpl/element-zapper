// Element Zapper v2.0.0 (Popup Controller)
const EZ_VERSION = chrome.runtime.getManifest().version || "2.0.0";

document.addEventListener("DOMContentLoaded", async () => {
  const versionBadge = document.getElementById("version-badge");
  const footerVersion = document.getElementById("footer-version");
  const siteDot = document.getElementById("site-dot");
  const siteBadge = document.getElementById("site-badge");
  const restrictedNotice = document.getElementById("restricted-notice");
  const errorBanner = document.getElementById("error-banner");
  const mainContent = document.getElementById("main-content");
  const pickBtn = document.getElementById("pick-btn");
  const manualForm = document.getElementById("manual-form");
  const manualInput = document.getElementById("manual-selector-input");
  const ruleCount = document.getElementById("rule-count");
  const rulesList = document.getElementById("rules-list");
  const emptyState = document.getElementById("empty-state");
  const clearAllBtn = document.getElementById("clear-all-btn");

  versionBadge.textContent = `v${EZ_VERSION}`;
  footerVersion.textContent = `v${EZ_VERSION}`;

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
  }

  function clearError() {
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    siteDot.classList.add("restricted");
    siteBadge.textContent = "Restricted";
    restrictedNotice.classList.remove("hidden");
    mainContent.classList.add("hidden");
    return;
  }

  const url = new URL(tab.url);
  const hostname = url.hostname;
  siteBadge.textContent = hostname;
  siteBadge.title = hostname;

  async function ensureContentScriptSynced() {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "SYNC_NOW" }, { frameId: 0 });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["content.js"]
        });
      } catch {
        // Ignore if tab cannot be scripted
      }
    }
  }

  function renderRules(rules = []) {
    ruleCount.textContent = rules.length;
    rulesList.replaceChildren();

    if (rules.length === 0) {
      emptyState.classList.remove("hidden");
      clearAllBtn.classList.add("hidden");
      return;
    }

    emptyState.classList.add("hidden");
    clearAllBtn.classList.remove("hidden");

    for (const rule of rules) {
      const li = document.createElement("li");
      li.className = "rule-item";

      const info = document.createElement("div");
      info.className = "rule-info";

      const top = document.createElement("div");
      top.className = "rule-top";

      const tag = document.createElement("span");
      tag.className = "rule-tag";
      tag.textContent = rule.tag || "ELEMENT";

      top.append(tag);

      if (rule.dimensions) {
        const dim = document.createElement("span");
        dim.className = "rule-dim";
        dim.textContent = `${rule.dimensions} px`;
        top.append(dim);
      }

      const sel = document.createElement("div");
      sel.className = "rule-selector";
      sel.textContent = rule.selector;
      sel.title = rule.selector;

      info.append(top, sel);

      const restoreBtn = document.createElement("button");
      restoreBtn.className = "restore-btn";
      restoreBtn.type = "button";
      restoreBtn.textContent = "Restore";
      restoreBtn.addEventListener("click", () => removeRule(rule.id));

      li.append(info, restoreBtn);
      rulesList.appendChild(li);
    }
  }

  function loadRules() {
    chrome.storage.local.get([hostname], (result) => {
      renderRules(result[hostname] || []);
    });
  }

  function removeRule(ruleId) {
    chrome.storage.local.get([hostname], (result) => {
      const updated = (result[hostname] || []).filter((r) => r.id !== ruleId);
      chrome.storage.local.set({ [hostname]: updated }, () => {
        renderRules(updated);
        ensureContentScriptSynced();
      });
    });
  }

  clearAllBtn.addEventListener("click", () => {
    chrome.storage.local.remove(hostname, () => {
      renderRules([]);
      ensureContentScriptSynced();
    });
  });

  manualForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();
    const selector = manualInput.value.trim();
    if (!selector) return;

    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      showError("Invalid CSS selector syntax.");
      return;
    }

    chrome.storage.local.get([hostname], (result) => {
      const existing = result[hostname] || [];
      if (existing.some((r) => r.selector === selector)) {
        manualInput.value = "";
        return;
      }
      const newRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        selector,
        tag: "CUSTOM",
        dimensions: "",
        createdAt: Date.now()
      };
      const updated = [newRule, ...existing];
      chrome.storage.local.set({ [hostname]: updated }, () => {
        manualInput.value = "";
        renderRules(updated);
        ensureContentScriptSynced();
      });
    });
  });

  pickBtn.addEventListener("click", async () => {
    clearError();
    try {
      let res;
      try {
        res = await chrome.tabs.sendMessage(
          tab.id,
          { type: "START_PICKER" },
          { frameId: 0 }
        );
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["content.js"]
        });
        res = await chrome.tabs.sendMessage(
          tab.id,
          { type: "START_PICKER" },
          { frameId: 0 }
        );
      }

      if (res && res.ok) {
        window.close();
      } else {
        showError(
          res?.error || "Could not start picker. Try refreshing the tab or using the manual input."
        );
      }
    } catch (err) {
      showError(`Could not attach to this tab (${err.message}).`);
    }
  });

  loadRules();
});