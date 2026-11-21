import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { formatDate, formatDateTime, formatINR, formatPct, formatQty } from '../../src/shared/num';

/**
 * Report kit: one declarative spec -> a professionally formatted Excel workbook, an HTML document
 * (for preview / PDF) and a structured preview. Same orange / dark-slate / white theme everywhere.
 */
export type ColType = 'text' | 'date' | 'datetime' | 'money' | 'money_signed' | 'qty' | 'int' | 'pct' | 'number';

export interface Col {
  header: string;
  key: string;
  width?: number;
  type?: ColType;
  /** emit a SUBTOTAL(109) total in the totals row */
  total?: boolean;
  wrap?: boolean;
  /** for qty columns: key of the column holding the unit */
  unitKey?: string;
}

export interface SheetSpec {
  name: string;
  title?: string;
  columns: Col[];
  rows: Array<Record<string, any>>;
  /** shown under the table */
  notes?: string[];
  /** hide the totals row even when columns have total:true */
  noTotals?: boolean;
  emptyMessage?: string;
}

export interface ReportSpec {
  title: string;
  companyName: string;
  projectName?: string | null;
  period?: string | null;
  filtersNote?: string | null;
  orientation?: 'landscape' | 'portrait';
  sheets: SheetSpec[];
}

export const THEME = {
  orange: 'FFEA580C',
  orangeSoft: 'FFFFF7ED',
  slate: 'FF1E293B',
  slateText: 'FF0F172A',
  slateMuted: 'FF64748B',
  border: 'FFE2E8F0',
  zebra: 'FFF8FAFC',
  white: 'FFFFFFFF',
  good: 'FF047857',
  bad: 'FFB91C1C',
};

const FONT = 'Segoe UI';
const MONEY_FMT = '[>=10000000]"₹ "##\\,##\\,##\\,##0.00;[>=100000]"₹ "##\\,##\\,##0.00;"₹ "##,##0.00';
const MONEY_SIGNED_FMT = '"₹ "#,##0.00;[Red]-"₹ "#,##0.00';
const FMT: Record<ColType, string> = {
  text: '@',
  date: 'dd-mmm-yyyy',
  datetime: 'dd-mmm-yyyy hh:mm',
  money: MONEY_FMT,
  money_signed: MONEY_SIGNED_FMT,
  qty: '#,##0.000',
  int: '#,##0',
  pct: '0.00%',
  number: '#,##0.00',
};
const DEFAULT_WIDTH: Record<ColType, number> = { text: 22, date: 13, datetime: 17, money: 16, money_signed: 16, qty: 13, int: 9, pct: 9, number: 12 };

const argb = (hex: string) => ({ argb: hex });
const thin = { style: 'thin' as const, color: argb(THEME.border) };
const borders: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellValue(type: ColType | undefined, v: any): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : String(v);
    }
    case 'datetime': {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(v));
      return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))) : String(v);
    }
    case 'money':
    case 'money_signed':
      return Math.round(Number(v)) / 100;
    case 'qty':
      return Math.round(Number(v)) / 1000;
    case 'pct':
      return Number(v) / 10000;
    case 'int':
    case 'number':
      return Number(v);
    default:
      return String(v);
  }
}

function plainValue(type: ColType | undefined, v: any, unit?: string): string {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    case 'money':
    case 'money_signed':
      return formatINR(Number(v));
    case 'qty':
      return formatQty(Number(v), unit);
    case 'pct':
      return formatPct(Number(v));
    case 'int':
      return String(Math.round(Number(v)));
    case 'number':
      return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    default:
      return String(v);
  }
}

const sheetName = (n: string) => n.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Sheet';

export interface TotalsRow {
  label: string;
  values: Record<string, number | string | null>;
}

