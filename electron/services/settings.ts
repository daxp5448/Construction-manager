import path from 'path';
import { get, run } from '../db/core';
import { AppSettings } from '../../src/types';
import { getDefaultStorageRoot } from '../paths';

export const DEFAULT_COMPANY_FOLDERS = [
  '01_Company_Information',
  '02_Projects',
  '03_Bills_and_Invoices',
  '04_Contracts_and_Documents',
  '05_Site_Photos',
  '06_Exports',
  '07_Materials',
  '08_Suppliers',
  '09_Royalty_Records',
  '10_Reports',
  '11_Backups',
];
/** The first six are required by v1 (Excel lives in 01_…) and are always created. */
export const REQUIRED_COMPANY_FOLDERS = DEFAULT_COMPANY_FOLDERS.slice(0, 6);

export const DEFAULT_PROJECT_FOLDERS = ['01_Agreements', '02_BOQ', '03_Measurement_Books', '04_Daily_Progress', '05_Site_Photos'];
export const DEFAULT_SUPPLIER_FOLDERS = [
  'Invoices',
  'Purchase_Orders',
  'Delivery_Challans',
  'Weighbridge_Slips',
  'Royalty_Passes',
  'Stock_Records',
  'Reports',
  'Documents',
];

export function defaultSettings(): AppSettings {
  return {
    storageRoot: getDefaultStorageRoot(),
    excelHeaderTitle: 'CONSTRUCTION COMPANY RECORD',
    companyNameInTitle: true,
    backupBeforeUpdate: true,
    folderTemplate: [...DEFAULT_COMPANY_FOLDERS],
    projectFolderTemplate: [...DEFAULT_PROJECT_FOLDERS],
    supplierFolderTemplate: [...DEFAULT_SUPPLIER_FOLDERS],
    autoBackup: true,
    backupRetention: 15,
    backupDir: '',
    defaultStockLocation: 'Main Store',
    shortToleranceBp: 0,
    lowStockAlerts: true,
  };
}

let cached: AppSettings | null = null;

export function invalidateSettingsCache() {
  cached = null;
}

export function getSettings(): AppSettings {
  if (cached) return cached;
  let merged = defaultSettings();
  try {
    const row = get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'settings'`);
    if (row?.value) merged = { ...merged, ...JSON.parse(row.value) };
  } catch {
    /* fall back to defaults */
  }
  merged.folderTemplate = cleanFolderList(merged.folderTemplate, DEFAULT_COMPANY_FOLDERS, REQUIRED_COMPANY_FOLDERS);
  merged.projectFolderTemplate = cleanFolderList(merged.projectFolderTemplate, DEFAULT_PROJECT_FOLDERS);
  merged.supplierFolderTemplate = cleanFolderList(merged.supplierFolderTemplate, DEFAULT_SUPPLIER_FOLDERS);
  cached = merged;
  return merged;
}

/** Folder names from settings are untrusted: strip separators/traversal, dedupe case-insensitively. */
function cleanFolderList(list: unknown, fallback: string[], required: string[] = []): string[] {
  const src = Array.isArray(list) ? list : fallback;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...required, ...src]) {
    const name = String(raw ?? '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\.\.+/g, '_')
      .trim()
      .replace(/[. ]+$/, '');
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = { ...current, ...patch };
  if (typeof next.storageRoot !== 'string' || !next.storageRoot.trim()) next.storageRoot = current.storageRoot;
  next.storageRoot = path.resolve(next.storageRoot.trim());
  next.backupRetention = Math.max(1, Math.min(200, Math.round(Number(next.backupRetention) || 15)));
  next.shortToleranceBp = Math.max(0, Math.round(Number(next.shortToleranceBp) || 0));
  run(`INSERT INTO app_settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
    JSON.stringify(next),
  ]);
  cached = null;
  return getSettings();
}

/** Resolved backup directory (never inside a company folder). */
export function backupDirectory(): string {
  const s = getSettings();
  return s.backupDir && s.backupDir.trim() ? path.resolve(s.backupDir) : path.join(s.storageRoot, '_Database_Backups');
}
