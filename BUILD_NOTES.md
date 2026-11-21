# BUILD NOTES — What was actually built (v1 → v2)

This file records, in detail, what was changed and added when Construction Record Manager went from the v1 company-folder tool to the v2 road-construction record system. Everything below was built and checked; the last section lists what is **not** done or not verified.

---

## 1. Starting point (v1) and what I found

- Electron + React + Tailwind app: create a company → folder with 6 sub-folders + formatted Excel → saved in SQLite. Screens: Dashboard, Create Company, All Companies, Company Details, Settings.
- Your **real database already has 2 companies** (Daksh Construction, Rahil Construction) at `%APPDATA%\construction-company-records\Database\company_records.sqlite`. It was never touched; every migration was tested on a copy.
- Problems found in v1:
  - Database used `sql.js` (WebAssembly): rewrote the whole file on every save, no real transactions, **no full-text search (FTS5)**.
  - `tsconfig.json` was invalid for the installed TypeScript (type-check failed).
  - Both test scripts were broken (one needed a package that was not installed, the other never ran real code).
  - The create screen came pre-filled with sample data ("Daksh Construction", "Example Owner") — risky for accidental fake records.
  - Field ids from the UI (e.g. `'1'`) could collide between two companies and crash saving (found and fixed during testing).
  - File-open was not restricted to your record folders.

---

## 2. Database and data safety

| Item | Detail |
|---|---|
| Driver | Native `node:sqlite` built into Electron 45 (WAL mode, real transactions, foreign keys ON, FTS5). Same file location as v1, so existing data is picked up. |
| Migrations | Versioned (`schema_migrations`). v1 = baseline (adopts existing DB untouched), v2 = all road-construction tables, v3 = editable starter data. Each runs in a transaction; failure rolls back. |
| Pre-upgrade backup | Before upgrading an existing DB, a snapshot is written to `%APPDATA%\construction-company-records\Backups\pre-migration_*.sqlite`. |
| Money | Integer **paise**. Quantities/weights/dimensions = integer **milli-units**. Percent = integer **basis points**. All multiplication uses BigInt, half-up rounding. No floating-point money. |
| Soft delete | `deleted_at` on all business tables; archive/restore; nothing silently removed. |
| Audit | `audit_logs` records create / update / cancel / void / revise / verify / archive with before/after and reason. |
| Numbering | Auto numbers per Indian financial year: `PO/26-27/0001`, `GRN/26-27/0001`, `QT/26-27/0001`, `SUP-0001`. |
| Tables (30) | companies, company_fields, app_settings, units, projects, material_categories, materials, material_specifications, suppliers, supplier_materials, supplier_projects, work_activities, test_types, quantity_formulas, purchase_orders, purchase_order_items, invoices, supplier_payments, material_receipts, weighbridge_records, royalty_passes, royalty_rates, stock_transactions, material_consumption, consumption_plans, quality_tests, measurement_entries, daily_progress, documents, generated_reports, audit_logs, sequences, search_docs (+FTS5), schema_migrations. Views: `v_specs`, `v_materials`. |
| Starter data | Units (MT, Ton, Kg, Quintal, Brass, Cum, CFT, Bags, Litre, Nos, Sqm, Rm), categories (Aggregate 6/10/20/40 MM, Dust types, Bitumen VG-10/30/40/PMB/CRMB, Cement/Sand/Emulsion/Lime/Soil/GSB/WMM), work activities, test names, generic formulas. All editable/archivable — **not** the only options. |

---

## 3. Backend modules (`electron/`)

- **`services/crud.ts` + `src/shared/modules.ts`** — one declarative definition per simple register (projects, categories, materials, specs, suppliers, supplier rates, activities, test types, formulas, units, invoices, payments, royalty, royalty rates, consumption, plans, quality, measurement, progress). The same definitions drive validation, SQL column whitelists, forms and tables.
- **`services/purchases.ts`** — multi-line purchase orders; tax-extra / tax-inclusive / exempt; freight, other charges, manual adjustment (needs a note); duplicate invoice warning; cannot reduce below received quantity or change supplier/project after deliveries; cancel with reason (blocked while deliveries exist); auto-creates supplier/material folders.
- **`services/receipts.ts`** — material inward: multiple weighbridge slips (`Net = Gross − Tare`), unit conversion Kg↔MT etc. (refuses weight→volume), ordered / received / accepted / rejected, difference, short-delivery flag (user-entered expected qty + tolerance), warnings for duplicate challan / invoice / slip / royalty pass / missing vehicle, auto-link to royalty pass, vehicle history, cancel with stock reversal. Never edits the purchase order.
- **`services/stock.ts`** — transaction-based inventory keyed by company + project + material + location. `Closing = Opening + Accepted inward + Returns − Consumption − Outward ± Adjustments`. Rejected material recorded but not counted. Duplicate-posting prevented by a unique index. Adjustments/outwards need a reason. Voiding keeps history. Period registers, ledger with running balance, low-stock alerts, valuation at weighted-average purchase rate.
- **`services/billing.ts`** — supplier balance = billed − (payments + advances + credit notes), computed from transactions only. Invoice/PO payment status auto-updates. Ledger with running balance, supplier profile, outstanding invoices.
- **`services/royalty.ts`** — pass-vs-received reconciliation within your tolerance; rate suggestion from your own effective-dated rate table. (No government verification.)
- **`services/documents.ts`** — attach files (copy, never move/overwrite; SHA-256 duplicate detection; extension allow-list; 250 MB cap), filed in the right folder; manual verification record; missing-file detection (flags, never deletes), relink, royalty-document gap report.
- **`services/search.ts`** — FTS5 trigram index: substring, case-insensitive, parent hierarchy, 17 entity types.
- **`services/backup.ts`** — manual/automatic backup (retention only prunes automatic ones), restore with confirmation + pre-restore safety copy + auto-rollback on failure, zip archive export, Excel copies.
- **`services/dashboard.ts`** — all numbers computed live.
- **`folderManager.ts`** — company / project / supplier / material folder trees, configurable templates, case-insensitive duplicate prevention, atomic writes, never overwrites.
- **`reports/`** — report kit + 30 report definitions; Excel via ExcelJS (orange/slate theme, title block, zebra rows, borders, Indian ₹ format, real dates, frozen header, auto-filter, A4 print setup, repeating header, footer with date/page, live `SUBTOTAL` formulas with correct cached results, quantity totals never mixed across units); HTML→PDF through Chromium.
- **`ipc.ts` / `preload.ts` / `main.ts`** — 70 whitelisted channels, each validated with Zod; sender check; paths confined to your record folders; executables never opened; CSP in production; sandboxed renderer; no new windows/navigation; permissions denied; single-instance lock; crash handling; log file.

