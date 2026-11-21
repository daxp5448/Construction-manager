# Construction Record Manager — Road Construction Edition

An offline-first Windows desktop application for managing the records of a road-construction business: companies and projects, material masters, suppliers, purchases, material inward with weighbridge slips, royalty / transit passes, stock, consumption, supplier bills and payments, quality tests, measurement books, daily progress, and formatted Excel / PDF reports.

**Core idea:** *Enter data → records are organised automatically → Excel is generated → database is updated → reports are produced.* Everything works locally, with no internet.

---

## What's inside

| Area | What it does |
|---|---|
| **Companies** | v1 workflow preserved: name + fields (smart multiline or field-by-field) → company folder tree + formatted `[Company]_Details.xlsx` + database record. Archive / restore / (guarded) permanent delete. |
| **Projects** | Per company; each gets its own folder (`01_Agreements`, `02_BOQ`, `03_Measurement_Books`, `04_Daily_Progress`, `05_Site_Photos`). |
| **Materials & specs** | Category → Material → Size/grade (e.g. Aggregate → 20 MM, Bitumen → VG-30). Fully editable: custom categories, sizes, grades, units, minimum stock, “needs royalty pass”, archive instead of delete. |
| **Suppliers** | Independent master with GST/PAN/bank/terms; each supplier supplies many materials at their own rates; profile with purchases, invoices, payments, royalty, supply history, ledger. |
| **Purchases** | Multi-line orders; `Subtotal = Qty × Rate`, `Tax = Subtotal × Tax% ÷ 100`, `Grand total = Subtotal + Tax + Freight + Other ± Adjustment`; tax-extra / tax-inclusive / exempt; duplicate-invoice guard; cancel with reason; full audit trail. |
| **Material inward** | Per-delivery register: vehicle, driver, challan, invoice, royalty pass, **multiple weighbridge slips** (`Net = Gross − Tare`), ordered/received/accepted/rejected, short-delivery and duplicate warnings. Never edits the purchase order. |
| **Royalty & passes** | Register of pass / e-permit details with the original document attached; links to inward and invoice; duplicate detection; pass-vs-received reconciliation; missing-document tracking; effective-dated rate table you maintain. **Verification is manual — nothing is checked against any government system.** |
| **Inventory** | Transaction-based: `Closing = Opening + Accepted inward + Returns − Consumption − Outward ± Adjustments`. Ordered and rejected quantities never count. Adjustments need a reason; history is never deleted. |
| **Consumption** | Daily use by chainage and activity; posts to stock; planned-vs-actual using plans you enter. |
| **Bills & payments** | Invoice register (verify / approve), payments, advances, credit notes. *Billed*, *paid* and *outstanding* are computed from transactions and shown separately. |
| **Quality control** | Test records with **your** limits and reference standard (the app ships no acceptance limits). |
| **Measurement book** | Configurable quantity formulas (safe evaluator), never-overwritten measurements with revision history, site diary, daily progress, road-work register. |
| **Reports** | 30 report definitions (the 18 required Excel templates plus daily/monthly composites, statements, reconciliations). Live preview, Excel (live `SUBTOTAL` formulas, Indian currency format, frozen headers, filters, print setup) and PDF. Saved in `<Company>/10_Reports/…`, never overwriting. |
| **Search** | `Ctrl+K` global search (SQLite FTS5, substring & case-insensitive) with parent hierarchy and quick actions. |
| **Documents** | Attach PDFs/photos to any record; filed into the structured folders; missing-file detection that never deletes records. |
| **Backup** | Automatic + manual database backup, restore (with confirmation and a safety copy), zip archive export, Excel copies, pre-upgrade backups. |

### Folder structure (configurable under Settings → Folder structure)