/** Totals for HTML / preview and formula cached results. qty totals are only summed within one unit. */
export function computeTotals(sheet: SheetSpec): { main: Record<string, number | string>; byUnit: TotalsRow[] } {
  const main: Record<string, number | string> = {};
  const byUnit: TotalsRow[] = [];
  const totalCols = sheet.columns.filter((c) => c.total);
  for (const c of totalCols) {
    if (c.type === 'qty' && c.unitKey) {
      const units = new Set(sheet.rows.map((r) => r[c.unitKey!]).filter(Boolean));
      if (units.size <= 1) main[c.key] = sheet.rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
      else main[c.key] = 'mixed';
    } else {
      main[c.key] = sheet.rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
    }
  }
  const mixedQty = totalCols.filter((c) => c.type === 'qty' && c.unitKey && main[c.key] === 'mixed');
  if (mixedQty.length) {
    const unitKey = mixedQty[0].unitKey!;
    const units = [...new Set(sheet.rows.map((r) => r[unitKey]).filter(Boolean))].sort();
    for (const u of units) {
      const values: Record<string, number | string | null> = {};
      for (const c of mixedQty) values[c.key] = sheet.rows.filter((r) => r[unitKey] === u).reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
      byUnit.push({ label: `of which ${u}`, values });
    }
  }
  return { main, byUnit };
}

function bannerRows(ws: ExcelJS.Worksheet, spec: ReportSpec, sheet: SheetSpec, ncols: number) {
  const last = colLetter(Math.max(ncols, 2));
  const merge = (r: number) => ws.mergeCells(`A${r}:${last}${r}`);
  merge(1);
  const b = ws.getCell('A1');
  b.value = spec.title.toUpperCase();
  b.font = { name: FONT, size: 11, bold: true, color: argb(THEME.white) };
  b.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(THEME.orange) };
  b.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 24;

  merge(2);
  const t = ws.getCell('A2');
  t.value = spec.companyName ? spec.companyName.toUpperCase() : 'ALL COMPANIES';
  t.font = { name: FONT, size: 16, bold: true, color: argb(THEME.slateText) };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(THEME.zebra) };
  t.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 30;

  merge(3);
  const parts = [spec.projectName ? `Project: ${spec.projectName}` : null, spec.period ? `Period: ${spec.period}` : null, sheet.title && sheet.title !== spec.title ? sheet.title : null].filter(Boolean);
  const m = ws.getCell('A3');
  m.value = parts.join('   •   ') || ' ';
  m.font = { name: FONT, size: 10, color: argb(THEME.slateMuted) };
  m.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(THEME.zebra) };
  m.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 20;

  merge(4);
  const g = ws.getCell('A4');
  const gen = new Date();
  g.value = `Generated ${gen.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}${spec.filtersNote ? '   •   ' + spec.filtersNote : ''}`;
  g.font = { name: FONT, size: 9, italic: true, color: argb(THEME.slateMuted) };
  g.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(THEME.zebra) };
  g.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(4).height = 18;
  ws.getRow(5).height = 8;
}