---

## 4. Screens (`src/`)

New design system (IBM Plex Sans/Mono bundled offline, warm off-white paper, deep slate, safety-orange accent): buttons, inputs, exact-number inputs (money/qty/%), async searchable pickers, tables with totals, drawers, modals, tabs, toasts, confirm/reason dialogs, empty/loading/error states, error boundary.

| Screen | Contents |
|---|---|
| Dashboard | Companies, active projects, suppliers, categories, total purchases, material received, stock value, outstanding; recent transactions; low stock, pending invoices, missing royalty docs, short deliveries, missing files; recent reports; first-run guidance. |
| Companies | v1 workflow kept (smart text, field-by-field, Ctrl+Enter, success dialog, edit + re-export with backup, open Excel/folder); archive/restore; guarded permanent delete; folder repair; per-company stats. |
| Projects | Register + folder button. |
| Materials & Specs | Sizes/grades grouped by material; materials; categories; units; quick "add size/grade". |
| Suppliers | List + profile (balances, materials & rates, supply history, purchases, invoices, payments, royalty, ledger, documents, history). |
| Purchases | Line editor with agreed-rate auto-fill, live totals, deliveries tab, cancel, export. |
| Material Inward | Delivery form with slip grid, live net/received/accepted/difference, vehicle history, slips & documents tab, short/no-pass flags, registers export. |
| Royalty & Passes | Register, pass-vs-received, missing documents, rates, monthly summary, "suggest amount". |
| Inventory | Stock register (as-on / period), ledger drill-down, add stock entry, low stock, reconciliation reports. |
| Consumption | Entries, planned quantities, planned vs actual, summary. |
| Bills & Payments | Invoices (verify/approve), payments, outstanding bills, supplier ledger & monthly statement. |
| Quality Control | Test records with your limits/standard; test types. |
| Measurement Book | Measurements with revision history, site diary/progress, formulas. |
| Reports & Analytics | 30 reports, filters (company/project/supplier/material/period/month/FY/day), preview, Excel, PDF, history. |
| Document Center | Filter/search, verify, relink, add document, check files on disk. |
| Settings | Storage, Excel title, tolerance, folder structure, backup & restore, lists & formulas, system info. |
| Global search | `Ctrl+K` with open / folder / Excel / add document / history actions. |

---

## 5. Tests and verification

| Check | Result |
|---|---|
| Type-check (`npm run typecheck`) | clean |
| Automated tests (`npm test`) | 33 passed, 1 optional skipped (34 total): number/tax/weight math, formula safety, v1→v2 upgrade with backup, FTS search, transactions, full workflow (company→purchase→inward→stock→consumption→billing→royalty→quality→measurement), Excel read-back (formats, formulas, totals), search, dashboard, backup/restore, path-safety. |
| Real DB copy | Upgraded a copy of your real database: 2 companies, 19 fields preserved, integrity OK. |
| Smoke test (`npm run smoke`) | Real Electron app, dev build **and** packaged `.exe`: DB init, UI rendered, IPC, company created, Excel + PDF exported. |
| UI flow test | Real Purchase and Delivery forms driven in the UI: totals, linking, stock all correct. |
| Screenshot tour | 22+ screenshots of every screen, 0 console errors. |
| Installer | `release\Construction Record Manager Setup 2.0.0.exe` (123 MB). |

Bugs found by this testing and fixed: field-id collision between companies; blank optional amounts failing to save; every partial truckload wrongly flagged "short"; table cells wrapping badly; Esc not closing search from everywhere.

---

## 6. Other changes

- Installer slimmed: runtime packages are build-time only (everything is bundled), app archive 86 MB → 11 MB.
- Removed `sql.js` and the two broken v1 test scripts.
- New scripts: `npm test`, `npm run typecheck`, `npm run smoke`; developer-only screenshot tour in `scripts/tour/` (not shipped).
- README rewritten.

---

## 7. NOT done / not verified (honest list)

- Excel files were verified by reading them back with a library and structure checks — **not opened in desktop Excel**.
- **No government integration**: royalty/e-permit details are typed from documents; verification is manual; rates are yours to maintain.
- **No built-in engineering limits or formulas** (quality limits, standards, plans, formulas are user-entered).
- Weight→volume conversion (MT→Brass) is intentionally not guessed.
- Invoices are header-level (no invoice line items).
- Renaming a supplier/material starts a new folder for new files; old files stay put.
- Installer is **unsigned** with the default Electron icon (SmartScreen may warn).
- `npm run dev` (hot-reload mode) was not tested.
- The new version has **not been run against your live database** yet — first launch will upgrade it (with an automatic backup first).
