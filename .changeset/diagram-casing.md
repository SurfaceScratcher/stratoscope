---
'stratoscope': patch
---

`dist/diagram.js` and `dist/Diagram.js` no longer sit side by side: on case-insensitive file systems (macOS, Windows) one overwrote the other, and TypeScript projects with `forceConsistentCasingInFileNames` failed to compile. The component now lives in `Diagram2D.js`; imports stay the same.
