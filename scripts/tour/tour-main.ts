/**
 * Developer tool (NOT shipped): launches the built UI in an isolated temp profile, seeds sample data through
 * the real services, walks every screen and saves screenshots.
 *   node scripts/tour/run.js <outDir>
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

const out = process.env.TOUR_OUT!;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tour-'));
process.env.CRM_DATA_DIR = path.join(base, 'data');
process.env.CRM_STORAGE_ROOT = path.join(base, 'Records');
process.env.CRM_QUIET_LOG = '1';
app.setPath('userData', process.env.CRM_DATA_DIR);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const root = path.resolve(__dirname, '..');

async function main() {
  await app.whenReady();
  const { initDatabase } = await import('../../electron/db');
  const ipc = await import('../../electron/ipc');
  const { CHANNELS } = await import('../../src/shared/channels');
  const { get } = await import('../../electron/db/core');
  initDatabase();
  ipc.defineHandlers();
  for (const c of CHANNELS) ipcMain.handle(c, (_e, p) => ipc.dispatch(c, p));
  ipc.setPlatform({ openPath: async () => '', showItemInFolder: () => {}, pickFiles: async () => [], pickFolder: async () => null, appVersion: '2.0.0', versions: process.versions as any });

  const call = async (ch: string, p: any = {}) => {
    const r = await ipc.dispatch(ch, p);
    if (!r.ok) throw new Error(`${ch}: ${r.error?.message}`);
    return r.data;
  };
  const sid = (label: string) => (get as any)('SELECT id FROM v_specs WHERE label = ?', [label]).id as string;

  // ---------- seed
  const co = await call('company.create', {
    name: 'Shree Ambica Road Builders',
    fields: [
      { id: '1', name: 'Owner Name', value: 'Ramesh Patel' },
      { id: '2', name: 'Contact Number', value: '9825012345' },
      { id: '3', name: 'GST Number', value: '24AAACS1429B1Z8' },
      { id: '4', name: 'Office Address', value: 'SG Highway, Ahmedabad, Gujarat' },
    ],
  });
  await call('company.create', { name: 'Jay Bhavani Infra', fields: [{ id: '1', name: 'Owner Name', value: 'Kiran Desai' }] });
  const companyId = co.company.id;
  const save = (module: string, values: any) => call('crud.save', { module, values }).then((r) => r.row);
  const project = await save('projects', { company_id: companyId, name: 'Widening of Dholka–Bagodara Road (km 2/0 to 9/500)', code: 'R&B-114', client_name: 'R&B Division, Dholka', location: 'Dholka, Ahmedabad', agreement_no: 'AGR/2026/118', agreement_date: '2026-08-12', contract_value_paise: 4825000000, start_date: '2026-09-01', end_date: '2027-08-31', status: 'active' });
  const project2 = await save('projects', { company_id: companyId, name: 'Strengthening of Sanand–Viramgam Road', code: 'GSRDC-22', client_name: 'GSRDC', status: 'planned' });
  void project2;
  const patel = await save('suppliers', { name: 'Patel Crusher', business_name: 'Patel Stone Crusher & Co.', contact_person: 'Mahesh Patel', mobile: '9898012345', gst_no: '24AAAPP1234A1Z5', pan_no: 'AAAPP1234A', address: 'Survey 214, Kheda Road, Dholka', payment_terms: '30 days from invoice date', contract_start: '2026-08-01', contract_end: '2027-07-31' });
  const shree = await save('suppliers', { name: 'Shree Bitumen Depot', contact_person: 'Hitesh Shah', mobile: '9909012345', gst_no: '24AAACS9999B1Z2', payment_terms: 'Advance 50%, balance on delivery' });
  const bind = await save('suppliers', { name: 'Navkar Transport & Quarry', contact_person: 'Jignesh', mobile: '9727012345' });
  void bind;
  const rate = (sup: any, spec: string, r: number, tax: number) => save('supplierMaterials', { supplier_id: sup.id, spec_id: sid(spec), rate_paise: r, tax_bp: tax });
  await rate(patel, 'Aggregate 20 MM', 125000, 500);
  await rate(patel, 'Aggregate 10 MM', 130000, 500);
  await rate(patel, 'Aggregate 40 MM', 118000, 500);
  await rate(patel, 'Stone Dust', 80000, 500);
  await rate(shree, 'Bitumen VG-30', 5250000, 1800);
  await rate(shree, 'Bitumen VG-40', 5400000, 1800);

  const purchase = (d: string, sup: any, items: any[], extra: any = {}) => call('purchase.save', { purchase_date: d, company_id: companyId, project_id: project.id, supplier_id: sup.id, items, ...extra }).then((r) => r.purchase);
  const p1 = await purchase('2026-11-05', patel, [
    { spec_id: sid('Aggregate 20 MM'), qty_milli: 500000, rate_paise: 125000, tax_bp: 500 },
    { spec_id: sid('Aggregate 10 MM'), qty_milli: 250000, rate_paise: 130000, tax_bp: 500 },
    { spec_id: sid('Stone Dust'), qty_milli: 150000, rate_paise: 80000, tax_bp: 500 },
  ], { freight_paise: 1250000, invoice_no: 'PC/2026/0412', supplier_ref: 'Quote 77/A' });
  const p2 = await purchase('2026-11-12', shree, [{ spec_id: sid('Bitumen VG-30'), qty_milli: 60000, rate_paise: 5250000, tax_bp: 1800 }], { invoice_no: 'SBD-1190' });
  void p2;
  const item = (po: any, label: string) => po.items.find((i: any) => i.spec_label === label);
  const recv = (at: string, veh: string, po: any, label: string, gross: number, tare: number, extra: any = {}) =>
    call('receipt.save', { received_at: at, company_id: companyId, project_id: project.id, supplier_id: po.supplier_id, purchase_id: po.id, purchase_item_id: item(po, label).id, vehicle_no: veh, driver_name: 'Driver', challan_no: extra.challan, royalty_pass_no: extra.pass, slips: [{ slip_no: extra.slip, weighbridge_name: 'Sai Dharm Kanta, Dholka', weight_unit: 'MT', gross_milli: gross, tare_milli: tare }], ...extra.more }).then((r) => r.receipt);
  const r1 = await recv('2026-11-12T09:40', 'GJ01BT4521', p1, 'Aggregate 20 MM', 38250, 14100, { challan: 'DC-5101', pass: 'RP-240981', slip: 'W-90211', more: { ordered_qty_milli: 25000 } });
  await recv('2026-11-12T11:15', 'GJ01BT7788', p1, 'Aggregate 20 MM', 37900, 13950, { challan: 'DC-5102', pass: 'RP-240982', slip: 'W-90214', more: { rejected_qty_milli: 1500, rejection_reason: 'Oversize particles / dust content' } });
  await recv('2026-11-13T08:20', 'GJ06AX1209', p1, 'Aggregate 10 MM', 36800, 13900, { challan: 'DC-5110', pass: 'RP-240995', slip: 'W-90230' });
  await recv('2026-11-14T10:05', 'GJ01BT4521', p1, 'Stone Dust', 35000, 14100, { challan: 'DC-5121', slip: 'W-90244' });
  void r1;
  await call('crud.save', { module: 'royalty', values: { pass_no: 'RP-240981', e_permit_no: 'EP-77120', dispatch_at: '2026-11-12T08:55', mineral_name: 'Ordinary Stone', grade: '20 MM', lease_holder: 'Shree Khodiyar Stone Lease', supplier_id: patel.id, vehicle_no: 'GJ01BT4521', weight_unit: 'MT', gross_milli: 38250, tare_milli: 14100, destination: 'Km 3+200 site, Dholka', company_id: companyId, project_id: project.id, royalty_amount_paise: 289800, source_location: 'Survey 214, Kheda Road', valid_from: '2026-11-12T08:00', valid_to: '2026-11-12T20:00' } });
  await call('crud.save', { module: 'royalty', values: { pass_no: 'RP-240982', dispatch_at: '2026-11-12T10:30', mineral_name: 'Ordinary Stone', grade: '20 MM', supplier_id: patel.id, vehicle_no: 'GJ01BT7788', weight_unit: 'MT', gross_milli: 37900, tare_milli: 13500, company_id: companyId, project_id: project.id, verification_status: 'verified', verified_by: 'Ramesh', verification_notes: 'Compared with original pass' } });

  const wmm = (get as any)('SELECT id FROM work_activities WHERE name = ?', ['WMM']).id;
  const gsb = (get as any)('SELECT id FROM work_activities WHERE name = ?', ['GSB']).id;
  await save('consumption', { usage_date: '2026-11-15', company_id: companyId, project_id: project.id, spec_id: sid('Aggregate 20 MM'), qty_milli: 18500, activity_id: wmm, site_location: 'Km 3+200 to 3+500 LHS', chainage_from: '3+200', chainage_to: '3+500', equipment: 'Paver + 10T roller' });
  await save('consumption', { usage_date: '2026-11-16', company_id: companyId, project_id: project.id, spec_id: sid('Aggregate 20 MM'), qty_milli: 14250, activity_id: gsb, site_location: 'Km 3+500 to 3+700', chainage_from: '3+500', chainage_to: '3+700' });
  await save('consumptionPlans', { project_id: project.id, spec_id: sid('Aggregate 20 MM'), planned_qty_milli: 420000, basis_note: 'From approved estimate, item 4.2 (user entered)' });
  await call('stock.post', { txnDate: '2026-11-01', companyId, projectId: project.id, specId: sid('Aggregate 6 MM'), type: 'opening', qtyMilli: 12000 });
  await save('specs', { material_id: (get as any)('SELECT material_id FROM v_specs WHERE label = ?', ['Aggregate 6 MM']).material_id, size_grade: '6 MM', unit_code: 'MT' }).catch(() => {});

  const inv = await save('invoices', { invoice_no: 'PC/2026/0412', invoice_date: '2026-11-14', company_id: companyId, project_id: project.id, supplier_id: patel.id, purchase_id: p1.id, subtotal_paise: p1.subtotal_paise, tax_paise: p1.tax_paise, other_paise: p1.freight_paise, verification_status: 'verified', approval_status: 'approved' });
  await save('payments', { supplier_id: patel.id, company_id: companyId, project_id: project.id, payment_date: '2026-11-10', kind: 'advance', amount_paise: 5000000, mode: 'neft', reference_no: 'UTR2611100981' });
  await save('payments', { supplier_id: patel.id, company_id: companyId, project_id: project.id, payment_date: '2026-11-18', kind: 'payment', amount_paise: 6500000, mode: 'rtgs', reference_no: 'UTR2611180412', invoice_id: inv.id });
  await save('invoices', { invoice_no: 'SBD-1190', invoice_date: '2026-11-15', company_id: companyId, project_id: project.id, supplier_id: shree.id, subtotal_paise: 31500000, tax_paise: 5670000, due_date: '2026-11-30' });
  const tt = (get as any)('SELECT id FROM test_types WHERE name = ?', ['Aggregate impact value']).id;
  await save('quality', { test_date: '2026-11-13', company_id: companyId, project_id: project.id, spec_id: sid('Aggregate 20 MM'), supplier_id: patel.id, test_type_id: tt, result_value: '24.5', unit: '%', standard_ref: 'Project technical specification, section 400 (edition per contract)', limit_max: 30, laboratory: 'Gujarat Engineering Research Lab, Ahmedabad', sample_id: 'S-114/07' });
  await save('measurement', { mb_no: 'MB-12/45', measured_on: '2026-11-18', company_id: companyId, project_id: project.id, work_description: 'WMM in shoulder, LHS', chainage_from: '3+000', chainage_to: '3+500', length_milli: 500000, width_milli: 1500, depth_milli: 150, boq_ref: '4.2', unit_code: 'Cum' });
  await save('progress', { entry_date: '2026-11-18', company_id: companyId, project_id: project.id, register: 'progress', work_done: 'WMM laid and compacted 3+000 to 3+200 LHS. Water sprinkling and 10T roller, 8 passes.', labour_count: 26, qty_done_milli: 360000, unit_code: 'Cum', weather: 'Clear' });
  await call('report.generate', { id: 'monthly_report', filters: { companyId, month: '2026-11' }, formats: ['xlsx'] });
  await call('report.generate', { id: 'inward_register', filters: { companyId }, formats: ['xlsx'] });

  // ---------- window
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(root, 'dist-electron', 'preload.js'), contextIsolation: true, sandbox: true } });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(root, 'dist', 'index.html'));
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name: string) => {
    await wait(650);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  };
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const clickNav = (label: string) => js(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes(${JSON.stringify(label)})); b && b.click(); return !!b })()`);
  const clickText = (sel: string, text: string) => js(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})); b && b.click(); return !!b })()`);
  const press = (key: string, ctrl = false) => js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:${ctrl},bubbles:true}))`);

  const errors: string[] = [];
  win.webContents.on('console-message', (_e, level, msg) => level >= 2 && errors.push(msg));

  await wait(900);
  await shot('01-dashboard');
  const screens: Array<[string, string]> = [
    ['Companies', '02-companies'], ['Projects', '03-projects'], ['Materials & Specs', '04-materials'], ['Suppliers', '05-suppliers'], ['Purchases', '06-purchases'], ['Material Inward', '07-inward'],
    ['Royalty & Passes', '08-royalty'], ['Inventory', '09-inventory'], ['Consumption', '10-consumption'], ['Quality Control', '11-quality'], ['Measurement Book', '12-measurement'], ['Bills & Payments', '13-billing'], ['Reports & Analytics', '14-reports'], ['Document Center', '15-documents'], ['Settings', '16-settings'],
  ];
  for (const [label, name] of screens) {
    await clickNav(label);
    await shot(name);
  }
  // drawers / forms
  await clickNav('Purchases');
  await wait(400);
  await clickText('button', 'New purchase');
  await shot('20-purchase-form');
  await press('Escape');
  await clickNav('Material Inward');
  await wait(400);
  await clickText('button', 'Record delivery');
  await shot('21-inward-form');
  await press('Escape');
  await clickNav('Suppliers');
  await wait(500);
  await js(`document.querySelector('.tbl tbody tr.click')?.click()`);
  await shot('22-supplier-profile');
  await press('Escape');
  await clickNav('Reports & Analytics');
  await wait(500);
  await shot('23-reports-monthly');
  await press('k', true);
  await js(`(() => { const i=document.querySelector('[aria-label="Search everything"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'gj01bt'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await wait(500);
  await shot('24-search');
  await press('Escape');
  await clickNav('Inventory');
  await wait(400);
  await js(`document.querySelector('.tbl tbody tr.click')?.click()`);
  await shot('25-stock-ledger');
  // ---------- UI flow: create a purchase and a delivery through the real forms
  const helpers = `
    window.__h = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      setVal(el, v) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      field(label) {
        const l = [...document.querySelectorAll('.drawer .field-label')].find((x) => x.textContent.trim().startsWith(label));
        if (!l) throw new Error('no field ' + label);
        return l.parentElement.querySelector('input,select,textarea');
      },
      async pick(input, text) {
        input.click(); input.focus();
        await this.sleep(500);
        const menu = input.parentElement.parentElement.querySelector('.menu');
        if (!menu) throw new Error('no menu for ' + text);
        const opt = [...menu.querySelectorAll('.menu-item')].find((o) => o.textContent.includes(text));
        if (!opt) throw new Error('no option ' + text + ' in ' + menu.textContent.slice(0, 200));
        opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await this.sleep(300);
      },
      button(text) { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text && !x.disabled); if (!b) throw new Error('no button ' + text); return b; },
    };
  `;
  await js(helpers + ';true');
  const flowResult: Record<string, any> = {};
  try {
    // PURCHASE
    await clickNav('Purchases');
    await wait(500);
    await js(`__h.button('New purchase').click()`);
    await wait(500);
    await js(`(async () => { const h = __h; await h.pick(h.field('Company'), 'Shree Ambica'); await h.pick(h.field('Project'), 'Dholka'); await h.pick(h.field('Supplier'), 'Patel Crusher'); })()`);
    await js(`(async () => { const h = __h; const row = document.querySelector('.drawer table.tbl tbody tr'); const sel = row.querySelector('input[role=combobox]'); await h.pick(sel, 'Aggregate 40 MM'); const ins = [...row.querySelectorAll('input')].filter(i => i.getAttribute('role') !== 'combobox'); h.setVal(ins[0], '100'); })()`);
    await wait(400);
    await shot('30-purchase-filled');
    flowResult.purchaseTotalShown = await js(`document.querySelector('.drawer').textContent.includes('1,23,900.00')`);
    await js(`__h.button('Save purchase').click()`);
    await wait(900);
    const pl = await call('purchase.list', { pageSize: 50 });
    const newPo = pl.rows.find((r: any) => r.items.some((i: any) => i.label === 'Aggregate 40 MM'));
    flowResult.purchase = newPo ? { po_no: newPo.po_no, total_paise: newPo.total_paise } : null;

    // RECEIPT
    await clickNav('Material Inward');
    await wait(500);
    await js(`__h.button('Record delivery').click()`);
    await wait(500);
    await js(`(async () => { const h = __h; await h.pick(h.field('Company'), 'Shree Ambica'); await h.pick(h.field('Project'), 'Dholka'); await h.pick(h.field('Supplier'), 'Patel Crusher'); })()`);
    await wait(700);
    await js(`(async () => { const h = __h; const sel = h.field('Against purchase order'); const opt = [...sel.options].find(o => o.textContent.includes('Aggregate 40 MM')); h.setVal(sel, opt.value); })()`);
    await wait(300);
    await js(`(async () => { const h = __h; h.setVal(h.field('Vehicle number'), 'gj01zz9999'); h.setVal(h.field('Delivery challan'), 'DC-UI-1');
      const row = document.querySelector('.drawer table.tbl tbody tr'); const ins = [...row.querySelectorAll('input')];
      h.setVal(ins[0], 'W-UI-1'); const nums = ins.filter(i => i.className.includes('input-num')); h.setVal(nums[0], '38.25'); h.setVal(nums[1], '14.1'); })()`);
    await wait(400);
    await shot('31-receipt-filled');
    flowResult.acceptedShown = await js(`document.querySelector('.drawer').textContent.includes('24.15 MT')`);
    await js(`__h.button('Post receipt').click()`);
    await wait(900);
    const rl = await call('receipt.list', { vehicle_no: 'GJ01ZZ9999' });
    const rc = rl.rows[0];
    flowResult.receipt = rc ? { receipt_no: rc.receipt_no, received: rc.received_qty_milli, accepted: rc.accepted_qty_milli, po_no: rc.po_no, slips: rc.slip_count } : null;
    const reg = await call('stock.register', {});
    flowResult.stock40 = reg.find((r: any) => r.spec_label === 'Aggregate 40 MM')?.closing_milli ?? null;
  } catch (e: any) {
    flowResult.error = String(e?.message || e);
    await shot('39-flow-error');
  }
  fs.writeFileSync(path.join(out, 'flow-result.json'), JSON.stringify(flowResult, null, 2));
  console.log('FLOW ' + JSON.stringify(flowResult));
  fs.writeFileSync(path.join(out, 'console-errors.txt'), errors.join('\n'));
  console.log('TOUR_DONE errors=' + errors.length);
  app.exit(0);
}

main().catch((e) => {
  console.error('TOUR_FAILED', e);
  app.exit(1);
});
void shell;
