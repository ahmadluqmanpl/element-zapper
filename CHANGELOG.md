\# Changelog



\## \[2.0.0] - 2026-11-22



\### Added

\* Custom toolbar and extension icon pack (`16`, `32`, `48`, `128` px PNGs plus SVG master).

\* Redesigned dark slate popup UI and matching frosted-glass in-page inspector card.

\* Smart Match Modes with `:has()` selector generation for unnamed/sponsored ad containers and external link domains.

\* Manual CSS selector input bar in the popup with syntax validation.

\* Self-healing Top Layer (`popover="manual"`) closed Shadow DOM overlay with pop-under click protection.



\### Fixed

\* Replaced `.innerHTML` with Trusted Types safe DOM construction so the picker works on sites enforcing Trusted Types CSP.

\* Switched primary rule injection to `chrome.scripting.insertCSS` with `origin: "USER"` to bypass strict `style-src` CSP and inline `!important` styles.

