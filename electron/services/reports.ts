import fs from 'fs';
import path from 'path';
import { all, get, run } from '../db/core';
import { newId, nowIso, audit } from '../db/util';
import { buildReport, REPORTS, ReportFilters } from '../reports/definitions';
import { htmlToPdf, renderHtml, toPreview, writeWorkbookFile } from '../reports/kit';
import { ensureDirSync, uniqueFilePath } from '../folderManager';
import { getSettings } from './settings';
import { sanitizeWindowsName } from '../paths';
import { notFound, validation } from '../errors';
import { indexEntity } from './search';

export function reportCatalog() {
  return REPORTS.map(({ build, ...rest }) => rest);
}

export function previewReport(id: string, filters: ReportFilters) {
  const { spec } = buildReport(id, filters);
  return toPreview(spec);
}

/** Where a report of this type is filed: <company>/10_Reports/<Type>/ or <root>/_Reports/<Type>/ for cross-company reports. */
function outputDir(folder: string, companyId?: string | null): string {
  if (companyId) {
    const c = get<any>('SELECT folder_path FROM companies WHERE id = ?', [companyId]);
    if (c?.folder_path) return ensureDirSync(path.join(c.folder_path, '10_Reports', folder));
  }
  return ensureDirSync(path.join(getSettings().storageRoot, '_Reports', folder));
}

const stampName = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

export async function generateReport(id: string, filters: ReportFilters, formats: Array<'xlsx' | 'pdf'>) {
  if (!formats.length) throw validation('Choose Excel, PDF or both.');
  const { def, spec, resolved } = buildReport(id, filters);
  const dir = outputDir(def.folder, filters.companyId);
  const period = filters.date || filters.month || (resolved.from || resolved.to ? `${resolved.from ?? 'start'}_to_${resolved.to ?? 'today'}` : 'all');
  const base = sanitizeWindowsName(`${def.title}${resolved.supplierName ? ' - ' + resolved.supplierName : ''}_${period}_${stampName()}`, 'Report');
  const out: any[] = [];
  for (const fmt of formats) {
    const target = uniqueFilePath(dir, `${base}.${fmt}`);
    if (fmt === 'xlsx') await writeWorkbookFile(spec, target);
    else await htmlToPdf(renderHtml(spec), target, (spec.orientation ?? 'landscape') === 'landscape', def.title);
    const rid = newId();
    const size = fs.statSync(target).size;
    run(
      `INSERT INTO generated_reports (id, report_type, title, company_id, project_id, params_json, period_from, period_to, format, file_path, size_bytes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [rid, id, def.title + (resolved.supplierName ? ` — ${resolved.supplierName}` : ''), filters.companyId ?? null, filters.projectId ?? null, JSON.stringify(filters), resolved.from, resolved.to, fmt, target, size]
    );
    audit('report', rid, 'generate', { summary: `Generated ${def.title} (${fmt.toUpperCase()})` });
    indexEntity('report', rid);
    out.push({ id: rid, format: fmt, file_path: target, size_bytes: size, title: def.title });
  }
  return out;
}

export function reportHistory(q: { companyId?: string | null; reportType?: string | null; limit?: number } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (q.companyId) (where.push('r.company_id = ?'), params.push(q.companyId));
  if (q.reportType) (where.push('r.report_type = ?'), params.push(q.reportType));
  const rows = all<any>(
    `SELECT r.*, c.name AS company_name, p.name AS project_name FROM generated_reports r LEFT JOIN companies c ON c.id = r.company_id LEFT JOIN projects p ON p.id = r.project_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC LIMIT ${Math.min(q.limit ?? 100, 500)}`,
    params
  );
  for (const r of rows) {
    const exists = fs.existsSync(r.file_path);
    if (!!r.is_missing === exists) run('UPDATE generated_reports SET is_missing = ? WHERE id = ?', [exists ? 0 : 1, r.id]);
    r.is_missing = exists ? 0 : 1;
  }
  return rows;
}

export function reportFile(id: string): { file: string; dir: string } {
  const r = get<any>('SELECT file_path FROM generated_reports WHERE id = ?', [id]);
  if (!r) throw notFound('Report');
  return { file: r.file_path, dir: path.dirname(r.file_path) };
}

export function reportFolderFor(companyId?: string | null): string {
  if (companyId) {
    const c = get<any>('SELECT folder_path FROM companies WHERE id = ?', [companyId]);
    if (c?.folder_path) return ensureDirSync(path.join(c.folder_path, '10_Reports'));
  }
  return ensureDirSync(path.join(getSettings().storageRoot, '_Reports'));
}

void nowIso;
