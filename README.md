\# Element Zapper



A lightweight Manifest V3 Chrome extension for visually inspecting, previewing, and permanently hiding unwanted elements on any website.



!\[Manifest V3](https://img.shields.io/badge/Manifest-V3-6366f1?style=flat-square)

!\[Version](https://img.shields.io/badge/Version-2.0.0-34d399?style=flat-square)

!\[License](https://img.shields.io/badge/License-MIT-94a3b8?style=flat-square)



!\[Popup Preview](assets/popup-preview.png)

!\[Inspector Preview](assets/inspector-preview.png)





\## Features



\* \*\*Visual Element Picker \& Live Inspector:\*\* Hover to preview tag names and dimensions, then click to freeze an element and inspect its attributes, dimensions, content snippet, and live match count before blocking.

\* \*\*Parent \& Child Stepping:\*\* Fine-tune selections up or down the DOM tree without re-picking.

\* \*\*Smart Match Modes for Dynamic Ads:\*\* Automatically detects external ad link domains, `rel="sponsored"` attributes, and wrapper containers using CSS `:has()` selectors so ads with randomized IDs or URLs stay hidden across reloads.

\* \*\*Persistent, Flicker-Free Blocking:\*\* Injects rules at `document\_start` via `USER`-origin CSS (`chrome.scripting.insertCSS`), bypassing strict `style-src` CSP policies and outranking inline `!important` styles.

\* \*\*Hardened Overlay Engine:\*\* Uses a closed Shadow DOM, Trusted Types compliant DOM construction (zero `.innerHTML`), Chrome's Top Layer Popover API, and a self-healing watchdog so the picker stays visible on sites with strict CSP or anti-overlay scripts.

\* \*\*Instant Restore \& Manual Rules:\*\* Manage or restore blocked elements per domain from the popup without reloading the page, or paste custom CSS selectors directly.



\## Installation (Load Unpacked)



1\. Download the latest release ZIP from the \*\*Releases\*\* page (or clone this repository):

&#x20;  ```bash

&#x20;  git clone \[https://github.com/ahmadluqmanpl/element-zapper.git](https://github.com/ahmadluqmanpl/element-zapper.git)

&#x20;  ```

2\. Open Chrome and navigate to `chrome://extensions/`.

3\. Enable \*\*Developer mode\*\* in the top-right corner.

4\. Click \*\*Load unpacked\*\* and select the extracted `element-zapper` folder.

5\. Pin \*\*Element Zapper\*\* to your toolbar for quick access.



\## Usage



1\. Open any website and click the \*\*Element Zapper\*\* toolbar icon.

2\. Click \*\*Pick Element to Block\*\* (or press `Esc` anytime to cancel).

3\. Click any page element to open the \*\*Inspect Element\*\* card.

4\. Adjust the target using \*\*Select Parent / Select Child\*\*, choose a \*\*Smart Match Mode\*\* pill, or edit the CSS selector directly while watching the highlighted matches.

5\. Click \*\*Block Element\*\*. The rule is saved for that hostname and applied automatically on future visits.



\## Permissions Explained



Chrome extensions with broad site access deserve transparency. Element Zapper makes \*\*zero external network requests\*\* and contains no analytics or tracking.



| Permission | Why It Is Needed |

| :--- | :--- |

| `storage` | Saves your blocked CSS selectors per domain locally in `chrome.storage.local` and tracks active tab styles in `chrome.storage.session`. |

| `activeTab` | Reads the current tab's hostname when you open the popup and activates the picker on demand. |

| `scripting` | Injects and removes `USER`-origin blocking CSS rules cleanly across page loads and restores. |

| `<all\_urls>` | Allows `background.js` and `content.js` to apply your saved rules automatically at `document\_start` on any website you choose to block elements on. |



\## Privacy



All blocked rules are stored exclusively in your browser's local storage. No browsing history, URLs, or selectors ever leave your device.



\## License



Released under the \[MIT License](LICENSE).

