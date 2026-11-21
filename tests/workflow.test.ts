import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { sandbox } from './helpers';

const sb = sandbox('workflow');
import { initDatabase } from '../electron/db';
import { all, get, scalar } from '../electron/db/core';
import { dispatch, defineHandlers, assertAllChannelsHandled, setPlatform } from '../electron/ipc';
import { CHANNELS } from '../src/shared/channels';
import { createCompanyFlow, updateCompanyFlow, repairCompanyFolders } from '../electron/services/companyFlow';
import { getCompanyById } from '../electron/services/companies';
import { saveRecord, listRecords, removeRecord, restoreRecord } from '../electron/services/crud';
import '../electron/services/hooks';
import { savePurchase, cancelPurchase, getPurchase } from '../electron/services/purchases';
import { saveReceipt, cancelReceipt, getReceipt, listReceipts } from '../electron/services/receipts';
import { stockRegister, postManualStock, stockLedger, voidManualStock } from '../electron/services/stock';
import { supplierBalance, supplierLedger, supplierProfile } from '../electron/services/billing';
import { royaltyReconciliation, suggestRoyalty } from '../electron/services/royalty';
import { attachFiles, checkFileIntegrity, royaltyDocumentGaps, resolveDocFolder } from '../electron/services/documents';
import { generateReport, previewReport, reportCatalog } from '../electron/services/reports';
import { createBackup, restoreBackup, listBackups, exportArchive } from '../electron/services/backup';
import { searchQuery } from '../electron/services/search';
import { getDashboard } from '../electron/services/dashboard';
import { REPORTS } from '../electron/reports/definitions';
import { ApiError } from '../electron/errors';

test.after(() => sb.cleanup());

let companyId = '';
let projectId = '';
let supplierId = '';
let spec20: string; // Aggregate 20 MM
let specSand: string;
const specId = (label: string) => get<any>('SELECT id FROM v_specs WHERE label = ?', [label])!.id as string;

async function expectApiError(fn: () => any, code?: string, msg?: RegExp) {
  try {
    await fn();
  } catch (e: any) {
    assert.ok(e instanceof ApiError, `expected ApiError, got ${e?.stack || e}`);
    if (code) assert.equal(e.code, code, e.message);
    if (msg) assert.match(e.message, msg);
    return e as ApiError;
  }
  assert.fail('expected an error');
}

test('IPC: every channel has a validated handler; unknown / malformed calls are rejected', async () => {
  initDatabase();
  defineHandlers();
  assertAllChannelsHandled();
  setPlatform({ openPath: async () => '', showItemInFolder: () => {}, pickFiles: async () => [], pickFolder: async () => null, appVersion: 't', versions: {} });
  assert.ok(CHANNELS.length > 60);
  const bad = await dispatch('nope.nothing', {});
  assert.equal(bad.ok, false);
  const badInput = await dispatch('crud.list', { module: 'sqlite_master' });
  assert.equal(badInput.ok, false);
  const traversal = await dispatch('system.openPath', { path: path.join(sb.storageRoot, '..', '..', 'Windows', 'System32', 'cmd.exe') });
  assert.equal(traversal.ok, false);
  assert.match(traversal.error!.message, /outside|denied/i);
  const exe = path.join(sb.storageRoot, 'evil.exe');
  fs.writeFileSync(exe, 'x');
  const blocked = await dispatch('system.openPath', { path: exe });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error!.code, 'FORBIDDEN');
});

test('regression: v1 company workflow still produces folder + Excel + SQLite record', async () => {
  const r = await createCompanyFlow({
    name: 'Daksh Road Builders',
    fields: [
      { id: 'a', name: 'Owner Name', value: 'Daksh' },
      { id: 'b', name: 'Contact Number', value: '9876543210' },
      { id: 'c', name: 'GST Number', value: '24ABCDE1234F1Z5' },
      { id: 'd', name: 'Office Address', value: 'Ahmedabad, Gujarat' },
    ],
    notes: 'First company',
  });
  assert.equal(r.success, true);
  companyId = r.company!.id;
  const root = r.folderPath!;
  for (const d of ['01_Company_Information', '02_Projects', '03_Bills_and_Invoices', '04_Contracts_and_Documents', '05_Site_Photos', '06_Exports']) {
    assert.ok(fs.existsSync(path.join(root, d)), `legacy folder ${d}`);
  }
  // new extended structure
  for (const d of ['07_Materials', '08_Suppliers', '09_Royalty_Records', '10_Reports', '11_Backups']) assert.ok(fs.existsSync(path.join(root, d)), d);
  // Excel
  assert.ok(r.excelPath!.endsWith('Daksh Road Builders_Details.xlsx'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(r.excelPath!);
  const ws = wb.getWorksheet('Company Details')!;
  assert.equal(ws.getCell('A2').value, 'DAKSH ROAD BUILDERS');
  const values = ws.getColumn(2).values as any[];
  assert.ok(values.includes('9876543210'));
  assert.equal(typeof ws.getCell('B8').value, 'string'); // phone/GST remain text
  // DB extracted attributes
  const c = getCompanyById(companyId)!;
  assert.equal(c.ownerName, 'Daksh');
  assert.equal(c.gstNumber, '24ABCDE1234F1Z5');

  // user file inside the folder is never overwritten by re-running
  const userFile = path.join(root, '04_Contracts_and_Documents', 'my-contract.pdf');
  fs.writeFileSync(userFile, 'ORIGINAL');
  const u = await updateCompanyFlow({ id: companyId, name: 'Daksh Road Builders', fields: [{ id: 'a', name: 'Owner Name', value: 'Daksh Shah' }] });
  assert.equal(u.success, true);
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'ORIGINAL');
  const backups = fs.readdirSync(path.join(root, '01_Company_Information')).filter((f) => f.includes('_backup_'));
  assert.ok(backups.length >= 1, 'previous workbook backed up before overwrite');
  assert.equal(getCompanyById(companyId)!.fields.length, 1);

  // folder recovery
  fs.rmSync(path.join(root, '07_Materials'), { recursive: true });
  const rep = await repairCompanyFolders(companyId);
  assert.ok(rep.created.some((p) => p.endsWith('07_Materials')));
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'ORIGINAL');
});

test('regression: two companies may both submit a field with the same client-side id', async () => {
  const a = await createCompanyFlow({ name: 'Collision Co A', fields: [{ id: '1', name: 'Owner Name', value: 'A' }] });
  const b = await createCompanyFlow({ name: 'Collision Co B', fields: [{ id: '1', name: 'Owner Name', value: 'B' }] });
  assert.equal(a.success && b.success, true);
  assert.equal(getCompanyById(a.company!.id)!.fields[0].value, 'A');
  assert.equal(getCompanyById(b.company!.id)!.fields[0].value, 'B');
});