```
Documents\Construction Company Records\<Company>\
  01_Company_Information\   (the company workbook lives here)
  02_Projects\<Project>\ 01_Agreements, 02_BOQ, 03_Measurement_Books, 04_Daily_Progress, 05_Site_Photos
  03_Bills_and_Invoices\<Supplier>\
  04_Contracts_and_Documents\
  05_Site_Photos\  06_Exports\
  07_Materials\<Category>\<Size or grade>\<Supplier>\ Invoices, Purchase_Orders, Delivery_Challans,
                                                       Weighbridge_Slips, Royalty_Passes, Stock_Records, Reports, Documents
  08_Suppliers\  09_Royalty_Records\  10_Reports\  11_Backups\
```

Folders are only ever **added** — existing folders and files are never renamed, moved, overwritten or deleted. Workbooks are copied to a time-stamped backup before being replaced.

---

## Technology

Electron 45 (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) · React 19 + TypeScript + Vite · Tailwind CSS v4 · ExcelJS · **SQLite via Node's built-in `node:sqlite`** (native, WAL, real transactions, FTS5) · electron-builder.

*Change from v1:* the database driver moved from `sql.js` (WebAssembly, rewrote the whole file on every save, no FTS5) to the native driver built into Electron 45. The database file and location are the same, so existing data is picked up and upgraded in place.

### Data model conventions
Money = integer **paise**, quantities/weights = integer **milli-units**, percentages = integer **basis points**; all multiplication uses BigInt. No floating-point money anywhere. Soft deletion (`deleted_at`) and an `audit_logs` table throughout. Schema changes run as versioned migrations; before upgrading an existing database a snapshot is written to `%APPDATA%\construction-company-records\Backups`.

### Security
Typed IPC through a whitelist in `preload`; every payload validated with Zod; no Node access in the renderer; file operations restricted to the configured record folders (path traversal blocked, executables never opened); the renderer cannot open windows or navigate away; CSP in production; single-instance lock; crash handling and logging to `%APPDATA%\construction-company-records\logs\app.log`.

---

## Develop, test, build

```bash
npm run dev            # Vite + Electron (hot reload)
npm run typecheck      # tsc --noEmit
npm test               # 34 tests: math, migrations, FTS, end-to-end workflows, Excel read-back, backup/restore
npm run smoke          # launches the real Electron app, loads the UI, exports Excel + PDF
npm run build          # UI + main process bundles
npm run pack           # unpacked app  -> release\win-unpacked\
npm run package:win    # NSIS installer -> release\Construction Record Manager Setup 2.0.0.exe
node scripts/smoke.js "release/win-unpacked/Construction Record Manager.exe"   # smoke-test the packaged build
```

The test runner bundles `tests/*.test.ts` with esbuild so tests exercise the production modules, each in an isolated temp data directory (your real data is never touched). `CRM_REAL_DB_COPY=<copy.sqlite> node scripts/run-tests.js realcopy` upgrades a *copy* of a real v1 database and verifies nothing is lost.

> If you launch Electron from an editor terminal that sets `ELECTRON_RUN_AS_NODE`, clear it first, otherwise Electron behaves like plain Node.

---

## Known limitations

* **No government integration.** Royalty / e-permit details are typed from the original documents and verification is a manual record. Royalty rates are yours to maintain; the official notification always governs.
* **No built-in engineering limits or formulas.** Quality limits, reference standards, planned quantities and measurement formulas are user-entered (or the default “product of entered dimensions”).
* **Unit conversion is within a kind only** (Kg ↔ MT ↔ Quintal, Cum ↔ Brass ↔ CFT). Weight → volume (MT → Brass) needs a density and is never assumed — enter the received quantity manually.
* **Invoices are header-level** (taxable / tax / other / total); line items live on the purchase order.
* Renaming a supplier or material starts a new folder for new files; existing files stay where they are (their records keep pointing at them).
* Excel files are verified by reading them back with ExcelJS and by structure/format checks; they were not opened in desktop Excel by the automated tests. Signed-column negative amounts over ₹1 lakh use standard (not lakh) digit grouping in Excel.
* The installer is **unsigned** and uses the default Electron icon, so Windows SmartScreen may warn on first run.
