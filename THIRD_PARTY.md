# Third-party notices

## K1toD500

The D500 DAT layout, channel field encoding, DCS table, GBK name limits and K5Web channel mapping in `src/lib/dat.ts` and `src/lib/workbook.ts` are based on:

- Project: https://github.com/Liuli-Lumine/K1toD500
- Author/project owner: Liuli-Lumine
- Revision: e65cbb309986f0f37babaae7fac77f9fd21b5ab1
- License: GNU General Public License v3.0 (see LICENSE)

This project modifies and ports the original C++ implementation to TypeScript, adds template-preserving exports, browser editing, workbook conversion, validation and deployment. It does not include an upstream V2 default radio configuration.

## K5Web

https://github.com/silenty4ng/k5web informed workflow and spreadsheet interoperability. No K5 firmware or device serial protocol is used in this D500 application.

## SheetJS Community Edition

https://sheetjs.com / https://git.sheetjs.com/sheetjs/sheetjs

Version 0.20.3 is vendored from the official CDN. Apache-2.0 license and distribution notices are included inside vendor/xlsx-0.20.3.tgz.

React (MIT), Vite (MIT), Lucide (ISC), Vitest (MIT), and Playwright (Apache-2.0) retain their package license files. Official Zastone software, drivers and manuals are research downloads only and are not distributed in the application or source repository.