test('project, supplier and material master: custom categories/specs, supplier rates, folders', async () => {
  const proj = saveRecord('projects', { values: { company_id: companyId, name: 'Dholka–Bagodara Road Widening', code: 'P-01', client_name: 'R&B Dept', status: 'active', contract_value_paise: 12500000000 } });
  projectId = proj.row.id;
  const pf = get<any>('SELECT folder_path FROM projects WHERE id = ?', [projectId])!.folder_path;
  assert.ok(fs.existsSync(path.join(pf, '01_Agreements')) && fs.existsSync(path.join(pf, '03_Measurement_Books')));

  // duplicate project name in same company is refused
  await expectApiError(() => saveRecord('projects', { values: { company_id: companyId, name: 'dholka–bagodara road widening' } }), 'VALIDATION');

  // custom category + material + spec (not limited to the seeded list)
  const cat = saveRecord('categories', { values: { name: 'Geosynthetics', default_unit: 'Sqm' } }).row;
  const mat = saveRecord('materials', { values: { category_id: cat.id, name: 'Geogrid', default_unit: 'Sqm' } }).row;
  const sp = saveRecord('specs', { values: { material_id: mat.id, size_grade: 'Biaxial 30kN', unit_code: 'Sqm', standard_rate_paise: 15000, min_stock_milli: 500000 } }).row;
  assert.equal(get<any>('SELECT label FROM v_specs WHERE id = ?', [sp.id])!.label, 'Geogrid Biaxial 30kN');
  // custom size under existing category
  const agg = get<any>(`SELECT id FROM materials WHERE name = 'Aggregate'`)!.id;
  saveRecord('specs', { values: { material_id: agg, size_grade: '12.5 MM', unit_code: 'MT' } });
  // unit conversion helpers exist and weight units are configurable
  saveRecord('units', { values: { code: 'Tonne', name: 'Tonne (alt)', kind: 'weight', to_base: 1000 } });
  await expectApiError(() => saveRecord('units', { values: { code: 'Tonne', name: 'dup', kind: 'weight', to_base: 1 } }), 'VALIDATION');
  // archive a spec, it disappears from pickers but data stays
  const tmp = saveRecord('specs', { values: { material_id: agg, size_grade: 'Temp', unit_code: 'MT' } }).row;
  removeRecord('specs', tmp.id);
  assert.equal(listRecords('specs', { search: 'Temp' }).rows.length, 0);
  assert.equal(listRecords('specs', { archived: true }).rows.length, 1);
  restoreRecord('specs', tmp.id);
  assert.equal(listRecords('specs', { search: 'Temp' }).rows.length, 1);

  const s = saveRecord('suppliers', { values: { name: 'Patel Crusher', contact_person: 'Ramesh Patel', mobile: '9898989898', gst_no: '24AAAPP1234A1Z5', pan_no: 'AAAPP1234A', payment_terms: '30 days' } });
  supplierId = s.row.id;
  assert.match(s.row.code, /^SUP-\d{4}$/);
  // unique supplier name
  await expectApiError(() => saveRecord('suppliers', { values: { name: 'PATEL CRUSHER' } }), 'VALIDATION');
  // bad GST is a confirmable warning, not a silent accept
  const w = await expectApiError(() => saveRecord('suppliers', { values: { name: 'Odd GST Supplier', gst_no: '123' } }), 'NEEDS_CONFIRM');
  assert.match(w.warnings![0], /GST/);
  saveRecord('suppliers', { values: { name: 'Odd GST Supplier', gst_no: '123' } }, { allowDuplicate: true });

  spec20 = specId('Aggregate 20 MM');
  specSand = specId('Sand');
  // one supplier, many materials, individual rates
  saveRecord('supplierMaterials', { values: { supplier_id: supplierId, spec_id: spec20, rate_paise: 125000, tax_bp: 500 } });
  saveRecord('supplierMaterials', { values: { supplier_id: supplierId, spec_id: specId('Aggregate 10 MM'), rate_paise: 130000, tax_bp: 500 } });
  saveRecord('supplierMaterials', { values: { supplier_id: supplierId, spec_id: specId('Stone Dust'), rate_paise: 80000, tax_bp: 500 } });
  await expectApiError(() => saveRecord('supplierMaterials', { values: { supplier_id: supplierId, spec_id: spec20, rate_paise: 1 } }), 'VALIDATION');
  assert.equal(listRecords('supplierMaterials', { filters: { supplier_id: supplierId } }).rows.length, 3);
});

let poId = '';
let poItemId = '';
let receiptId = '';

