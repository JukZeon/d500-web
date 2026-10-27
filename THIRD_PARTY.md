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
