# D500 Workbench implementation plan

## Scope

A browser-local D500 channel editor with direct table and inspector editing, search/filter, multi-select, batch editing, duplication, deletion, undo/redo, frequency visualization, local draft recovery, project backups, native DAT import/export, XLSX/CSV import/export, and K5Web spreadsheet interoperability. No radio USB protocol is assumed.

## Design specification

- Purpose: make D500 V1 channel planning and file conversion practical without installing a Windows editor.
- Direction: industrial/utilitarian radio workbench, with a compact off-center toolbar and instrument-style inspector.
- Palette: graphite #18211f, paper #f5f6f2, signal green #b8ed65, deep green #24644b, amber #b96c20.
- Typography: IBM Plex Sans / Noto Sans SC / sans-serif for controls; IBM Plex Mono / monospace for frequencies. Local fallbacks keep the app usable without third-party font requests.
- Layout: fixed narrow left navigation, flexible channel grid, contextual right inspector; responsive drawers and horizontal table scrolling on smaller screens.

## DAT fidelity

Port the documented K1toD500 DAT codec under GPL-3.0. Use radio-native slots 0–199. Preserve all unedited rows, payload flag bits, and original file bytes when unchanged. Preserve unknown settings rather than substituting V2 defaults. New workspaces can export spreadsheets/projects; native DAT export requires an imported original DAT template. V1 hardware compatibility remains unverified until tested with a real V1 export.

## Delivery

1. Set up Git, private GitHub repository and versioned GPL sources.
2. Implement and test codec and workbook boundary, including malformed files and lossless round trips.
3. Implement usable responsive editor and local storage.
4. Exercise browser import/edit/export flows.
5. Build release, deploy static container to d500-host VPS, route d500.example.com through existing Nginx Proxy Manager, enable HTTPS, verify public URL.
6. Commit, push, tag, and document repeatable deployment/rollback.