test('purchase: calculations, persistence, duplicate guard, cancel', async () => {
  const input = {
    purchase_date: '2026-11-10',
    company_id: companyId,
    project_id: projectId,
    supplier_id: supplierId,
    invoice_no: 'inv-778',
    freight_paise: 150000,
    other_charges_paise: 25000,
    items: [
      { spec_id: spec20, qty_milli: 100000, rate_paise: 125000, tax_bp: 500 },
      { spec_id: specId('Stone Dust'), qty_milli: 40000, rate_paise: 80000, tax_bp: 500 },
    ],
  };
  const { purchase, created } = savePurchase(input);
  assert.equal(created, true);
  poId = purchase.id;
  poItemId = purchase.items[0].id;
  // 100 MT × 1250 = 1,25,000.00 ; 40 MT × 800 = 32,000.00
  assert.equal(purchase.items[0].subtotal_paise, 12500000);
  assert.equal(purchase.items[0].tax_paise, 625000);
  assert.equal(purchase.items[1].subtotal_paise, 3200000);
  assert.equal(purchase.subtotal_paise, 15700000);
  assert.equal(purchase.tax_paise, 785000);
  assert.equal(purchase.total_paise, 15700000 + 785000 + 150000 + 25000);
  assert.match(purchase.po_no, /^PO\/26-27\/0001$/);
  assert.equal(purchase.invoice_no, 'INV-778');
  assert.equal(purchase.delivery_status, 'pending');
  // supplier/material folders created automatically, exactly once
  const matDir = path.join(getCompanyById(companyId)!.folderPath, '07_Materials', 'Aggregate', '20_MM', 'Patel_Crusher');
  for (const d of ['Invoices', 'Purchase_Orders', 'Delivery_Challans', 'Weighbridge_Slips', 'Royalty_Passes', 'Stock_Records', 'Reports', 'Documents']) assert.ok(fs.existsSync(path.join(matDir, d)), d);
  assert.ok(fs.existsSync(path.join(getCompanyById(companyId)!.folderPath, '07_Materials', 'Dust', 'Stone_Dust', 'Patel_Crusher')));

  // re-saving does not duplicate folders
  savePurchase({ ...input, id: poId, items: purchase.items.map((i: any) => ({ id: i.id, spec_id: i.spec_id, qty_milli: i.qty_milli, rate_paise: i.rate_paise, tax_bp: i.tax_bp })) });
  assert.equal(fs.readdirSync(path.join(getCompanyById(companyId)!.folderPath, '07_Materials', 'Aggregate')).length, 1);

  // same invoice number for same supplier → needs confirmation
  const e = await expectApiError(() => savePurchase({ ...input, items: [{ spec_id: spec20, qty_milli: 1000, rate_paise: 1000 }] }), 'NEEDS_CONFIRM');
  assert.match(e.warnings!.join(' '), /already recorded/);
  // manual adjustments need an explanation; negative total refused
  await expectApiError(() => savePurchase({ ...input, invoice_no: 'X1', adjustment_paise: -1000 }), 'VALIDATION', /note/);
  await expectApiError(() => savePurchase({ ...input, invoice_no: 'X2', items: [{ spec_id: spec20, qty_milli: 0, rate_paise: 1 }] }), 'VALIDATION', /quantity/i);

  // audit trail exists
  const audit = all<any>(`SELECT action FROM audit_logs WHERE entity_type='purchase' AND entity_id = ?`, [poId]).map((a) => a.action);
  assert.deepEqual(audit, ['create', 'update']);

  // cancel needs a reason and (later) blocks when receipts exist
  const p2 = savePurchase({ ...input, invoice_no: 'TMP-1', items: [{ spec_id: spec20, qty_milli: 1000, rate_paise: 1000 }] }, { allowDuplicate: true }).purchase;
  await expectApiError(() => cancelPurchase(p2.id, ''), 'VALIDATION');
  assert.equal(cancelPurchase(p2.id, 'ordered by mistake').status, 'cancelled');
  await expectApiError(() => savePurchase({ ...input, id: p2.id, items: [{ spec_id: spec20, qty_milli: 1000, rate_paise: 1000 }] }), 'VALIDATION', /cancelled/);
});

test('inward + weighbridge: net weight, linked to purchase, never edits the purchase, stock only from ACCEPTED qty', async () => {
  const base = {
    received_at: '2026-11-12T10:30',
    company_id: companyId,
    project_id: projectId,
    supplier_id: supplierId,
    purchase_id: poId,
    purchase_item_id: poItemId,
    vehicle_no: 'gj 01 ab 1234',
    driver_name: 'Kishan',
    challan_no: 'DC-501',
    invoice_no: 'inv-778',
    royalty_pass_no: 'rp-0001',
    ordered_qty_milli: 25000,
    slips: [{ slip_no: 'W-9001', weighbridge_name: 'Sai Dharm Kanta', weight_unit: 'MT', gross_milli: 38250, tare_milli: 14100 }],
  };
  const before = JSON.stringify(getPurchase(poId));
  const { receipt } = saveReceipt({ ...base, rejected_qty_milli: 1000, rejection_reason: 'Oversize particles' });
  receiptId = receipt.id;
  // Net = Gross − Tare = 24.150 MT; received 24.150; rejected 1.000; accepted 23.150
  assert.equal(receipt.slips[0].net_milli, 24150);
  assert.equal(receipt.received_qty_milli, 24150);
  assert.equal(receipt.accepted_qty_milli, 23150);
  assert.equal(receipt.rejected_qty_milli, 1000);
  assert.equal(receipt.vehicle_no, 'GJ01AB1234');
  // Ordered for THIS delivery (challan qty) = 25.000; difference = ordered − received = 0.850 short
  assert.equal(receipt.ordered_qty_milli, 25000);
  assert.equal(receipt.difference_milli, 850);
  assert.equal(receipt.short, true);
  // purchase record untouched by an inward that differs from the order
  const po = getPurchase(poId);
  assert.equal(po.items[0].qty_milli, 100000);
  assert.equal(po.total_paise, JSON.parse(before).total_paise);
  assert.equal(po.items[0].received_milli, 24150);
  assert.equal(po.items[0].pending_milli, 100000 - 24150);
  assert.equal(po.delivery_status, 'partial');

  // stock = accepted only (ordered 100 and rejected 1 never counted)
  let st = stockRegister({ companyId, projectId, specId: spec20 });
  assert.equal(st.length, 1);
  assert.equal(st[0].inward_milli, 23150);
  assert.equal(st[0].closing_milli, 23150);
  assert.equal(st[0].rejected_milli, 1000);
  assert.equal(st[0].avg_rate_paise, 125000);
  assert.equal(st[0].value_paise, Math.round((23150 * 125000) / 1000));

  // duplicate challan / slip / pass => must confirm, and nothing is posted twice
  const e = await expectApiError(() => saveReceipt({ ...base, vehicle_no: 'GJ01AB9999' }), 'NEEDS_CONFIRM');
  assert.ok(e.warnings!.length >= 3, e.warnings!.join(' | '));
  assert.equal(stockRegister({ companyId, projectId, specId: spec20 })[0].inward_milli, 23150);

  // second delivery against the same order (multiple deliveries, multiple slips)
  const second = saveReceipt({
    received_at: '2026-11-13T08:00',
    company_id: companyId,
    project_id: projectId,
    supplier_id: supplierId,
    purchase_id: poId,
    purchase_item_id: poItemId,
    vehicle_no: 'GJ01CD5678',
    challan_no: 'DC-502',
    slips: [
      { slip_no: 'W-9002', weighbridge_name: 'Sai Dharm Kanta', weight_unit: 'MT', gross_milli: 30000, tare_milli: 10000 },
      { slip_no: 'W-9003', weighbridge_name: 'Sai Dharm Kanta', weight_unit: 'MT', gross_milli: 28500, tare_milli: 9500 },
    ],
  }).receipt;
  assert.equal(second.received_qty_milli, 39000);
  assert.equal(second.accepted_qty_milli, 39000);
  // no expected quantity was entered: a partial truckload against a big order is NOT flagged as short
  assert.equal(second.ordered_qty_milli, null);
  assert.equal(second.short, false);
  assert.equal(getPurchase(poId).items[0].received_milli, 24150 + 39000);
  st = stockRegister({ companyId, projectId, specId: spec20 });
  assert.equal(st[0].closing_milli, 23150 + 39000);

  // unit conversion from weighbridge KG into the material's MT
  const kg = saveReceipt({
    received_at: '2026-11-14T08:00',
    company_id: companyId,
    project_id: projectId,
    supplier_id: supplierId,
    spec_id: specId('Stone Dust'),
    vehicle_no: 'GJ05XX0001',
    slips: [{ slip_no: 'K-1', weight_unit: 'Kg', gross_milli: 30_000_000, tare_milli: 10_000_000 }],
  }).receipt;
  assert.equal(kg.received_qty_milli, 20000); // 20,000 kg = 20.000 MT
  // weight can't be converted into Bags/Brass without a user-supplied quantity: never guessed
  await expectApiError(
    () => saveReceipt({ received_at: '2026-11-14T09:00', company_id: companyId, project_id: projectId, supplier_id: supplierId, spec_id: specSand, vehicle_no: 'GJ05XX0002', slips: [{ weight_unit: 'MT', gross_milli: 20000, tare_milli: 8000 }] }),
    'VALIDATION',
    /cannot be converted/
  );
  // validation
  await expectApiError(() => saveReceipt({ ...base, vehicle_no: 'GJ09ZZ0001', challan_no: 'N1', invoice_no: 'N1', royalty_pass_no: 'N1', slips: [{ slip_no: 'bad', weight_unit: 'MT', gross_milli: 10, tare_milli: 20 }] }), 'VALIDATION', /tare/i);
  await expectApiError(() => saveReceipt({ ...base, challan_no: 'N2', invoice_no: 'N2', royalty_pass_no: 'N2', slips: undefined, received_qty_milli: 1000, rejected_qty_milli: 2000 }), 'VALIDATION', /exceed/);

  // vehicle history & lists
  assert.equal(listReceipts({ vehicle_no: 'gj 01 cd 5678' }).rows.length, 1);
  assert.equal(listReceipts({ supplier_id: supplierId }).total, 3);
});

