// Element Zapper v2.0.0 (Content Script & Stealth Inspector UI)
(() => {
  const EZ_VERSION = "2.0.0";
  if (window.__EZ_VERSION__ === EZ_VERSION) return;
  window.__EZ_VERSION__ = EZ_VERSION;

  const HOSTNAME = window.location.hostname || window.location.origin;
  const FALLBACK_STYLE_ID = "ez-fallback-blocked-styles";
  const DOC_ID =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const HOST_CSS_TEXT =
    [
      "all: initial !important",
      "display: block !important",
      "position: fixed !important",
      "inset: 0 !important",
      "width: 100vw !important",
      "height: 100vh !important",
      "margin: 0 !important",
      "padding: 0 !important",
      "border: 0 !important",
      "background: transparent !important",
      "overflow: visible !important",
      "pointer-events: none !important",
      "z-index: 2147483647 !important",
      "visibility: visible !important",
      "opacity: 1 !important",
      "clip: auto !important",
      "clip-path: none !important",
      "transform: none !important"
    ].join("; ") + ";";

  // State
  let mode = "idle"; // "idle" | "picking" | "inspecting"
  let hoveredEl = null;
  let selectedEl = null;
  let childStack = [];
  let inspectorSide = "right";
  let cssConfirmed = false;

  // Shadow DOM & watchdog references
  let shadowHost = null;
  let shadowRoot = null;
  let els = {};
  let preferBodyMount = true;
  let detachCount = 0;
  let guardObserver = null;
  let guardTimer = null;

  // =========================================================================
  // 1. PERSISTENT BLOCKING ENGINE (USER-origin CSS + Fallback)
  // =========================================================================

  function applyFallbackStyle(rules = []) {
    let styleEl = document.getElementById(FALLBACK_STYLE_ID);
    if (!rules.length) {
      if (styleEl) styleEl.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = FALLBACK_STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = rules
      .map(
        (rule) =>
          `${rule.selector} { display: none !important; visibility: hidden !important; }`
      )
      .join("\n");
  }

  function removeFallbackStyle() {
    const styleEl = document.getElementById(FALLBACK_STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  function syncBlockedCss() {
    if (!HOSTNAME) return;
    chrome.runtime.sendMessage(
      { type: "SYNC_TAB_CSS", hostname: HOSTNAME, docId: DOC_ID },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          cssConfirmed = false;
          chrome.storage.local.get([HOSTNAME], (stored) => {
            if (!chrome.runtime.lastError) {
              applyFallbackStyle(stored[HOSTNAME] || []);
            }
          });
        } else {
          cssConfirmed = true;
          removeFallbackStyle();
        }
      }
    );
  }

  syncBlockedCss();
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (!cssConfirmed) syncBlockedCss();
      },
      { once: true }
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[HOSTNAME]) {
      syncBlockedCss();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg.type === "START_PICKER") {
        startPicker();
        requestAnimationFrame(() => {
          ensureHostMounted();
          const rect = els.banner
            ? els.banner.getBoundingClientRect()
            : { width: 0, height: 0 };
          const visible = Boolean(
            shadowHost && shadowHost.isConnected && rect.width > 0 && rect.height > 0
          );
          sendResponse({
            ok: visible,
            version: EZ_VERSION,
            error: visible
              ? null
              : "The page hid or removed the picker overlay. You can paste a CSS selector directly below."
          });
        });
        return true;
      } else if (msg.type === "STOP_PICKER") {
        stopPicker();
        sendResponse({ ok: true, version: EZ_VERSION });
      } else if (msg.type === "SYNC_NOW") {
        syncBlockedCss();
        sendResponse({ ok: true, version: EZ_VERSION });
      } else if (msg.type === "PING") {
        sendResponse({ ok: true, mode, version: EZ_VERSION });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message, version: EZ_VERSION });
    }
  });

  // =========================================================================
  // 2. SMART STABLE CSS SELECTOR GENERATOR & AD-PROOF SUGGESTIONS
  // =========================================================================

  const STABLE_ATTRS = [
    "data-testid",
    "data-test",
    "data-cy",
    "data-qa",
    "data-component",
    "aria-label",
    "name"
  ];

  const TRANSIENT_CLASS_RE =
    /(^|[-_])(hover|hovered|focus|focused|active|selected|open|opened|visible|dragging|pressed|ez-)([-_]|$)/i;

  function escapeAttrVal(val) {
    return String(val).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function isStableId(id) {
    if (!id || id.length > 60) return false;
    if (/^:r[a-z0-9]+:$/i.test(id)) return false;
    if (/^(ember|yui|ext-gen|react-select|google_ads_iframe|aswift_)/i.test(id)) return false;
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(id)) return false;
    if (/\d{4,}/.test(id)) return false;
    return true;
  }

  function isStableClass(cls) {
    if (!cls || cls.length > 40) return false;
    if (TRANSIENT_CLASS_RE.test(cls)) return false;
    if (/^(css|sc|jss|makeStyles|emotion)-[a-z0-9_-]+$/i.test(cls)) return false;
    if (/\d{4,}/.test(cls)) return false;
    return true;
  }

  function getStableClasses(el) {
    if (!el.classList || el.classList.length === 0) return [];
    return Array.from(el.classList).filter(isStableClass).slice(0, 3);
  }

  function getStableAttrSelector(el) {
    for (const attr of STABLE_ATTRS) {
      const val = el.getAttribute(attr);
      if (val && val.length > 0 && val.length < 80 && !/\d{5,}/.test(val)) {
        const sel = `${el.tagName.toLowerCase()}[${attr}="${escapeAttrVal(val)}"]`;
        if (isUnique(sel)) return sel;
      }
    }
    return null;
  }

  function isExternalUrl(href) {
    try {
      const u = new URL(href, window.location.href);
      return /^https?:$/i.test(u.protocol) && u.hostname !== window.location.hostname;
    } catch {
      return false;
    }
  }

  function getLinkOriginPrefix(href) {
    try {
      const u = new URL(href, window.location.href);
      if (!/^https?:$/i.test(u.protocol)) return null;
      return `${u.origin}/`;
    } catch {
      return null;
    }
  }

  function getDirectAdLink(el) {
    if (!el) return null;
    if (el.tagName === "A" && el.getAttribute("href")) return el;

    const ancestorLink = el.closest("a[href]");
    if (ancestorLink) return ancestorLink;

    const visibleChildren = Array.from(el.children).filter(
      (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE"
    );
    if (visibleChildren.length === 1 && visibleChildren[0].tagName === "A") {
      return visibleChildren[0];
    }
    return null;
  }

  function getWrapperForLink(linkEl) {
    const parent = linkEl && linkEl.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      return null;
    }
    const visibleChildren = Array.from(parent.children).filter(
      (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE"
    );
    if (visibleChildren.length === 1 && visibleChildren[0] === linkEl) {
      return parent;
    }
    return null;
  }

  function generateSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";

    if (el.id && isStableId(el.id)) {
      const idSel = `#${CSS.escape(el.id)}`;
      if (isUnique(idSel)) return idSel;
    }

    const attrSel = getStableAttrSelector(el);
    if (attrSel) return attrSel;

    const path = [];
    let current = el;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.documentElement
    ) {
      let segment = current.tagName.toLowerCase();

      if (current.id && isStableId(current.id)) {
        segment = `#${CSS.escape(current.id)}`;
        path.unshift(segment);
        if (isUnique(path.join(" > "))) break;
        current = current.parentElement;
        continue;
      }

      const testId = current.getAttribute("data-testid") || current.getAttribute("data-test");
      if (testId && testId.length < 60 && !/\d{5,}/.test(testId)) {
        const attrName = current.hasAttribute("data-testid") ? "data-testid" : "data-test";
        segment += `[${attrName}="${escapeAttrVal(testId)}"]`;
        path.unshift(segment);
        if (isUnique(path.join(" > "))) break;
        current = current.parentElement;
        continue;
      }

      const classes = getStableClasses(current);
      if (classes.length > 0) {
        segment += classes.map((c) => `.${CSS.escape(c)}`).join("");
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }

      path.unshift(segment);
      if (isUnique(path.join(" > "))) break;
      current = parent;
    }

    return path.join(" > ");
  }

  function buildSelectorSuggestions(el) {
    const suggestions = [];
    const seen = new Set();

    function add(label, selector, toFront = false) {
      if (!selector || seen.has(selector)) return;
      try {
        const count = document.querySelectorAll(selector).length;
        if (count === 0) return;
        seen.add(selector);
        const item = { label, selector, count };
        if (toFront) suggestions.unshift(item);
        else suggestions.push(item);
      } catch {
        // Ignore invalid selectors
      }
    }

    const baseSelector = generateSelector(el);
    const hasNoStableIdentity =
      !(el.id && isStableId(el.id)) &&
      getStableClasses(el).length === 0 &&
      !getStableAttrSelector(el);

    const linkEl = getDirectAdLink(el);
    if (linkEl) {
      const href = linkEl.getAttribute("href") || "";
      const rel = (linkEl.getAttribute("rel") || "").toLowerCase();
      const isSponsored = /\bsponsored\b/.test(rel);
      const external = isExternalUrl(href);
      const originPrefix = getLinkOriginPrefix(href);
      const wrapper = getWrapperForLink(linkEl);
      const wrapperTag = wrapper ? wrapper.tagName.toLowerCase() : null;

      if (wrapperTag && originPrefix && (external || isSponsored)) {
        add(
          "Ad Box (Domain)",
          `${wrapperTag}:has(> a[href^="${escapeAttrVal(originPrefix)}"])`,
          hasNoStableIdentity
        );
      }

      if (wrapperTag && isSponsored) {
        add("All Sponsored Boxes", `${wrapperTag}:has(> a[rel~="sponsored"])`, false);
      }

      if (originPrefix && (external || isSponsored)) {
        add(
          "Link Domain",
          `a[href^="${escapeAttrVal(originPrefix)}"]`,
          hasNoStableIdentity && !wrapperTag
        );
      }

      if (isSponsored) {
        add("Sponsored Links", 'a[rel~="sponsored"]', false);
      }
    }

    if (el.tagName === "IFRAME" && el.getAttribute("src")) {
      const srcPrefix = getLinkOriginPrefix(el.getAttribute("src"));
      if (srcPrefix && isExternalUrl(el.getAttribute("src"))) {
        add(
          "Iframe Domain",
          `iframe[src^="${escapeAttrVal(srcPrefix)}"]`,
          hasNoStableIdentity
        );
      }
    }

    add(hasNoStableIdentity ? "Exact Position" : "Recommended", baseSelector, !hasNoStableIdentity);

    const classes = getStableClasses(el);
    if (classes.length > 0) {
      const classSel = `${el.tagName.toLowerCase()}${classes
        .map((c) => `.${CSS.escape(c)}`)
        .join("")}`;
      add("All Similar", classSel, false);
    }

    return suggestions;
  }

  // =========================================================================
  // 3. STEALTH TOP-LAYER CLOSED SHADOW DOM UI (v2.0.0 THEME)
  // =========================================================================

  const PICKER_CSS = `
    :host {
      all: initial !important;
      display: block !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      overflow: visible !important;
      pointer-events: none !important;
    }
    * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    }
    #ez-highlights {
      position: fixed;
      inset: 0;
      pointer-events: none;
    }
    .ez-box {
      position: fixed;
      border: 2px solid #818cf8;
      background: rgba(99, 102, 241, 0.16);
      border-radius: 4px;
      pointer-events: none;
      transition: all 0.05s ease-out;
    }
    .ez-box.ez-selected {
      border: 2px solid #fb7185;
      background: rgba(244, 63, 94, 0.18);
      box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.24);
    }
    .ez-box.ez-secondary {
      border: 2px dashed #fbbf24;
      background: rgba(245, 158, 11, 0.14);
    }
    #ez-banner {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(11, 17, 32, 0.94);
      backdrop-filter: blur(12px);
      color: #f8fafc;
      padding: 8px 10px 8px 14px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      box-shadow: 0 12px 32px rgba(2, 6, 23, 0.55);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      font-weight: 500;
      pointer-events: auto;
    }
    .ez-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #818cf8;
      box-shadow: 0 0 0 4px rgba(129, 140, 248, 0.24);
    }
    .ez-kbd {
      display: inline-block;
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
      border-radius: 5px;
      padding: 1px 5px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      margin: 0 2px;
    }
    #ez-banner button {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 999px;
      padding: 4px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    #ez-banner button:hover {
      background: #334155;
      border-color: #475569;
    }
    #ez-tooltip {
      position: fixed;
      background: rgba(11, 17, 32, 0.96);
      color: #f8fafc;
      padding: 5px 10px;
      border-radius: 7px;
      font-size: 12px;
      line-height: 1.3;
      border: 1px solid rgba(148, 163, 184, 0.24);
      box-shadow: 0 8px 22px rgba(2, 6, 23, 0.45);
      pointer-events: none;
      white-space: nowrap;
      max-width: 340px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: none;
    }
    .ez-tt-tag {
      color: #a5b4fc;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .ez-tt-dim {
      color: #94a3b8;
      margin-left: 7px;
      font-size: 11px;
    }
    #ez-inspector {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      max-width: calc(100vw - 40px);
      background: rgba(11, 17, 32, 0.96);
      backdrop-filter: blur(14px);
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 14px;
      box-shadow: 0 24px 56px rgba(2, 6, 23, 0.65);
      pointer-events: auto;
      display: none;
      overflow: hidden;
    }
    #ez-inspector.ez-left {
      right: auto;
      left: 20px;
    }
    .ez-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: rgba(30, 41, 59, 0.72);
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    }
    .ez-card-title {
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.01em;
    }
    .ez-tag-pill {
      background: rgba(244, 63, 94, 0.16);
      color: #fda4af;
      border: 1px solid rgba(244, 63, 94, 0.38);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 5px;
    }
    .ez-ver-pill {
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 999px;
      padding: 2px 6px;
    }
    .ez-header-actions {
      display: flex;
      gap: 6px;
    }
    .ez-icon-btn {
      background: rgba(15, 23, 42, 0.6);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 7px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .ez-icon-btn:hover {
      background: #334155;
      color: #ffffff;
    }
    .ez-card-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .ez-meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .ez-meta-item {
      background: rgba(30, 41, 59, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 9px;
      padding: 8px 10px;
    }
    .ez-label {
      display: block;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .ez-value {
      font-size: 12px;
      color: #f1f5f9;
      word-break: break-all;
    }
    .ez-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .ez-preview-box {
      background: rgba(30, 41, 59, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 9px;
      padding: 8px 10px;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.4;
      max-height: 54px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .ez-nav-row {
      display: flex;
      gap: 8px;
    }
    .ez-nav-btn {
      flex: 1;
      background: rgba(30, 41, 59, 0.7);
      color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .ez-nav-btn:hover:not(:disabled) {
      background: #334155;
    }
    .ez-nav-btn:disabled {
      opacity: 0.38;
      cursor: not-allowed;
    }
    .ez-suggestions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .ez-pill-btn {
      background: rgba(30, 41, 59, 0.7);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .ez-pill-btn:hover {
      background: #334155;
      color: #ffffff;
    }
    .ez-pill-btn.ez-pill-active {
      background: rgba(99, 102, 241, 0.24);
      border-color: #818cf8;
      color: #e0e7ff;
      font-weight: 600;
    }
    .ez-selector-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ez-selector-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ez-match-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.16);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .ez-match-badge.ez-warn {
      background: rgba(245, 158, 11, 0.16);
      color: #fcd34d;
      border-color: rgba(245, 158, 11, 0.32);
    }
    .ez-match-badge.ez-error {
      background: rgba(244, 63, 94, 0.16);
      color: #fda4af;
      border-color: rgba(244, 63, 94, 0.32);
    }
    #ez-selector-input {
      width: 100%;
      background: #020617;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    #ez-selector-input:focus {
      border-color: #818cf8;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
    }
    .ez-actions {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }
    .ez-btn {
      border: none;
      border-radius: 9px;
      padding: 9px 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ez-btn-primary {
      flex: 1.4;
      background: linear-gradient(180deg, #f43f5e 0%, #e11d48 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(225, 29, 72, 0.32);
    }
    .ez-btn-primary:hover:not(:disabled) {
      filter: brightness(1.08);
    }
    .ez-btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
    }
    .ez-btn-secondary {
      flex: 1;
      background: rgba(30, 41, 59, 0.8);
      color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, 0.22);
    }
    .ez-btn-secondary:hover {
      background: #334155;
    }
  `;

  function makeEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "className") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  function getMountContainer() {
    if (preferBodyMount && document.body) return document.body;
    return document.documentElement || document.body;
  }

  function promoteToTopLayer() {
    if (!shadowHost || !shadowHost.isConnected) return;
    if (typeof shadowHost.showPopover === "function") {
      try {
        if (!shadowHost.matches(":popover-open")) {
          shadowHost.showPopover();
        }
      } catch {
        // Fallback to fixed z-index positioning if popover is unsupported
      }
    }
  }

  function ensureHostMounted() {
    if (mode === "idle" || !shadowHost) return;

    if (!shadowHost.isConnected) {
      detachCount += 1;
      if (detachCount >= 2) {
        preferBodyMount = !preferBodyMount;
        detachCount = 0;
      }
      const container = getMountContainer();
      if (container) container.appendChild(shadowHost);
    }

    if (shadowHost.hasAttribute("hidden")) {
      shadowHost.removeAttribute("hidden");
    }

    const cs = window.getComputedStyle(shadowHost);
    if (
      cs.display === "none" ||
      cs.visibility === "hidden" ||
      cs.opacity === "0" ||
      cs.position !== "fixed"
    ) {
      shadowHost.style.cssText = HOST_CSS_TEXT;
    }

    promoteToTopLayer();
  }

  function startWatchdog() {
    stopWatchdog();
    const target = document.documentElement;
    if (target) {
      guardObserver = new MutationObserver(() => {
        if (mode !== "idle") ensureHostMounted();
      });
      guardObserver.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "hidden", "class", "popover"]
      });
    }
    guardTimer = window.setInterval(() => {
      if (mode !== "idle") ensureHostMounted();
    }, 150);
  }

  function stopWatchdog() {
    if (guardObserver) {
      guardObserver.disconnect();
      guardObserver = null;
    }
    if (guardTimer !== null) {
      window.clearInterval(guardTimer);
      guardTimer = null;
    }
  }

  function createShadowUI() {
    if (shadowHost && shadowHost.isConnected) {
      ensureHostMounted();
      return;
    }
    destroyShadowUI();

    const randomTag = `x-${Math.random().toString(36).slice(2, 8)}`;
    shadowHost = document.createElement(randomTag);
    shadowHost.setAttribute("popover", "manual");
    shadowHost.style.cssText = HOST_CSS_TEXT;

    shadowRoot = shadowHost.attachShadow({ mode: "closed" });

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PICKER_CSS);
      shadowRoot.adoptedStyleSheets = [sheet];
    } catch {
      const styleEl = document.createElement("style");
      styleEl.textContent = PICKER_CSS;
      shadowRoot.appendChild(styleEl);
    }

    const highlights = makeEl("div", { id: "ez-highlights" });

    const bannerText = makeEl("span", { id: "ez-banner-text" }, [
      document.createTextNode("Click any element to inspect. Press "),
      makeEl("span", { className: "ez-kbd", text: "Esc" }),
      document.createTextNode(" to exit.")
    ]);
    const bannerCancel = makeEl("button", {
      id: "ez-banner-cancel",
      type: "button",
      text: "Cancel"
    });
    const banner = makeEl("div", { id: "ez-banner" }, [
      makeEl("span", { className: "ez-dot" }),
      bannerText,
      bannerCancel
    ]);

    const tooltip = makeEl("div", { id: "ez-tooltip" });

    const tagPill = makeEl("span", { id: "ez-tag-pill", className: "ez-tag-pill", text: "DIV" });
    const verPill = makeEl("span", { className: "ez-ver-pill", text: `v${EZ_VERSION}` });
    const moveBtn = makeEl("button", {
      id: "ez-move-btn",
      className: "ez-icon-btn",
      type: "button",
      title: "Move panel side",
      text: "Move Left"
    });
    const closeBtn = makeEl("button", {
      id: "ez-close-btn",
      className: "ez-icon-btn",
      type: "button",
      title: "Exit picker",
      text: "✕"
    });

    const cardHeader = makeEl("div", { className: "ez-card-header" }, [
      makeEl("div", { className: "ez-card-title" }, [
        makeEl("span", { text: "Inspect Element" }),
        tagPill,
        verPill
      ]),
      makeEl("div", { className: "ez-header-actions" }, [moveBtn, closeBtn])
    ]);

    const dimVal = makeEl("span", { id: "ez-dim-val", className: "ez-value", text: "0 × 0 px" });
    const attrVal = makeEl("span", {
      id: "ez-attr-val",
      className: "ez-value ez-mono",
      text: "None"
    });

    const metaGrid = makeEl("div", { className: "ez-meta-grid" }, [
      makeEl("div", { className: "ez-meta-item" }, [
        makeEl("span", { className: "ez-label", text: "Dimensions" }),
        dimVal
      ]),
      makeEl("div", { className: "ez-meta-item" }, [
        makeEl("span", { className: "ez-label", text: "Target Details" }),
        attrVal
      ])
    ]);

    const previewVal = makeEl("div", { id: "ez-preview-val", className: "ez-preview-box" });
    const previewWrap = makeEl("div", { id: "ez-preview-wrap" }, [
      makeEl("span", { className: "ez-label", text: "Content Preview" }),
      previewVal
    ]);

    const parentBtn = makeEl("button", {
      id: "ez-parent-btn",
      className: "ez-nav-btn",
      type: "button",
      text: "↑ Select Parent"
    });
    const childBtn = makeEl("button", {
      id: "ez-child-btn",
      className: "ez-nav-btn",
      type: "button",
      text: "↓ Select Child"
    });
    const navRow = makeEl("div", { className: "ez-nav-row" }, [parentBtn, childBtn]);

    const suggestionsRow = makeEl("div", {
      id: "ez-suggestions-row",
      className: "ez-suggestions-row"
    });
    const suggestionsWrap = makeEl("div", { id: "ez-suggestions-wrap" }, [
      makeEl("span", { className: "ez-label", text: "Smart Match Modes" }),
      suggestionsRow
    ]);

    const matchBadge = makeEl("span", {
      id: "ez-match-badge",
      className: "ez-match-badge",
      text: "Matches 1 element"
    });
    const selectorInput = makeEl("input", {
      id: "ez-selector-input",
      type: "text",
      spellcheck: "false"
    });

    const selectorWrap = makeEl("div", { className: "ez-selector-wrap" }, [
      makeEl("div", { className: "ez-selector-header" }, [
        makeEl("span", { className: "ez-label", text: "CSS Selector", style: { margin: "0" } }),
        matchBadge
      ]),
      selectorInput
    ]);

    const repickBtn = makeEl("button", {
      id: "ez-repick-btn",
      className: "ez-btn ez-btn-secondary",
      type: "button",
      text: "Pick Again"
    });
    const blockBtn = makeEl("button", {
      id: "ez-block-btn",
      className: "ez-btn ez-btn-primary",
      type: "button",
      text: "Block Element"
    });
    const actionsRow = makeEl("div", { className: "ez-actions" }, [repickBtn, blockBtn]);

    const cardBody = makeEl("div", { className: "ez-card-body" }, [
      metaGrid,
      previewWrap,
      navRow,
      suggestionsWrap,
      selectorWrap,
      actionsRow
    ]);

    const inspector = makeEl("div", { id: "ez-inspector" }, [cardHeader, cardBody]);

    shadowRoot.append(highlights, banner, tooltip, inspector);

    const container = getMountContainer();
    if (container) container.appendChild(shadowHost);
    promoteToTopLayer();

    els = {
      highlights,
      banner,
      bannerText,
      bannerCancel,
      tooltip,
      inspector,
      tagPill,
      dimVal,
      attrVal,
      previewWrap,
      previewVal,
      parentBtn,
      childBtn,
      suggestionsWrap,
      suggestionsRow,
      matchBadge,
      selectorInput,
      repickBtn,
      blockBtn,
      moveBtn,
      closeBtn
    };

    bindInspectorControls();
  }

  function destroyShadowUI() {
    if (shadowHost) {
      shadowHost.remove();
      shadowHost = null;
      shadowRoot = null;
      els = {};
    }
  }

  // =========================================================================
  // 4. HIGHLIGHTING & INSPECTOR LOGIC
  // =========================================================================

  function renderHighlights(elements, primaryEl = null) {
    if (!els.highlights) return;
    els.highlights.replaceChildren();

    const capped = Array.from(elements).slice(0, 50);
    for (const target of capped) {
      if (!target || target === shadowHost) continue;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const box = document.createElement("div");
      box.className = "ez-box";
      if (mode === "inspecting") {
        const isPrimary =
          target === primaryEl || (primaryEl && target.contains(primaryEl));
        box.classList.add(isPrimary ? "ez-selected" : "ez-secondary");
      }
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      els.highlights.appendChild(box);
    }
  }

  function updateTooltip(el, clientX, clientY) {
    if (!els.tooltip || !el) return;
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const idPart = el.id ? `#${el.id}` : "";
    const clsPart = getStableClasses(el)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join("");

    const tagSpan = makeEl("span", { className: "ez-tt-tag", text: tag + idPart + clsPart });
    const dimSpan = makeEl("span", {
      className: "ez-tt-dim",
      text: `${Math.round(rect.width)} × ${Math.round(rect.height)}`
    });

    els.tooltip.replaceChildren(tagSpan, dimSpan);
    els.tooltip.style.display = "block";

    const offset = 14;
    const ttRect = els.tooltip.getBoundingClientRect();
    let left = clientX + offset;
    let top = clientY + offset;

    if (left + ttRect.width > window.innerWidth - 10) {
      left = Math.max(10, clientX - ttRect.width - offset);
    }
    if (top + ttRect.height > window.innerHeight - 10) {
      top = Math.max(10, clientY - ttRect.height - offset);
    }

    els.tooltip.style.left = `${left}px`;
    els.tooltip.style.top = `${top}px`;
  }

  function updateActivePill() {
    if (!els.suggestionsRow) return;
    const current = els.selectorInput.value.trim();
    for (const btn of els.suggestionsRow.children) {
      btn.classList.toggle("ez-pill-active", btn.dataset.selector === current);
    }
  }

  function renderSuggestions(suggestions) {
    els.suggestionsRow.replaceChildren();
    if (!suggestions.length) {
      els.suggestionsWrap.style.display = "none";
      return;
    }

    els.suggestionsWrap.style.display = "block";
    for (const item of suggestions) {
      const btn = makeEl("button", {
        type: "button",
        className: "ez-pill-btn",
        text: `${item.label} (${item.count})`,
        title: item.selector
      });
      btn.dataset.selector = item.selector;
      btn.addEventListener("click", () => {
        els.selectorInput.value = item.selector;
        updateActivePill();
        evaluateSelectorInput();
      });
      els.suggestionsRow.appendChild(btn);
    }
  }

  function populateInspector(el) {
    selectedEl = el;
    const rect = el.getBoundingClientRect();

    els.tagPill.textContent = el.tagName;
    els.dimVal.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;

    const attrs = [];
    if (el.id) attrs.push(`#${el.id}`);
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (testId) attrs.push(`[data-testid="${testId}"]`);
    const classes = getStableClasses(el);
    if (classes.length) attrs.push(classes.map((c) => `.${c}`).join(" "));

    const linkEl = getDirectAdLink(el);
    if (!attrs.length && linkEl && linkEl.getAttribute("href")) {
      const prefix = getLinkOriginPrefix(linkEl.getAttribute("href"));
      if (prefix) attrs.push(prefix.replace(/^https?:\/\//, "").replace(/\/$/, ""));
      if (/\bsponsored\b/i.test(linkEl.getAttribute("rel") || "")) {
        attrs.push("rel=sponsored");
      }
    }
    els.attrVal.textContent = attrs.length ? attrs.join(" ") : "Inline styles only";

    const textSnippet = (
      el.innerText ||
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();

    if (textSnippet) {
      els.previewWrap.style.display = "block";
      els.previewVal.textContent = textSnippet.slice(0, 140);
    } else if (el.tagName === "IMG" && el.src) {
      els.previewWrap.style.display = "block";
      els.previewVal.textContent = `Image: ${el.src}`;
    } else {
      els.previewWrap.style.display = "none";
    }

    const suggestions = buildSelectorSuggestions(el);
    renderSuggestions(suggestions);
    els.selectorInput.value = suggestions.length ? suggestions[0].selector : generateSelector(el);
    updateActivePill();

    const canGoUp =
      el.parentElement &&
      el.parentElement !== document.body &&
      el.parentElement !== document.documentElement;
    const canGoDown = childStack.length > 0 || el.firstElementChild !== null;

    els.parentBtn.disabled = !canGoUp;
    els.childBtn.disabled = !canGoDown;

    evaluateSelectorInput();
  }

  function evaluateSelectorInput() {
    const selector = els.selectorInput.value.trim();
    els.matchBadge.className = "ez-match-badge";
    updateActivePill();

    if (!selector) {
      els.matchBadge.textContent = "Empty selector";
      els.matchBadge.classList.add("ez-error");
      els.blockBtn.disabled = true;
      renderHighlights([]);
      return;
    }

    try {
      const matches = document.querySelectorAll(selector);
      const count = matches.length;

      if (count === 0) {
        els.matchBadge.textContent = "Matches 0 elements";
        els.matchBadge.classList.add("ez-error");
        els.blockBtn.disabled = true;
        renderHighlights([]);
      } else if (count === 1) {
        els.matchBadge.textContent = "Matches 1 element";
        els.blockBtn.disabled = false;
        renderHighlights(matches, selectedEl);
      } else {
        els.matchBadge.textContent = `Matches ${count} elements`;
        els.matchBadge.classList.add("ez-warn");
        els.blockBtn.disabled = false;
        renderHighlights(matches, selectedEl);
      }
    } catch {
      els.matchBadge.textContent = "Invalid CSS selector";
      els.matchBadge.classList.add("ez-error");
      els.blockBtn.disabled = true;
      renderHighlights([]);
    }
  }

  function bindInspectorControls() {
    els.bannerCancel.addEventListener("click", stopPicker);
    els.closeBtn.addEventListener("click", stopPicker);

    els.moveBtn.addEventListener("click", () => {
      inspectorSide = inspectorSide === "right" ? "left" : "right";
      els.inspector.classList.toggle("ez-left", inspectorSide === "left");
      els.moveBtn.textContent = inspectorSide === "right" ? "Move Left" : "Move Right";
    });

    els.repickBtn.addEventListener("click", () => {
      mode = "picking";
      selectedEl = null;
      childStack = [];
      els.inspector.style.display = "none";
      els.banner.style.display = "flex";
      renderHighlights([]);
    });

    els.parentBtn.addEventListener("click", () => {
      if (!selectedEl || !selectedEl.parentElement) return;
      if (
        selectedEl.parentElement === document.body ||
        selectedEl.parentElement === document.documentElement
      ) {
        return;
      }
      childStack.push(selectedEl);
      populateInspector(selectedEl.parentElement);
    });

    els.childBtn.addEventListener("click", () => {
      if (!selectedEl) return;
      const nextChild = childStack.pop() || selectedEl.firstElementChild;
      if (nextChild) {
        populateInspector(nextChild);
      }
    });

    els.selectorInput.addEventListener("input", evaluateSelectorInput);

    els.blockBtn.addEventListener("click", () => {
      const selector = els.selectorInput.value.trim();
      if (!selector) return;

      const rect = selectedEl ? selectedEl.getBoundingClientRect() : { width: 0, height: 0 };
      const newRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        selector,
        tag: selectedEl ? selectedEl.tagName : "CUSTOM",
        dimensions: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
        createdAt: Date.now()
      };

      saveRule(newRule, () => {
        stopPicker();
      });
    });
  }

  function saveRule(newRule, callback) {
    chrome.storage.local.get([HOSTNAME], (result) => {
      const existing = result[HOSTNAME] || [];
      const alreadyExists = existing.some((r) => r.selector === newRule.selector);
      const updated = alreadyExists ? existing : [newRule, ...existing];

      chrome.storage.local.set({ [HOSTNAME]: updated }, () => {
        syncBlockedCss();
        if (callback) callback();
      });
    });
  }

  // =========================================================================
  // 5. PAGE EVENT LISTENERS (Window Capture Phase, Blocks Pop-unders)
  // =========================================================================

  function isOwnUI(e) {
    if (!shadowHost) return false;
    if (e.target === shadowHost || shadowHost.contains(e.target)) return true;
    if (typeof e.composedPath === "function") {
      return e.composedPath().includes(shadowHost);
    }
    return false;
  }

  function getTargetAtPoint(clientX, clientY, fallbackTarget) {
    if (typeof document.elementsFromPoint === "function") {
      const stack = document.elementsFromPoint(clientX, clientY);
      for (const el of stack) {
        if (!el || el === shadowHost || (shadowHost && shadowHost.contains(el))) continue;
        return el;
      }
    }
    return fallbackTarget;
  }

  function blockPointerEvent(e) {
    if (mode === "idle") return;
    if (isOwnUI(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onMouseMove(e) {
    if (mode !== "picking") return;
    if (isOwnUI(e)) {
      els.tooltip.style.display = "none";
      return;
    }

    const target = getTargetAtPoint(e.clientX, e.clientY, e.target);
    if (!target) return;

    hoveredEl = target;
    renderHighlights([hoveredEl]);
    updateTooltip(hoveredEl, e.clientX, e.clientY);
  }

  function onClick(e) {
    if (mode === "idle") return;
    if (isOwnUI(e)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (mode === "picking") {
      const target = getTargetAtPoint(e.clientX, e.clientY, e.target);
      if (!target) return;

      mode = "inspecting";
      childStack = [];
      els.tooltip.style.display = "none";
      els.banner.style.display = "none";
      els.inspector.style.display = "block";
      populateInspector(target);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && mode !== "idle") {
      e.preventDefault();
      stopPicker();
    }
  }

  function onViewportChange() {
    if (mode === "picking" && hoveredEl) {
      renderHighlights([hoveredEl]);
    } else if (mode === "inspecting") {
      evaluateSelectorInput();
    }
  }

  const BLOCKED_EVENTS = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "auxclick",
    "contextmenu"
  ];

  function startPicker() {
    detachCount = 0;
    mode = "picking";
    hoveredEl = null;
    selectedEl = null;
    childStack = [];

    createShadowUI();

    els.inspector.style.display = "none";
    els.banner.style.display = "flex";
    els.tooltip.style.display = "none";
    renderHighlights([]);

    startWatchdog();

    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    for (const evt of BLOCKED_EVENTS) {
      window.addEventListener(evt, blockPointerEvent, true);
    }
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange, true);
  }

  function stopPicker() {
    mode = "idle";
    hoveredEl = null;
    selectedEl = null;
    childStack = [];

    stopWatchdog();

    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
    for (const evt of BLOCKED_EVENTS) {
      window.removeEventListener(evt, blockPointerEvent, true);
    }
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange, true);

    destroyShadowUI();
  }
})();