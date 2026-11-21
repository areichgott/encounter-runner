# Encounter Runner

Offline encounter runner for Starfinder 2e / Pathfinder 2e, built for a Galaxy Tab A8 at the table. See [SPEC.md](SPEC.md).

This repo holds only the app. Adventure content comes from pack files you import on the device; packs are never stored here.

## Install on the tablet
1. Open the GitHub Pages URL in Chrome (online, once).
2. ⋮ menu → **Add to Home screen** → open it from the home screen.
3. **Import pack…** and pick the pack `.json` from Downloads.
4. Settings → add your party.

After that it works in airplane mode. When a new version is published, the app shows a "Reload" prompt the next time it's opened online.

## Develop
No build step. Serve the folder (`python3 -m http.server`) and open `http://localhost:8000`. Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js` on each release.