test('editing / cancelling a receipt re-posts stock exactly once (no double counting)', async () => {
  const r = getReceipt(receiptId)!;
  // reduce the rejection
  saveReceipt(
    {
      id: receiptId,
      received_at: r.received_at,
      company_id: companyId,
      project_id: projectId,
      supplier_id: supplierId,
      purchase_id: poId,
      purchase_item_id: poItemId,
      vehicle_no: r.vehicle_no,
      challan_no: r.challan_no,
      invoice_no: r.invoice_no,
      royalty_pass_no: r.royalty_pass_no,
      rejected_qty_milli: 0,
      slips: r.slips.map((s: any) => ({ slip_no: s.slip_no, weighbridge_name: s.weighbridge_name, weight_unit: s.weight_unit, gross_milli: s.gross_milli, tare_milli: s.tare_milli })),
    },
    { allowDuplicate: true }
  );
  let st = stockRegister({ companyId, projectId, specId: spec20 })[0];
  assert.equal(st.inward_milli, 24150 + 39000);
  assert.equal(st.rejected_milli, 0);
  const live = scalar<number>(`SELECT COUNT(*) FROM stock_transactions WHERE source_type='receipt' AND source_id = ? AND voided_at IS NULL`, [receiptId]);
  assert.equal(live, 1);
  const voided = scalar<number>(`SELECT COUNT(*) FROM stock_transactions WHERE source_type='receipt' AND source_id = ? AND voided_at IS NOT NULL`, [receiptId]);
  assert.ok((voided ?? 0) >= 2, 'history of earlier postings preserved');

  // cancelling reverses stock and releases the PO quantity
  const rc = saveReceipt({ received_at: '2026-11-15T08:00', company_id: companyId, project_id: projectId, supplier_id: supplierId, spec_id: spec20, vehicle_no: 'GJ01TMP', received_qty_milli: 5000 }).receipt;
  assert.equal(stockRegister({ companyId, projectId, specId: spec20 })[0].closing_milli, 24150 + 39000 + 5000);
  await expectApiError(() => cancelReceipt(rc.id, ''), 'VALIDATION');
  cancelReceipt(rc.id, 'wrong entry');
  st = stockRegister({ companyId, projectId, specId: spec20 })[0];
  assert.equal(st.closing_milli, 24150 + 39000);
  await expectApiError(() => saveReceipt({ id: rc.id, received_at: '2026-11-15T08:00', company_id: companyId, project_id: projectId, supplier_id: supplierId, spec_id: spec20, received_qty_milli: 1 }), 'VALIDATION', /cancelled/);
  // purchase with live receipts cannot be cancelled
  await expectApiError(() => cancelPurchase(poId, 'x'), 'VALIDATION', /receipt/);
});

test('consumption reduces stock; negative stock needs confirmation; manual adjustments need a reason', async () => {
  const vals = { usage_date: '2026-11-16', company_id: companyId, project_id: projectId, spec_id: spec20, qty_milli: 10000, site_location: 'Km 3+200', chainage_from: '3+200', chainage_to: '3+500', equipment: 'Paver' };
  const act = get<any>(`SELECT id FROM work_activities WHERE name = 'WMM'`)!.id;
  const c = saveRecord('consumption', { values: { ...vals, activity_id: act } }).row;
  assert.equal(c.unit_code, 'MT'); // unit is taken from the material, not trusted from input
  let st = stockRegister({ companyId, projectId, specId: spec20 })[0];
  assert.equal(st.consumption_milli, 10000);
  assert.equal(st.closing_milli, 24150 + 39000 - 10000);
  // Closing = Opening + Inward + Returns − Consumption − Outward ± Adjustments
  assert.equal(st.closing_milli, st.opening_milli + st.inward_milli + st.return_milli - st.consumption_milli - st.outward_milli + st.adjustment_milli);

  // edit consumption → stock re-posts once
  saveRecord('consumption', { id: c.id, values: { ...vals, qty_milli: 12000 } });
  st = stockRegister({ companyId, projectId, specId: spec20 })[0];
  assert.equal(st.consumption_milli, 12000);

  // more than available: warns (confirmable), nothing posted until confirmed
  const e = await expectApiError(() => saveRecord('consumption', { values: { ...vals, qty_milli: 900_000 } }), 'NEEDS_CONFIRM');
  assert.match(e.warnings![0], /negative/);
  assert.equal(stockRegister({ companyId, projectId, specId: spec20 })[0].consumption_milli, 12000);

  // manual stock entries
  await expectApiError(() => postManualStock({ txnDate: '2026-11-17', companyId, projectId, specId: spec20, type: 'adjustment', qtyMilli: -500 }), 'VALIDATION', /reason/);
  const adj = postManualStock({ txnDate: '2026-11-17', companyId, projectId, specId: spec20, type: 'adjustment', qtyMilli: -500, reason: 'Physical count shortage' });
  postManualStock({ txnDate: '2026-11-01', companyId, projectId, specId: specSand, type: 'opening', qtyMilli: 50000 });
  st = stockRegister({ companyId, projectId, specId: spec20 })[0];
  assert.equal(st.adjustment_milli, -500);
  assert.equal(st.closing_milli, 24150 + 39000 - 12000 - 500);
  const sand = stockRegister({ companyId, projectId, specId: specSand })[0];
  assert.equal(sand.opening_milli, 50000);
  assert.equal(sand.value_paise, null); // never purchased => unvalued rather than invented
  // period register: opening = balance before the period
  const dayReg = stockRegister({ companyId, projectId, specId: spec20, from: '2026-11-16', to: '2026-11-16' })[0];
  assert.equal(dayReg.opening_milli, 24150 + 39000);
  assert.equal(dayReg.consumption_milli, 12000);
  assert.equal(dayReg.closing_milli, 24150 + 39000 - 12000);
  // void manual entry keeps history, restores balance
  voidManualStock(adj, 'Recounted');
  assert.equal(stockRegister({ companyId, projectId, specId: spec20 })[0].adjustment_milli, 0);
  const ledger = stockLedger(companyId, projectId, spec20);
  assert.ok(ledger.some((l) => l.voided_at));
  assert.equal(ledger[ledger.length - 1].balance_milli, 24150 + 39000 - 12000);
  // system-posted entries cannot be voided by hand
  const sys = ledger.find((l) => l.source_type === 'receipt' && !l.voided_at)!;
  await expectApiError(() => voidManualStock(sys.id, 'x'), 'VALIDATION', /Edit or cancel/);
  // deleting consumption restores stock
  removeRecord('consumption', c.id);
  assert.equal(stockRegister({ companyId, projectId, specId: spec20 })[0].closing_milli, 24150 + 39000);
});

