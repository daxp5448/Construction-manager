import path from 'path';
import { createCompanyFolderStructure } from '../folderManager';
import { generateCompanyExcel } from '../excelGenerator';
import { CompanyRecord, CreateCompanyInput, GenerateResult, UpdateCompanyInput } from '../../src/types';
import { findCompanyByName, getCompanyById, saveCompany } from './companies';
import { getSettings } from './settings';
import { validation } from '../errors';
import { newId } from '../db/util';

/** "Enter information → press Enter → get an organised Excel workbook + company folder". */
export async function createCompanyFlow(data: CreateCompanyInput): Promise<GenerateResult> {
  const name = (data.name || '').trim();
  if (!name) throw validation('Company Name is required.', { name: 'Required' });
  const settings = getSettings();
  const existing = findCompanyByName(name);
  const id = existing ? existing.id : `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const folders = await createCompanyFolderStructure(name, settings.storageRoot, { company: settings.folderTemplate });
  const now = new Date().toISOString();
  const record: CompanyRecord = {
    id,
    name,
    sanitizedName: folders.sanitizedName,
    folderPath: folders.companyFolderPath,
    excelPath: path.join(folders.infoFolderPath, `${folders.sanitizedName}_Details.xlsx`),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    fields: data.fields || [],
    notes: data.notes || '',
  };
  record.excelPath = await generateCompanyExcel({ company: record, targetFolder: folders.infoFolderPath, createBackupIfExists: true, headerTitle: settings.excelHeaderTitle });
  saveCompany(record);
  return { success: true, company: getCompanyById(id)!, folderPath: folders.companyFolderPath, excelPath: record.excelPath, fieldCount: record.fields.length };
}

export async function updateCompanyFlow(data: UpdateCompanyInput): Promise<GenerateResult> {
  const existing = getCompanyById(data.id);
  if (!existing) return { success: false, error: 'Company record not found.' };
  const name = (data.name || '').trim();
  if (!name) throw validation('Company Name is required.', { name: 'Required' });
  const settings = getSettings();
  // If the company is being renamed, keep working in its existing folder so records and documents stay together.
  const sameName = name.toLowerCase() === existing.name.toLowerCase();
  const keepFolder = sameName && !!existing.folderPath;
  const folders = keepFolder
    ? await createCompanyFolderStructure(path.basename(existing.folderPath), path.dirname(existing.folderPath), { company: settings.folderTemplate })
    : await createCompanyFolderStructure(name, settings.storageRoot, { company: settings.folderTemplate });
  const companyFolder = folders.companyFolderPath;
  const infoFolder = path.join(companyFolder, '01_Company_Information');
  const sanitized = sameName ? existing.sanitizedName : folders.sanitizedName;
  const updated: CompanyRecord = {
    ...existing,
    name,
    sanitizedName: sanitized,
    folderPath: companyFolder,
    excelPath: path.join(infoFolder, `${sanitized}_Details.xlsx`),
    fields: data.fields || [],
    notes: data.notes || '',
    updatedAt: new Date().toISOString(),
  };
  updated.excelPath = await generateCompanyExcel({ company: updated, targetFolder: infoFolder, createBackupIfExists: true, headerTitle: settings.excelHeaderTitle });
  saveCompany(updated);
  return { success: true, company: getCompanyById(data.id)!, folderPath: companyFolder, excelPath: updated.excelPath, fieldCount: updated.fields.length };
}

export async function regenerateCompanyExcel(id: string): Promise<GenerateResult> {
  const company = getCompanyById(id);
  if (!company) return { success: false, error: 'Company not found' };
  const settings = getSettings();
  const infoFolder = path.join(company.folderPath, '01_Company_Information');
  company.excelPath = await generateCompanyExcel({ company, targetFolder: infoFolder, createBackupIfExists: true, headerTitle: settings.excelHeaderTitle });
  company.updatedAt = new Date().toISOString();
  saveCompany(company);
  return { success: true, company: getCompanyById(id)!, folderPath: company.folderPath, excelPath: company.excelPath, fieldCount: company.fields.length };
}

/** Re-create any missing standard folders for a company (folder recovery). Existing files are never touched. */
export async function repairCompanyFolders(id: string) {
  const company = getCompanyById(id);
  if (!company) throw validation('Company not found.');
  const settings = getSettings();
  const root = path.dirname(company.folderPath);
  const res = await createCompanyFolderStructure(path.basename(company.folderPath), root, { company: settings.folderTemplate });
  return { folder: res.companyFolderPath, created: res.created };
}

void newId;
