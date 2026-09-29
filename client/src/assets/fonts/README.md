# App Fonts

Official Google Fonts WOFF2 subsets, downloaded on 2026-09-29. These are the
existing app typefaces, served locally to remove the external CSS/font discovery
chain. Rsbuild fingerprints the assets; `font-display: swap` preserves fallback
text while fonts load. Unicode ranges keep unused language subsets off the wire.

- Fraunces v38: normal and italic, weight 100-900, optical size 9-144.
- Inter v20: normal, weight 300-700.
- JetBrains Mono v24: normal, weight 400-700.

Source CSS:
<https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300..700&family=JetBrains+Mono:wght@400..700&display=swap>

Binary filenames preserve the official `fonts.gstatic.com` asset identifiers.
All 19 subsets are retained; only subsets needed for rendered text are loaded.
Accompanying `*-OFL.txt` files contain each font's copyright and SIL OFL license,
from <https://github.com/google/fonts/tree/main/ofl>.