let invoiceId = '';
test('supplier money: invoice vs payment vs outstanding are kept separate', async () => {
  const inv = saveRecord('invoices', { values: { invoice_no: 'inv-778', invoice_date: '2026-11-12', company_id: companyId, project_id: projectId, supplier_id: supplierId, purchase_id: poId, subtotal_paise: 15700000, tax_paise: 785000, other_paise: 175000 } });
  invoiceId = inv.row.id;
  assert.equal(inv.row.total_paise, 16660000); // derived: subtotal + tax + other
  assert.equal(inv.row.payment_status, 'unpaid');
  let b = supplierBalance(supplierId);
  assert.equal(b.billed_paise, 16660000);
  assert.equal(b.paid_paise, 0);
  assert.equal(b.outstanding_paise, 16660000);
  // an advance before billing and a part payment against the invoice
  saveRecord('payments', { values: { supplier_id: supplierId, company_id: companyId, project_id: projectId, payment_date: '2026-11-05', kind: 'advance', amount_paise: 2000000, mode: 'neft', reference_no: 'UTR1' } });
  saveRecord('payments', { values: { supplier_id: supplierId, company_id: companyId, project_id: projectId, payment_date: '2026-11-20', kind: 'payment', amount_paise: 5000000, mode: 'rtgs', reference_no: 'UTR2', invoice_id: invoiceId } });
  b = supplierBalance(supplierId);
  assert.equal(b.billed_paise, 16660000);
  assert.equal(b.paid_paise, 5000000);
  assert.equal(b.advance_paise, 2000000);
  assert.equal(b.outstanding_paise, 16660000 - 7000000);
  assert.equal(get<any>('SELECT payment_status FROM invoices WHERE id = ?', [invoiceId])!.payment_status, 'partial');
  assert.equal(get<any>('SELECT payment_status FROM purchase_orders WHERE id = ?', [poId])!.payment_status, 'partial');
  // credit note reduces what we owe
  saveRecord('payments', { values: { supplier_id: supplierId, company_id: companyId, payment_date: '2026-11-21', kind: 'credit_note', amount_paise: 160000, reference_no: 'CN-1' } });
  assert.equal(supplierBalance(supplierId).outstanding_paise, 16660000 - 7000000 - 160000);
  // overpaying an invoice warns
  const w = await expectApiError(() => saveRecord('payments', { values: { supplier_id: supplierId, company_id: companyId, payment_date: '2026-11-22', kind: 'payment', amount_paise: 99999999, invoice_id: invoiceId } }), 'NEEDS_CONFIRM');
  assert.match(w.warnings![0], /above/);
  // pay it off fully → invoice paid
  saveRecord('payments', { values: { supplier_id: supplierId, company_id: companyId, payment_date: '2026-11-23', kind: 'payment', amount_paise: 16660000 - 5000000, invoice_id: invoiceId } });
  assert.equal(get<any>('SELECT payment_status FROM invoices WHERE id = ?', [invoiceId])!.payment_status, 'paid');
  // total settled > billed ⇒ the surplus shows as advance, outstanding negative (never hidden)
  b = supplierBalance(supplierId);
  assert.equal(b.outstanding_paise, 16660000 - (5000000 + 11660000 + 2000000 + 160000));
  assert.equal(b.unapplied_advance_paise, 2160000);
  // ledger running balance
  const l = supplierLedger(supplierId);
  assert.equal(l.lines[0].kind, 'advance');
  assert.equal(l.lines[l.lines.length - 1].balance_paise, b.outstanding_paise);
  assert.equal(l.total_billed_paise, 16660000);
  // optional amounts left blank are zero, not an error
  const bare = saveRecord('invoices', { values: { invoice_no: 'BARE-1', invoice_date: '2026-11-12', company_id: companyId, supplier_id: supplierId, subtotal_paise: 50000 } });
  assert.equal(bare.row.tax_paise, 0);
  assert.equal(bare.row.total_paise, 50000);
  removeRecord('invoices', bare.row.id);
  // duplicate invoice number → confirm
  await expectApiError(() => saveRecord('invoices', { values: { invoice_no: 'INV-778', invoice_date: '2026-11-12', company_id: companyId, supplier_id: supplierId, subtotal_paise: 1 } }), 'NEEDS_CONFIRM');
  // an invoice with payments cannot be archived silently
  await expectApiError(() => removeRecord('invoices', invoiceId), 'VALIDATION', /payment/);
  const prof = supplierProfile(supplierId);
  assert.equal(prof.totals.purchased_paise, getPurchase(poId).total_paise);
  assert.equal(prof.materials.length, 3);
  assert.equal(prof.supply.find((s: any) => s.spec_label === 'Aggregate 20 MM').received_milli, 24150 + 39000);
  assert.equal(prof.by_project.length, 1);
});