export async function buildWorkbook(spec: ReportSpec): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Construction Record Manager';
  wb.lastModifiedBy = 'Construction Record Manager';
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = spec.title;
  const used = new Set<string>();

  for (const sheet of spec.sheets) {
    let name = sheetName(sheet.name);
    let i = 2;
    while (used.has(name.toLowerCase())) name = sheetName(sheet.name).slice(0, 28) + ` ${i++}`;
    used.add(name.toLowerCase());
    const ncols = sheet.columns.length;
    const HEADER_ROW = 6;
    const ws = wb.addWorksheet(name, {
      properties: { tabColor: argb(THEME.orange) },
      views: [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROW, showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: spec.orientation ?? (ncols > 6 ? 'landscape' : 'portrait'),
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
      },
      headerFooter: {
        oddFooter: `&L&8Construction Record Manager  |  Generated &D &T&C&8${spec.title.replace(/&/g, '&&')}&R&8Page &P of &N`,
      },
    });
    ws.columns = sheet.columns.map((c) => ({ key: c.key, width: c.width ?? DEFAULT_WIDTH[c.type ?? 'text'] }));
    bannerRows(ws, spec, sheet, ncols);

    const hr = ws.getRow(HEADER_ROW);
    hr.height = 30;
    sheet.columns.forEach((c, idx) => {
      const cell = hr.getCell(idx + 1);
      cell.value = c.header;
      cell.font = { name: FONT, size: 10, bold: true, color: argb(THEME.white) };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(THEME.slate) };
      cell.alignment = { horizontal: isNumeric(c.type) ? 'right' : 'left', vertical: 'middle', wrapText: true, indent: 1 };
      cell.border = { bottom: { style: 'medium', color: argb(THEME.orange) } };
    });

    const first = HEADER_ROW + 1;
    sheet.rows.forEach((row, ri) => {
      const r = ws.getRow(first + ri);
      const bg = ri % 2 === 0 ? THEME.white : THEME.zebra;
      sheet.columns.forEach((c, ci) => {
        const cell = r.getCell(ci + 1);
        cell.value = cellValue(c.type, row[c.key]);
        if (c.type && c.type !== 'text') cell.numFmt = FMT[c.type];
        else cell.numFmt = '@';
        cell.font = { name: FONT, size: 10, color: argb(THEME.slateText) };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(bg) };
        cell.border = borders;
        cell.alignment = { horizontal: isNumeric(c.type) ? 'right' : 'left', vertical: 'top', wrapText: c.wrap ?? c.type === undefined, indent: isNumeric(c.type) ? 0 : 1 };
      });
    });

    let lastRow = first + sheet.rows.length - 1;
    if (!sheet.rows.length) {
      ws.mergeCells(`A${first}:${colLetter(Math.max(ncols, 2))}${first}`);
      const e = ws.getCell(`A${first}`);
      e.value = sheet.emptyMessage ?? 'No records for the selected filters.';
      e.font = { name: FONT, size: 10, italic: true, color: argb(THEME.slateMuted) };
      e.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(first).height = 28;
      lastRow = first;
    } else {
      ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: lastRow, column: ncols } };
    }

    // totals: live SUBTOTAL formulas (respect filters) with correct cached results
    const totals = computeTotals(sheet);
    const hasTotals = !sheet.noTotals && sheet.rows.length > 0 && sheet.columns.some((c) => c.total);
    let cursor = lastRow + 1;
    if (hasTotals) {
      const tr = ws.getRow(cursor);
      tr.height = 22;
      sheet.columns.forEach((c, ci) => {
        const cell = tr.getCell(ci + 1);
        cell.font = { name: FONT, size: 10, bold: true, color: argb(THEME.slateText) };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(THEME.orangeSoft) };
        cell.border = { top: { style: 'medium', color: argb(THEME.orange) }, bottom: thin, left: thin, right: thin };
        cell.alignment = { horizontal: isNumeric(c.type) ? 'right' : 'left', vertical: 'middle', indent: isNumeric(c.type) ? 0 : 1 };
        if (ci === 0) cell.value = 'TOTAL';
        if (c.total) {
          const t = totals.main[c.key];
          if (t === 'mixed') {
            cell.value = 'see below';
            cell.font = { name: FONT, size: 9, italic: true, color: argb(THEME.slateMuted) };
          } else {
            const L = colLetter(ci + 1);
            const scale = c.type === 'money' || c.type === 'money_signed' ? 100 : c.type === 'qty' ? 1000 : 1;
            cell.value = { formula: `SUBTOTAL(109,${L}${first}:${L}${lastRow})`, result: Number(t) / scale };
            cell.numFmt = FMT[c.type ?? 'number'];
          }
        }
      });
      cursor++;
      for (const u of totals.byUnit) {
        const ur = ws.getRow(cursor++);
        sheet.columns.forEach((c, ci) => {
          const cell = ur.getCell(ci + 1);
          cell.font = { name: FONT, size: 9, italic: true, color: argb(THEME.slateMuted) };
          cell.alignment = { horizontal: isNumeric(c.type) ? 'right' : 'left', indent: isNumeric(c.type) ? 0 : 1 };
          if (ci === 0) cell.value = u.label;
          const v = u.values[c.key];
          if (v !== undefined && v !== null && c.type === 'qty') {
            cell.value = Math.round(Number(v)) / 1000;
            cell.numFmt = FMT.qty;
          }
        });
      }
    }
    if (sheet.notes?.length) {
      cursor++;
      for (const n of sheet.notes) {
        ws.mergeCells(`A${cursor}:${colLetter(Math.max(ncols, 2))}${cursor}`);
        const c = ws.getCell(`A${cursor}`);
        c.value = n;
        c.font = { name: FONT, size: 9, italic: true, color: argb(THEME.slateMuted) };
        c.alignment = { wrapText: true, vertical: 'top' };
        ws.getRow(cursor).height = Math.max(16, Math.ceil(n.length / 140) * 14);
        cursor++;
      }
    }
    ws.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;
    ws.pageSetup.printArea = `A1:${colLetter(Math.max(ncols, 2))}${Math.max(cursor - 1, first)}`;
  }
  return wb;
}

