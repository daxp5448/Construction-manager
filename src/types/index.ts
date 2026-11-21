export interface CompanyField {
  id: string;
  name: string;
  value: string;
}

export interface CompanyRecord {
  id: string;
  name: string;
  sanitizedName: string;
  folderPath: string;
  excelPath: string;
  createdAt: string;
  updatedAt: string;
  fields: CompanyField[];
  ownerName?: string;
  contactNumber?: string;
  email?: string;
  gstNumber?: string;
  address?: string;
  projectName?: string;
  notes?: string;
  deletedAt?: string | null;
}

export interface CreateCompanyInput {
  name: string;
  fields: CompanyField[];
  notes?: string;
}

export interface UpdateCompanyInput {
  id: string;
  name: string;
  fields: CompanyField[];
  notes?: string;
}

export interface AppSettings {
  storageRoot: string;
  excelHeaderTitle: string;
  companyNameInTitle: boolean;
  backupBeforeUpdate: boolean;
  /** Top-level folders created inside every company folder */
  folderTemplate: string[];
  /** Sub-folders created inside every project folder */
  projectFolderTemplate: string[];
  /** Sub-folders created inside every supplier / material folder */
  supplierFolderTemplate: string[];
  autoBackup: boolean;
  backupRetention: number;
  /** blank = <storageRoot>/_Database_Backups */
  backupDir: string;
  defaultStockLocation: string;
  /** receipts short by more than this (basis points of ordered qty) raise an alert */
  shortToleranceBp: number;
  lowStockAlerts: boolean;
}

export interface AppStats {
  totalCompanies: number;
  totalExcelFiles: number;
  recentlyCreated: CompanyRecord[];
  recentlyUpdated: CompanyRecord[];
}

export interface GenerateResult {
  success: boolean;
  company?: CompanyRecord;
  folderPath?: string;
  excelPath?: string;
  fieldCount?: number;
  error?: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
  warnings?: string[];
}
export interface ApiFail {
  ok: false;
  error: {
    message: string;
    code: 'VALIDATION' | 'NEEDS_CONFIRM' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL';
    fieldErrors?: Record<string, string>;
    warnings?: string[];
  };
}
export type ApiResult<T> = ApiOk<T> | ApiFail;

export interface ElectronAPI {
  // --- v1 company API (unchanged) ---
  createCompany: (data: CreateCompanyInput) => Promise<GenerateResult>;
  updateCompany: (data: UpdateCompanyInput) => Promise<GenerateResult>;
  getAllCompanies: (search?: string) => Promise<CompanyRecord[]>;
  getCompanyById: (id: string) => Promise<CompanyRecord | null>;
  deleteCompany: (id: string, deleteFiles: boolean) => Promise<{ success: boolean; error?: string }>;
  regenerateExcel: (id: string) => Promise<GenerateResult>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getStats: () => Promise<AppStats>;
  openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  showInFolder: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  selectDirectory: () => Promise<string | null>;
  getDefaultStoragePath: () => Promise<string>;
  // --- v2: single validated channel into the main process ---
  invoke: <T = any>(channel: string, payload?: unknown) => Promise<ApiResult<T>>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