test('royalty: net weight, duplicate pass detection, link with inward, reconciliation, missing docs, user-set verification', async () => {
  const roy = saveRecord('royalty', {
    values: { pass_no: 'rp-0001', e_permit_no: 'EP-77', dispatch_at: '2026-11-12T07:15', mineral_name: 'Ordinary Stone', grade: '20 MM', lease_holder: 'Shree Lease', supplier_id: supplierId, vehicle_no: 'gj 01 ab 1234', weight_unit: 'MT', gross_milli: 38250, tare_milli: 14100, destination: 'Km 3 site', company_id: companyId, project_id: projectId, valid_from: '2026-11-12T06:00', valid_to: '2026-11-12T20:00' },
  }).row;
  assert.equal(roy.net_milli, 24150); // Net = Gross − Tare
  assert.equal(roy.vehicle_no, 'GJ01AB1234');
  assert.equal(roy.pass_no, 'RP-0001');
  assert.equal(roy.verification_status, 'unverified'); // never auto-verified
  // linked automatically to the inward carrying the same pass number
  assert.equal(get<any>('SELECT receipt_id FROM royalty_passes WHERE id = ?', [roy.id])!.receipt_id, receiptId);
  // duplicate pass number / e-permit
  const e = await expectApiError(() => saveRecord('royalty', { values: { pass_no: 'RP-0001', e_permit_no: 'ep-77', dispatch_at: '2026-11-12T08:00', vehicle_no: 'GJ01AB1234', company_id: companyId } }), 'NEEDS_CONFIRM');
  assert.ok(e.warnings!.length >= 2);
  // dispatch outside validity
  const e2 = await expectApiError(() => saveRecord('royalty', { values: { pass_no: 'RP-0099', dispatch_at: '2026-11-13T23:00', valid_to: '2026-11-13T12:00', vehicle_no: 'GJ01AB1234', company_id: companyId } }), 'NEEDS_CONFIRM');
  assert.match(e2.warnings!.join(' '), /after the pass validity/);

  let rec = royaltyReconciliation({ companyId });
  const g = rec.receipts.find((r: any) => r.receipt_id === receiptId)!;
  assert.equal(g.pass_total_milli, 24150);
  assert.equal(g.received_milli, 24150);
  assert.equal(g.status, 'matched');
  // pass says 25 MT but only 24.15 received → received LESS
  saveRecord('royalty', { id: roy.id, values: { ...roy, gross_milli: 39100, tare_milli: 14100 } });
  rec = royaltyReconciliation({ companyId });
  const g2 = rec.receipts.find((r: any) => r.receipt_id === receiptId)!;
  assert.equal(g2.pass_total_milli, 25000);
  assert.equal(g2.difference_milli, -850);
  assert.equal(g2.status, 'received_less');

  // Aggregate requires royalty: receipts 2 (no pass) are flagged; the pass has no scanned document yet
  const gaps = royaltyDocumentGaps({ companyId });
  assert.ok(gaps.receipts_without_pass.some((r: any) => r.receipt_no === getReceipt(receiptId)!.receipt_no) === false);
  assert.ok(gaps.receipts_without_pass.length >= 1);
  assert.equal(gaps.passes_without_document.length, 1);
  assert.equal(gaps.unverified_passes.length, 1);

  // attach the original document → gap closes; verification is manual and records who/when
  const src = path.join(sb.base, 'rp0001.pdf');
  fs.writeFileSync(src, '%PDF-1.4 fake');
  const att = attachFiles({ entityType: 'royalty', entityId: roy.id, docType: 'royalty_pass', sourcePaths: [src] });
  assert.equal(att.attached.length, 1);
  const stored = att.attached[0].stored_path as string;
  assert.ok(stored.includes('09_Royalty_Records') && stored.includes('Patel_Crusher'), stored);
  assert.equal(fs.readFileSync(stored, 'utf8'), '%PDF-1.4 fake');
  assert.equal(royaltyDocumentGaps({ companyId }).passes_without_document.length, 0);
  // same file twice is skipped, not duplicated; blocked types are refused; original untouched
  const again = attachFiles({ entityType: 'royalty', entityId: roy.id, docType: 'royalty_pass', sourcePaths: [src] });
  assert.equal(again.attached.length, 0);
  assert.match(again.skipped[0], /identical/);
  const exe = path.join(sb.base, 'x.exe');
  fs.writeFileSync(exe, 'MZ');
  assert.match(attachFiles({ entityType: 'royalty', entityId: roy.id, docType: 'royalty_pass', sourcePaths: [exe] }).skipped[0], /not allowed/);
  assert.ok(fs.existsSync(src));
  saveRecord('royalty', { id: roy.id, values: { ...roy, gross_milli: 38250, tare_milli: 14100, verification_status: 'verified', verified_by: 'Daksh', verification_notes: 'Checked against original pass' } });
  const v = get<any>('SELECT verification_status, verified_on, verified_by FROM royalty_passes WHERE id = ?', [roy.id])!;
  assert.equal(v.verification_status, 'verified');
  assert.match(v.verified_on, /^\d{4}-\d{2}-\d{2}$/);

  // missing-file detection never deletes records
  fs.unlinkSync(stored);
  const integ = checkFileIntegrity();
  assert.equal(integ.missingDocuments.length, 1);
  assert.equal(scalar<number>('SELECT COUNT(*) FROM documents WHERE is_missing = 1'), 1);
  assert.equal(scalar<number>('SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL'), 1);
  fs.writeFileSync(stored, 'back');
  assert.equal(checkFileIntegrity().recovered, 1);

  // royalty rate: effective-dated, user-maintained
  saveRecord('royaltyRates', { values: { mineral_name: 'Ordinary Stone', unit_code: 'MT', rate_paise: 12000, effective_from: '2026-04-01', reference_note: 'Notification (user entered)' } });
  saveRecord('royaltyRates', { values: { mineral_name: 'Ordinary Stone', unit_code: 'MT', rate_paise: 15000, effective_from: '2026-12-01' } });
  assert.equal(suggestRoyalty('ordinary stone', null, '2026-11-12', 24150, 'MT')!.amount_paise, Math.round((24150 * 12000) / 1000));
  assert.equal(suggestRoyalty('ordinary stone', null, '2026-12-05', 24150, 'MT')!.rate.rate_paise, 15000);
  assert.equal(suggestRoyalty('unknown mineral', null, '2026-11-12', 1000, 'MT'), null);
});

