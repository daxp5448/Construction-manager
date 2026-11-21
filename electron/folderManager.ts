import fs from 'fs';
import path from 'path';
import { folderSegment, getDefaultStorageRoot, sanitizeWindowsName } from './paths';
import {
  DEFAULT_COMPANY_FOLDERS,
  DEFAULT_PROJECT_FOLDERS,
  DEFAULT_SUPPLIER_FOLDERS,
  REQUIRED_COMPANY_FOLDERS,
} from './services/settings';

export { sanitizeWindowsName, getDefaultStorageRoot, folderSegment };

export interface FolderTemplates {
  company?: string[];
  project?: string[];
  supplier?: string[];
}

export interface FolderStructureResult {
  companyFolderPath: string;
  infoFolderPath: string;
  projectsFolderPath: string;
  billsFolderPath: string;
  contractsFolderPath: string;
  photosFolderPath: string;
  exportsFolderPath: string;
  materialsFolderPath: string;
  suppliersFolderPath: string;
  royaltyFolderPath: string;
  reportsFolderPath: string;
  backupsFolderPath: string;
  sanitizedName: string;
  created: string[];
}

/** mkdir -p that reports whether anything was actually created (no duplicate folders: case-insensitive on Windows). */
export function ensureDirSync(p: string, created?: string[]): string {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    created?.push(p);
  }
  return p;
}

/** Write a file atomically: temp file in the same folder, then rename over the target. */
export function atomicWriteFileSync(target: string, data: string | Uint8Array) {
  ensureDirSync(path.dirname(target));
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

/** Find an existing child folder whose name matches case-insensitively, so "Patel Crusher"/"patel crusher" never duplicate. */
export function findExistingChild(parent: string, name: string): string | null {
  try {
    const want = name.toLowerCase();
    for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.toLowerCase() === want) return path.join(parent, e.name);
    }
  } catch {
    /* parent missing */
  }
  return null;
}

/** A file name that does not collide with an existing file: "a.pdf" -> "a (2).pdf". Never overwrites. */
export function uniqueFilePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return candidate;
}

/**
 * Creates (or repairs) the standard company folder structure. Idempotent and non-destructive:
 * existing folders and files are left exactly as they are; missing folders are re-created.
 */
export async function createCompanyFolderStructure(
  companyName: string,
  storageRoot?: string,
  templates: FolderTemplates = {}
): Promise<FolderStructureResult> {
  const rootDir = storageRoot && storageRoot.trim() ? storageRoot.trim() : getDefaultStorageRoot();
  const sanitizedName = sanitizeWindowsName(companyName, 'Untitled_Company');
  const created: string[] = [];

  ensureDirSync(rootDir, created);
  const companyFolderPath = ensureDirSync(path.join(rootDir, sanitizedName), created);

  const names = unique([...REQUIRED_COMPANY_FOLDERS, ...(templates.company ?? DEFAULT_COMPANY_FOLDERS)]);
  for (const n of names) ensureDirSync(path.join(companyFolderPath, n), created);

  const sub = (name: string) => path.join(companyFolderPath, name);
  return {
    companyFolderPath,
    infoFolderPath: sub('01_Company_Information'),
    projectsFolderPath: sub('02_Projects'),
    billsFolderPath: sub('03_Bills_and_Invoices'),
    contractsFolderPath: sub('04_Contracts_and_Documents'),
    photosFolderPath: sub('05_Site_Photos'),
    exportsFolderPath: sub('06_Exports'),
    materialsFolderPath: ensureDirSync(sub('07_Materials'), created),
    suppliersFolderPath: ensureDirSync(sub('08_Suppliers'), created),
    royaltyFolderPath: ensureDirSync(sub('09_Royalty_Records'), created),
    reportsFolderPath: ensureDirSync(sub('10_Reports'), created),
    backupsFolderPath: ensureDirSync(sub('11_Backups'), created),
    sanitizedName,
    created,
  };
}

const unique = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** 02_Projects/<Project>/{01_Agreements,02_BOQ,...} */
export function ensureProjectFolders(companyFolder: string, projectName: string, template: string[] = DEFAULT_PROJECT_FOLDERS): string {
  const projectsRoot = ensureDirSync(path.join(companyFolder, '02_Projects'));
  const seg = sanitizeWindowsName(projectName, 'Project');
  const dir = findExistingChild(projectsRoot, seg) ?? path.join(projectsRoot, seg);
  ensureDirSync(dir);
  for (const n of template) ensureDirSync(path.join(dir, n));
  return dir;
}

/** 08_Suppliers/<Supplier>/{Invoices,...} — general supplier documents for this company. */
export function ensureSupplierFolders(companyFolder: string, supplierFolderName: string, template: string[] = DEFAULT_SUPPLIER_FOLDERS): string {
  const root = ensureDirSync(path.join(companyFolder, '08_Suppliers'));
  const seg = folderSegment(supplierFolderName, 'Supplier');
  const dir = findExistingChild(root, seg) ?? path.join(root, seg);
  ensureDirSync(dir);
  for (const n of template) ensureDirSync(path.join(dir, n));
  return dir;
}

/** Folder-name segment for a specification, matching the documented hierarchy (Aggregate/20_MM, Dust/Stone_Dust, Bitumen/VG_30). */
export function specFolderSegments(category: string, material: string, sizeGrade: string): [string, string] {
  const cat = folderSegment(category, 'Category');
  const std = !sizeGrade || /^standard$/i.test(sizeGrade.trim());
  if (std) return [cat, folderSegment(material, 'Material')];
  if (material.trim().toLowerCase() === category.trim().toLowerCase()) return [cat, folderSegment(sizeGrade, 'Spec')];
  return [cat, folderSegment(`${material} ${sizeGrade}`, 'Spec')];
}

/** 07_Materials/<Category>/<Spec>/<Supplier>/{Invoices,Delivery_Challans,...} */
export function ensureSupplierMaterialFolders(
  companyFolder: string,
  cat: string,
  material: string,
  sizeGrade: string,
  supplierFolderName: string,
  template: string[] = DEFAULT_SUPPLIER_FOLDERS
): string {
  const [c, s] = specFolderSegments(cat, material, sizeGrade);
  const materialsRoot = ensureDirSync(path.join(companyFolder, '07_Materials'));
  const catDir = findExistingChild(materialsRoot, c) ?? path.join(materialsRoot, c);
  ensureDirSync(catDir);
  const specDir = findExistingChild(catDir, s) ?? path.join(catDir, s);
  ensureDirSync(specDir);
  const supSeg = folderSegment(supplierFolderName, 'Supplier');
  const supDir = findExistingChild(specDir, supSeg) ?? path.join(specDir, supSeg);
  ensureDirSync(supDir);
  for (const n of template) ensureDirSync(path.join(supDir, n));
  return supDir;
}

/** Sub-folder inside a supplier-material folder for a document kind. */
export const DOC_SUBFOLDER: Record<string, string> = {
  invoice: 'Invoices',
  purchase_order: 'Purchase_Orders',
  delivery_challan: 'Delivery_Challans',
  weighbridge_slip: 'Weighbridge_Slips',
  royalty_pass: 'Royalty_Passes',
  stock_record: 'Stock_Records',
  report: 'Reports',
};
