# Third-party notices

## K1toD500

The initial D500 DAT layout, channel field encoding, DCS table, GBK name encoding and K5Web channel mapping in `src/lib/dat.ts` and `src/lib/workbook.ts` are based on:

- Project: https://github.com/Liuli-Lumine/K1toD500
- Author/project owner: Liuli-Lumine
- Revision: e65cbb309986f0f37babaae7fac77f9fd21b5ab1
- License: GNU General Public License v3.0 (see LICENSE)

This project modifies and ports the original C++ implementation to TypeScript, adds template-preserving exports, browser editing, workbook conversion, validation and deployment. It does not include an upstream V2 default radio configuration.

Version 0.2.0 adds independently traced V1 CPS field mappings and a read-only metadata/native-name-copy verification harness. The V1 power and name-edit limits differ from the initial upstream assumptions; the evidence and test boundaries are documented in docs/DAT_FORMAT.md. No proprietary CPS executable or disassembly is distributed.

## SheetJS Community Edition

https://sheetjs.com / https://git.sheetjs.com/sheetjs/sheetjs

Version 0.20.3 is vendored from the official CDN. Apache-2.0 license and distribution notices are included inside vendor/xlsx-0.20.3.tgz.

React (MIT), Vite (MIT), Lucide (ISC), Vitest (MIT), and fflate (MIT) retain their package license files. IBM Plex Sans and IBM Plex Mono are distributed under SIL Open Font License 1.1; the license is included in public/FONT-LICENSE.txt. Official Zastone software, drivers and manuals are research downloads only and are not distributed in the application or source repository.

## CHIRP and LOSEHU firmware references

The embedded `radio-core/vendor/chirp.zip` contains unmodified Python source from CHIRP, revision `0b4076d9b19a2a133d11f31546cff8153b39eb89`: <https://github.com/kk7ds/chirp>. Core components are GPL-3.0-or-later and the selected drivers are GPL-2.0-or-later; original notices and the GPL text are preserved in the archive. The GPL-3.0-only application is distributed with this corresponding source. No proprietary programming software is included.

`radio-core/losehu.py` adds independently implemented field mappings cross-checked against the LOSEHU firmware source at `49222a9f431a006dfaaaa665b839e4953b1a1882`: <https://github.com/losehu/uv-k5-firmware-custom>. See radio-core/README.md for scope and validation limits.

## K5Web

`radio-core/losehu_profiles.py` includes the pre-118 LOSEHU font mapping from [K5Web](https://github.com/silenty4ng/k5web/tree/55f49866078a35e3d1d740f89be5056845bec6e4), copyright 2024–2025 Silent YANG, MIT. The original mapping has been compacted into ordered Unicode rows without changing byte assignments. The complete MIT notice is distributed in `radio-core/vendor/K5WEB-LICENSE.txt`. Version profiles, UART framing and channel layouts were also cross-checked against that pinned source and official LOSEHU 117 / 131 / 132 / 133 sources; see [LOSEHU_COMPATIBILITY.md](docs/LOSEHU_COMPATIBILITY.md).

## Pyodide

Pyodide 314.0.7 (MPL-2.0) is installed from the official npm package and distributed unmodified to run the included drivers in a browser worker. It is loaded only for the new models; the D500 protocol remains TypeScript. License and source details are shipped in `radio-core/PYODIDE-LICENSE` and `radio-core/PYODIDE-NOTICE.txt`, and copied beside the runtime. CPython and other included components retain their original licenses in the upstream distribution.