test('quality, measurement revisions, daily progress', async () => {
  const tt = get<any>(`SELECT id FROM test_types WHERE name = 'Aggregate impact value'`)!.id;
  const q = saveRecord('quality', { values: { test_date: '2026-11-11', company_id: companyId, project_id: projectId, spec_id: spec20, supplier_id: supplierId, test_type_id: tt, result_value: '24.5', unit: '%', standard_ref: 'User-chosen spec, edition per user', limit_max: 30, laboratory: 'City Lab' } }).row;
  assert.match(q.test_no, /^QT\/26-27\/\d{4}$/);
  assert.equal(q.result_status, 'pass');
  assert.equal(saveRecord('quality', { id: q.id, values: { result_value: '31' } }).row.result_status, 'fail');
  // no limits => stays pending: the app never invents acceptance limits
  const q2 = saveRecord('quality', { values: { test_date: '2026-11-11', company_id: companyId, project_id: projectId, test_type_id: tt, result_value: '12' } }).row;
  assert.equal(q2.result_status, 'pending');
  await expectApiError(() => saveRecord('quality', { values: { test_date: '2026-11-11', company_id: companyId, project_id: projectId, test_type_id: tt, result_value: '1', limit_min: 10, limit_max: 5 } }), 'VALIDATION');

  const m = saveRecord('measurement', { values: { mb_no: 'MB-12/45', measured_on: '2026-11-18', company_id: companyId, project_id: projectId, work_description: 'WMM layer', chainage_from: '3+000', chainage_to: '3+500', length_milli: 500000, width_milli: 7000, depth_milli: 150, boq_ref: '4.2', unit_code: 'Cum' } }).row;
  assert.equal(m.qty_milli, 525000); // 500 × 7 × 0.150 = 525 cum
  assert.equal(m.revision, 1);
  await expectApiError(() => saveRecord('measurement', { id: m.id, values: { length_milli: 400000 } }), 'VALIDATION', /reason/);
  const rev = saveRecord('measurement', { id: m.id, values: { length_milli: 400000 } }, { reason: 'Re-measured after joint inspection' }).row;
  assert.equal(rev.revision, 2);
  assert.equal(rev.qty_milli, 420000);
  assert.equal(rev.entry_group, m.entry_group);
  // original preserved in history, only latest is listed
  const orig = get<any>('SELECT * FROM measurement_entries WHERE id = ?', [m.id])!;
  assert.equal(orig.qty_milli, 525000);
  assert.ok(orig.superseded_at);
  assert.equal(listRecords('measurement').rows.length, 1);
  assert.equal(all('SELECT 1 FROM measurement_entries WHERE entry_group = ?', [m.entry_group]).length, 2);
  // custom formula stored on the entry so later formula edits can't silently change history
  const f = saveRecord('formulas', { values: { name: 'Nos × L × W', expression: 'n*l*w', unit_code: 'Sqm' } }).row;
  assert.equal(f.expression, 'N*L*W');
  await expectApiError(() => saveRecord('formulas', { values: { name: 'bad', expression: 'L**W' } }), 'VALIDATION');
  const m2 = saveRecord('measurement', { values: { mb_no: 'MB-12/46', measured_on: '2026-11-18', company_id: companyId, project_id: projectId, work_description: 'Surface area', length_milli: 10000, width_milli: 3000, nos_milli: 4000, formula_id: f.id } }).row;
  assert.equal(m2.qty_milli, 120000);
  assert.equal(m2.formula_expr, 'N*L*W');

  const act = get<any>(`SELECT id FROM work_activities WHERE name = 'DBM'`)!.id;
  const d = saveRecord('progress', { values: { entry_date: '2026-11-18', company_id: companyId, project_id: projectId, register: 'progress', activity_id: act, work_done: 'DBM laid km 3+000 to 3+200', qty_done_milli: 1400000, unit_code: 'MT', labour_count: 28 } }).row;
  assert.equal(d.labour_count, 28);

  // planned vs actual uses user-entered plan only
  const plan = saveRecord('consumptionPlans', { values: { project_id: projectId, spec_id: spec20, planned_qty_milli: 500000, basis_note: 'From estimate sheet, user entered' } }).row;
  assert.equal(plan.unit_code, 'MT');
});

test('reports: every definition builds; Excel is correctly formatted with live formulas & right totals', async () => {
  assert.ok(reportCatalog().length >= 28);
  const needs: Record<string, any> = {
    supplier_ledger: { supplierId },
    supplier_statement: { supplierId, month: '2026-11' },
    daily_report: { date: '2026-11-12' },
    monthly_report: { month: '2026-11' },
  };
  for (const d of REPORTS) {
    const prev = previewReport(d.id, { companyId, ...(needs[d.id] ?? {}) });
    assert.ok(prev.sheets.length >= 1, d.id);
    for (const s of prev.sheets) {
      const keys = new Set(s.columns.map((c) => c.key));
      assert.equal(keys.size, s.columns.length, `${d.id}/${s.name} duplicate column keys`);
    }
  }
  // required missing filters are reported cleanly
  await expectApiError(() => previewReport('supplier_ledger', {}), 'VALIDATION');
  await expectApiError(() => previewReport('monthly_report', {}), 'VALIDATION');

  // Purchase register workbook: read it back and verify numbers, formats, formulas
  const [x] = await generateReport('purchase_register', { companyId, from: '2026-11-01', to: '2026-11-30' }, ['xlsx']);
  assert.ok(x.file_path.includes(path.join('10_Reports', 'Purchases')));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(x.file_path);
  const ws = wb.getWorksheet('Purchase Register')!;
  assert.equal(ws.getCell('A1').value, 'PURCHASE REGISTER');
  assert.equal(ws.getCell('A2').value, 'DAKSH ROAD BUILDERS');
  assert.equal(ws.views[0].state, 'frozen');
  assert.ok(ws.autoFilter);
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.ok(ws.pageSetup.printTitlesRow);
  const header = ws.getRow(6).values as any[];
  assert.ok(header.includes('Line total'));
  const colOf = (h: string) => header.indexOf(h);
  const first = ws.getRow(7);
  assert.equal(first.getCell(colOf('Taxable value')).value, 125000);
  assert.equal(first.getCell(colOf('Tax')).value, 6250);
  assert.equal(first.getCell(colOf('Taxable value')).numFmt?.includes('₹'), true);
  assert.ok(first.getCell(colOf('Date')).value instanceof Date);
  assert.equal(first.getCell(colOf('Date')).numFmt, 'dd-mmm-yyyy');
  assert.equal((first.getCell(colOf('Quantity')).value as number), 100);
  // totals row uses SUBTOTAL formula with correct cached result
  const totalRow = ws.getRow(9);
  assert.equal(totalRow.getCell(1).value, 'TOTAL');
  const tcell = totalRow.getCell(colOf('Line total')).value as any;
  assert.match(tcell.formula, /^SUBTOTAL\(109,[A-Z]+7:[A-Z]+8\)$/);
  assert.equal(tcell.result, (15700000 + 785000) / 100);
  // quantity totals are not summed across different units
  const wsStock = (await (async () => {
    const [s] = await generateReport('stock_register', { companyId }, ['xlsx']);
    const b = new ExcelJS.Workbook();
    await b.xlsx.readFile(s.file_path);
    return b.getWorksheet('Stock Register')!;
  })());
  assert.ok(wsStock.rowCount > 8);
  // second generation never overwrites the first
  const [y] = await generateReport('purchase_register', { companyId, from: '2026-11-01', to: '2026-11-30' }, ['xlsx']);
  assert.notEqual(y.file_path, x.file_path);
  assert.ok(fs.existsSync(x.file_path) && fs.existsSync(y.file_path));
  assert.equal(scalar<number>(`SELECT COUNT(*) FROM generated_reports WHERE report_type = 'purchase_register'`), 2);
  // monthly report workbook has all seven sheets
  const [mr] = await generateReport('monthly_report', { companyId, month: '2026-11' }, ['xlsx']);
  const wbm = new ExcelJS.Workbook();
  await wbm.xlsx.readFile(mr.file_path);
  assert.equal(wbm.worksheets.length, 7);
  // supplier ledger totals agree with balance
  const prevL = previewReport('supplier_ledger', { companyId, supplierId });
  const last = prevL.sheets[0].rows[prevL.sheets[0].rows.length - 1];
  assert.equal(last.balance_paise, supplierBalance(supplierId, { companyId }).outstanding_paise);
  // PDF needs the Electron runtime; under plain Node it must fail cleanly rather than crash
  await expectApiError(async () => {
    try {
      await generateReport('company_directory', {}, ['pdf']);
    } catch (e: any) {
      throw new ApiError(e.message, 'INTERNAL');
    }
  }, 'INTERNAL', /desktop application/);
});

