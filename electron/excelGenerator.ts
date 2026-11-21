import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { CompanyField, CompanyRecord } from '../src/types';

interface GenerateExcelParams {
  company: CompanyRecord;
  targetFolder: string;
  createBackupIfExists?: boolean;
  headerTitle?: string;
}

export async function generateCompanyExcel({
  company,
  targetFolder,
  createBackupIfExists = true,
  headerTitle,
}: GenerateExcelParams): Promise<string> {
  // Ensure target folder exists
  if (!fs.existsSync(targetFolder)) {
    await fs.promises.mkdir(targetFolder, { recursive: true });
  }

  const excelFileName = `${company.sanitizedName}_Details.xlsx`;
  const finalFilePath = path.join(targetFolder, excelFileName);

  // If file already exists and backup requested, create backup
  if (fs.existsSync(finalFilePath) && createBackupIfExists) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${company.sanitizedName}_Details_backup_${timestamp}.xlsx`;
      const backupFilePath = path.join(targetFolder, backupFileName);
      await fs.promises.copyFile(finalFilePath, backupFilePath);
    } catch (backupErr) {
      console.warn('Could not create backup of previous Excel file:', backupErr);
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Construction Record Manager';
  workbook.lastModifiedBy = 'Construction Record Manager';
  workbook.created = new Date(company.createdAt || new Date());
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Company Details', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.7,
        right: 0.7,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3,
      },
    },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }], // Freeze header above data rows
  });

  // Set column widths
  worksheet.columns = [
    { key: 'field', width: 32 },
    { key: 'value', width: 68 },
  ];

  // ==========================================
  // ROW 1: BRAND / CATEGORY BADGE
  // ==========================================
  worksheet.mergeCells('A1:B1');
  const bannerRow = worksheet.getCell('A1');
  bannerRow.value = (headerTitle && headerTitle.trim()) || 'CONSTRUCTION COMPANY RECORD';
  bannerRow.font = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  bannerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEA580C' }, // Construction Orange
  };
  bannerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 24;

  // ==========================================
  // ROW 2: MAIN COMPANY TITLE
  // ==========================================
  worksheet.mergeCells('A2:B2');
  const titleRow = worksheet.getCell('A2');
  titleRow.value = company.name.toUpperCase();
  titleRow.font = {
    name: 'Segoe UI',
    size: 18,
    bold: true,
    color: { argb: 'FF0F172A' }, // Deep Slate
  };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF8FAFC' },
  };
  titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 36;

  // ==========================================
  // ROW 3: METADATA SUBTITLE
  // ==========================================
  worksheet.mergeCells('A3:B3');
  const metaRow = worksheet.getCell('A3');
  const createdDateStr = new Date(company.createdAt || new Date()).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  metaRow.value = `Record ID: ${company.id}   •   Generated: ${createdDateStr}`;
  metaRow.font = {
    name: 'Segoe UI',
    size: 9,
    italic: true,
    color: { argb: 'FF64748B' }, // Slate-500
  };
  metaRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF8FAFC' },
  };
  metaRow.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(3).height = 20;

  // ==========================================
  // ROW 4: SPACER
  // ==========================================
  worksheet.getRow(4).height = 10;

  // ==========================================
  // ROW 5: TABLE HEADERS
  // ==========================================
  const headerRow = worksheet.getRow(5);
  headerRow.height = 28;

  const colA = worksheet.getCell('A5');
  colA.value = 'RECORD FIELD';
  colA.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  colA.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Dark Slate
  colA.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  colA.border = {
    bottom: { style: 'medium', color: { argb: 'FFEA580C' } },
  };

  const colB = worksheet.getCell('B5');
  colB.value = 'ENTERED INFORMATION';
  colB.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  colB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  colB.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  colB.border = {
    bottom: { style: 'medium', color: { argb: 'FFEA580C' } },
  };

  // ==========================================
  // DATA ROWS
  // ==========================================
  let currentRowIndex = 6;

  // Always list Company Name first
  const rowsData: { field: string; value: string }[] = [
    { field: 'Company Name', value: company.name },
  ];

  // Append all custom fields
  if (Array.isArray(company.fields)) {
    for (const item of company.fields) {
      if (item.name && item.name.toLowerCase() !== 'company name') {
        rowsData.push({ field: item.name, value: item.value || '' });
      }
    }
  }

  // Append optional notes if present
  if (company.notes && company.notes.trim()) {
    rowsData.push({ field: 'Additional Notes', value: company.notes.trim() });
  }

  // Add system timestamps
  rowsData.push({
    field: 'Date Created',
    value: new Date(company.createdAt || new Date()).toLocaleString('en-IN'),
  });
  rowsData.push({
    field: 'Last Updated',
    value: new Date(company.updatedAt || new Date()).toLocaleString('en-IN'),
  });
  rowsData.push({
    field: 'Folder Path',
    value: company.folderPath,
  });

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };

  for (let i = 0; i < rowsData.length; i++) {
    const item = rowsData[i];
    const row = worksheet.getRow(currentRowIndex);
    const isEven = i % 2 === 0;
    const bgArgb = isEven ? 'FFFFFFFF' : 'FFF8FAFC'; // Zebra striping

    // Field cell
    const cellA = worksheet.getCell(`A${currentRowIndex}`);
    cellA.value = item.field;
    cellA.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF334155' } };
    cellA.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cellA.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
    cellA.border = thinBorder;

    // Value cell
    const cellB = worksheet.getCell(`B${currentRowIndex}`);
    // Explicitly treat numbers/codes (phone, GST, etc.) as string to prevent Excel formatting corruption
    cellB.value = String(item.value ?? '');
    cellB.numFmt = '@'; // Force text format
    cellB.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF0F172A' } };
    cellB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cellB.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
    cellB.border = thinBorder;

    // Calculate dynamic row height based on content length
    const valLength = String(item.value || '').length;
    const lineBreaks = (String(item.value || '').match(/\n/g) || []).length;
    const estimatedLines = Math.max(1 + lineBreaks, Math.ceil(valLength / 60));
    row.height = Math.max(24, estimatedLines * 18);

    currentRowIndex++;
  }

  // Auto-filter on the data table
  worksheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: currentRowIndex - 1, column: 2 },
  };

  // Safe file write via temporary file
  const tempFilePath = path.join(targetFolder, `.${company.sanitizedName}_temp_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(tempFilePath);

  // Rename temp file over the destination (atomic replace; the previous version was already backed up above)
  await fs.promises.rename(tempFilePath, finalFilePath);

  return finalFilePath;
}