const isNumeric = (t?: ColType) => t === 'money' || t === 'money_signed' || t === 'qty' || t === 'int' || t === 'pct' || t === 'number';

/** Atomic write; if a file with the target name exists it is first copied to a timestamped backup (never overwritten silently). */
export async function writeWorkbookFile(spec: ReportSpec, target: string): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(target, target.replace(/\.xlsx$/i, `_backup_${ts}.xlsx`));
  }
  const wb = await buildWorkbook(spec);
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  await wb.xlsx.writeFile(tmp);
  fs.renameSync(tmp, target);
}

// ---------------------------------------------------------------- preview / HTML

export interface PreviewSheet {
  name: string;
  columns: Array<{ header: string; key: string; type: ColType | 'text'; unitKey?: string; total?: boolean }>;
  rows: Array<Record<string, any>>;
  totals: { main: Record<string, number | string>; byUnit: TotalsRow[] } | null;
  notes: string[];
  emptyMessage?: string;
}

export function toPreview(spec: ReportSpec): { title: string; companyName: string; projectName?: string | null; period?: string | null; sheets: PreviewSheet[] } {
  return {
    title: spec.title,
    companyName: spec.companyName,
    projectName: spec.projectName,
    period: spec.period,
    sheets: spec.sheets.map((s) => ({
      name: s.name,
      columns: s.columns.map((c) => ({ header: c.header, key: c.key, type: c.type ?? 'text', unitKey: c.unitKey, total: c.total })),
      rows: s.rows,
      totals: !s.noTotals && s.rows.length && s.columns.some((c) => c.total) ? computeTotals(s) : null,
      notes: s.notes ?? [],
      emptyMessage: s.emptyMessage,
    })),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderHtml(spec: ReportSpec): string {
  const gen = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const sheets = spec.sheets
    .map((s) => {
      const head = s.columns.map((c) => `<th class="${isNumeric(c.type) ? 'num' : ''}">${esc(c.header)}</th>`).join('');
      const body = s.rows
        .map(
          (r) =>
            `<tr>${s.columns.map((c) => `<td class="${isNumeric(c.type) ? 'num' : ''}">${esc(plainValue(c.type, r[c.key], c.unitKey ? r[c.unitKey] : undefined))}</td>`).join('')}</tr>`
        )
        .join('');
      const totals = !s.noTotals && s.rows.length && s.columns.some((c) => c.total) ? computeTotals(s) : null;
      let foot = '';
      if (totals) {
        foot += `<tr class="total">${s.columns
          .map((c, i) => {
            if (i === 0) return '<td>TOTAL</td>';
            if (!c.total) return '<td></td>';
            const v = totals.main[c.key];
            return `<td class="num">${v === 'mixed' ? 'see below' : esc(plainValue(c.type, v as number, undefined))}</td>`;
          })
          .join('')}</tr>`;
        for (const u of totals.byUnit) {
          foot += `<tr class="sub">${s.columns
            .map((c, i) => (i === 0 ? `<td>${esc(u.label)}</td>` : `<td class="num">${u.values[c.key] != null && c.type === 'qty' ? esc(plainValue('qty', u.values[c.key] as number)) : ''}</td>`))
            .join('')}</tr>`;
        }
      }
      const empty = !s.rows.length ? `<tr><td colspan="${s.columns.length}" class="empty">${esc(s.emptyMessage ?? 'No records for the selected filters.')}</td></tr>` : '';
      const notes = (s.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join('');
      return `<section><h2>${esc(s.name)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}${empty}</tbody><tfoot>${foot}</tfoot></table>${notes}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(spec.title)}</title>
<style>
  @page { size: A4 ${spec.orientation ?? 'landscape'}; margin: 12mm 10mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 9pt; margin: 0; }
  .banner { background: #ea580c; color: #fff; padding: 6px 12px; font-weight: 700; letter-spacing: .04em; font-size: 10pt; }
  .head { background: #f8fafc; padding: 8px 12px 6px; border-bottom: 1px solid #e2e8f0; margin-bottom: 10px; }
  .head h1 { font-size: 16pt; margin: 0 0 2px; }
  .head .meta { color: #64748b; font-size: 8.5pt; }
  section { margin-bottom: 14px; }
  h2 { font-size: 11pt; margin: 10px 0 4px; color: #1e293b; border-left: 4px solid #ea580c; padding-left: 8px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #1e293b; color: #fff; text-align: left; font-weight: 600; padding: 5px 6px; border-bottom: 2px solid #ea580c; font-size: 8.5pt; }
  td { padding: 4px 6px; border: 1px solid #e2e8f0; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { background: #fff7ed; font-weight: 700; border-top: 2px solid #ea580c; }
  tr.sub td { color: #64748b; font-style: italic; font-size: 8.5pt; }
  td.empty { text-align: center; color: #64748b; font-style: italic; padding: 14px; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  .note { color: #64748b; font-size: 8pt; font-style: italic; margin: 4px 0 0; }
</style></head><body>
<div class="banner">${esc(spec.title.toUpperCase())}</div>
<div class="head"><h1>${esc(spec.companyName || 'All companies')}</h1>
<div class="meta">${[spec.projectName ? 'Project: ' + esc(spec.projectName) : '', spec.period ? 'Period: ' + esc(spec.period) : '', 'Generated ' + esc(gen), spec.filtersNote ? esc(spec.filtersNote) : ''].filter(Boolean).join(' &nbsp;•&nbsp; ')}</div></div>
${sheets}
</body></html>`;
}

/** Render HTML to PDF with Electron's Chromium (needs the desktop runtime). */
export async function htmlToPdf(html: string, target: string, landscape: boolean, title: string): Promise<void> {
  let electron: any;
  try {
    electron = require('electron');
  } catch {
    throw new Error('PDF export is only available inside the desktop application.');
  }
  if (!electron?.BrowserWindow) throw new Error('PDF export is only available inside the desktop application.');
  const { BrowserWindow, app } = electron;
  const tmpDir = path.join(app.getPath('temp'), 'crm-report');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `r_${Date.now()}_${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(tmp);
    const esc2 = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const pdf: Buffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7px;color:#64748b;padding:0 10mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>Construction Record Manager &nbsp;|&nbsp; ${esc2(title)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margins: { top: 0.4, bottom: 0.55, left: 0.35, right: 0.35 },
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const t2 = target + '.tmp';
    fs.writeFileSync(t2, pdf);
    fs.renameSync(t2, target);
  } finally {
    win.destroy();
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
