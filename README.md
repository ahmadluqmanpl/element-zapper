<div align="center">
  <img src="icons/icon128.png" alt="Element Zapper Logo" width="84" height="84" />
  <h1>Element Zapper</h1>
  <p>A lightweight Manifest V3 Chrome extension to visually inspect, preview, and permanently hide unwanted elements on any website.</p>

  <p>
    <img src="https://img.shields.io/badge/Manifest-V3-6366f1?style=flat-square" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/Version-2.0.0-34d399?style=flat-square" alt="Version 2.0.0" />
    <img src="https://img.shields.io/badge/Chrome-114%2B-475569?style=flat-square" alt="Chrome 114+" />
    <img src="https://img.shields.io/badge/License-MIT-94a3b8?style=flat-square" alt="MIT License" />
  </p>
</div>

---

<h2 align="center">Preview</h2>

<table>
  <tr>
    <th align="center">Popup Manager</th>
    <th align="center">In-Page Element Inspector</th>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="assets/popup-preview.png" alt="Popup Preview" width="480" />
    </td>
    <td align="center" width="50%">
      <img src="assets/inspector-preview.png" alt="Inspector Preview" width="480" />
    </td>
  </tr>
</table>

## Features

* **Visual Picker & Live Inspector:** Hover over any page element to see its tag and dimensions, then click to inspect its attributes, text preview, CSS selector, and live match count before hiding it.
* **Parent & Child Stepping:** Walk up or down the DOM tree directly from the inspector card without re-picking.
* **Smart Match Modes:** Automatically detects external ad domains, `rel="sponsored"` links, and wrapper containers using CSS `:has()` rules so dynamically injected ads with randomized IDs or paths stay hidden after refreshing.
* **Persistent, Flicker-Free Hiding:** Applies saved rules per domain at `document_start` via `USER`-origin CSS (`chrome.scripting.insertCSS`), bypassing strict `style-src` CSP headers and outranking inline `!important` styles.
* **Hardened Overlay UI:** Runs inside a closed Shadow DOM using Trusted Types compliant DOM construction (zero `.innerHTML`), Chrome's Top Layer Popover API, and a self-healing watchdog so the picker stays visible on sites with anti-overlay scripts.
* **Instant Restore & Manual Selectors:** Restore individual elements or clear an entire domain from the popup without reloading, or add custom CSS selectors manually.

## Installation

### Option 1: Download Release (Recommended)
1. Go to the [Releases](https://github.com/ahmadluqmanpl/element-zapper/releases) page and download the latest `element-zapper-v2.0.0.zip`.
2. Extract the archive to a permanent folder on your computer.
3. Open Chrome and navigate to `chrome://extensions/`.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the extracted folder.

### Option 2: Clone from Source
```bash
git clone [https://github.com/ahmadluqmanpl/element-zapper.git](https://github.com/ahmadluqmanpl/element-zapper.git)
```
Then load the cloned `element-zapper` directory via **Load unpacked** in `chrome://extensions/`.

## How to Use

1. Open any website and click the **Element Zapper** icon in your toolbar.
2. Click **Pick Element to Block** (press `Esc` anytime to exit).
3. Click the element you want to remove to freeze it in the **Inspect Element** card.
4. Refine the target with **Select Parent / Select Child**, switch between **Smart Match Modes**, or edit the CSS selector manually while checking the highlighted matches on screen.
5. Click **Block Element**. The rule is saved locally for that domain and applied automatically on every visit.

## Permissions & Privacy

Element Zapper runs entirely offline inside your browser. It makes **zero external network requests** and collects no telemetry, browsing history, or analytics.

| Permission | Purpose |
| :--- | :--- |
| `storage` | Stores your blocked CSS selectors per hostname in `chrome.storage.local` and tracks active tab stylesheets in `chrome.storage.session`. |
| `activeTab` | Reads the active tab's domain when opening the popup and starts the element picker on demand. |
| `scripting` | Injects and removes `USER`-origin CSS rules cleanly so hidden elements do not flicker on load and restore immediately. |
| `<all_urls>` | Enables automatic blocking at `document_start` on any website where you have saved rules. |

## Project Structure

```text
element-zapper/
├── assets/
│   ├── popup-preview.png
│   └── inspector-preview.png
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.css
├── popup.js
├── CHANGELOG.md
└── LICENSE
```

## License

Licensed under the [MIT License](LICENSE).