test('global search finds records across the hierarchy with parent context', async () => {
  const q = async (s: string) => {
    const r = await dispatch('search.query', { q: s });
    assert.ok(r.ok);
    return r.data as any[];
  };
  let hits = await q('patel');
  assert.ok(hits.some((h) => h.entityType === 'supplier'));
  hits = await q('gj01ab1234');
  const inward = hits.find((h) => h.entityType === 'receipt');
  assert.ok(inward, 'vehicle number finds the inward');
  assert.match(inward.parent, /Daksh Road Builders › Dholka/);
  assert.ok(hits.some((h) => h.entityType === 'royalty'));
  assert.ok((await q('rp-0001')).some((h) => h.entityType === 'royalty'));
  assert.ok((await q('dc-501')).some((h) => h.entityType === 'receipt'));
  assert.ok((await q('inv-778')).some((h) => h.entityType === 'invoice' || h.entityType === 'purchase'));
  assert.ok((await q('PO/26-27')).some((h) => h.entityType === 'purchase'));
  assert.ok((await q('rp0001.pdf')).some((h) => h.entityType === 'document'));
  const co = (await q('daksh road')).find((h) => h.entityType === 'company');
  assert.ok(co.folderPath && co.excelPath);
  assert.ok((await q('purchase register')).some((h) => h.entityType === 'report'));
  // archived items drop out of search
  const tmp = saveRecord('suppliers', { values: { name: 'Zeta Transport' } }).row;
  assert.ok((await q('zeta trans')).length >= 1);
  removeRecord('suppliers', tmp.id);
  assert.equal((await q('zeta trans')).length, 0);
  assert.ok(searchQuery('daksh', { companyId, limit: 3 }).length <= 3);
});

test('dashboard figures are computed from real data', () => {
  const d = getDashboard();
  assert.equal(d.totals.companies, 3); // main company + the two collision-regression companies
  assert.equal(d.totals.active_projects, 1);
  assert.ok(d.totals.suppliers >= 2);
  assert.equal(d.totals.purchases_count, 1);
  assert.equal(d.totals.purchases_paise, getPurchase(poId).total_paise);
  assert.equal(d.received_by_unit.find((r: any) => r.unit_code === 'MT').received_milli, 24150 + 39000 + 20000);
  assert.ok(d.stock_value_paise > 0);
  assert.equal(d.outstanding_paise, 0); // fully settled (advance on account)
  assert.ok(d.recent_transactions.length > 5);
  assert.ok(d.missing_royalty.receipts_without_pass >= 1);
  const empty = getDashboard('does-not-exist');
  assert.equal(empty.totals.purchases_count, 0);
  assert.equal(empty.stock_value_paise, 0);
});

test('backup, restore (with confirmation + safety copy) and archive export', async () => {
  const b = createBackup('manual');
  assert.ok(fs.existsSync(b.file));
  const before = scalar<number>('SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL')!;
  saveRecord('suppliers', { values: { name: 'Added After Backup' } });
  assert.equal(scalar<number>('SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL'), before + 1);
  assert.throws(() => restoreBackup(b.file, false), /Confirmation/);
  assert.throws(() => restoreBackup(path.join(sb.base, 'nope.sqlite'), true), /not found/);
  const junk = path.join(sb.base, 'junk.sqlite');
  fs.writeFileSync(junk, 'not a database');
  assert.throws(() => restoreBackup(junk, true), /could not be opened|not a Construction/);
  const r = restoreBackup(b.file, true);
  assert.ok(fs.existsSync(r.preRestoreBackup), 'a safety copy of the pre-restore data exists');
  assert.equal(scalar<number>('SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL'), before);
  assert.ok(searchQuery('patel').length >= 1, 'search index rebuilt after restore');
  assert.ok(listBackups().some((x) => x.kind === 'before restore'));
  // data still intact after restore
  assert.equal(getPurchase(poId).items[0].received_milli, 24150 + 39000);

  const arc = await exportArchive({ companyId });
  assert.ok(fs.existsSync(arc.file) && arc.size > 1000);
  assert.ok(fs.readdirSync(path.dirname(arc.file)).some((f) => f.endsWith('.zip')));
});

test('documents are filed in the structured folders and path resolution never escapes the company', () => {
  const dir = resolveDocFolder('receipt', receiptId, 'weighbridge_slip').dir;
  assert.ok(dir.endsWith(path.join('Aggregate', '20_MM', 'Patel_Crusher', 'Weighbridge_Slips')), dir);
  assert.ok(resolveDocFolder('invoice', invoiceId, 'invoice').dir.includes('03_Bills_and_Invoices'));
  assert.ok(resolveDocFolder('project', projectId, 'agreement').dir.endsWith('01_Agreements'));
  assert.ok(resolveDocFolder('measurement', get<any>('SELECT id FROM measurement_entries LIMIT 1')!.id, 'measurement').dir.endsWith('03_Measurement_Books'));
  assert.throws(() => resolveDocFolder('bogus', 'x', 'invoice'));
});
