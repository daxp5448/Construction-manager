/** Every IPC channel the renderer may call. The preload script refuses anything not listed here. */
export const CHANNELS = [
  // companies (v1 workflow, unchanged behaviour)
  'company.create',
  'company.update',
  'company.list',
  'company.get',
  'company.delete',
  'company.restore',
  'company.regenerateExcel',
  'company.repairFolders',
  // generic registers
  'crud.list',
  'crud.get',
  'crud.save',
  'crud.remove',
  'crud.restore',
  'crud.history',
  'lookup.list',
  'measurement.history',
  // purchases
  'purchase.list',
  'purchase.get',
  'purchase.save',
  'purchase.cancel',
  'purchase.remove',
  'purchase.restore',
  'purchase.openLines',
  // inward / weighbridge
  'receipt.list',
  'receipt.get',
  'receipt.save',
  'receipt.cancel',
  'receipt.vehicleHistory',
  // stock
  'stock.register',
  'stock.ledger',
  'stock.post',
  'stock.void',
  // suppliers & money
  'supplier.profile',
  'supplier.ledger',
  // royalty
  'royalty.reconcile',
  'royalty.suggest',
  'royalty.gaps',
  // documents
  'doc.types',
  'doc.list',
  'doc.attach',
  'doc.open',
  'doc.reveal',
  'doc.verify',
  'doc.remove',
  'doc.relocate',
  'doc.checkIntegrity',
  // reports
  'report.catalog',
  'report.preview',
  'report.generate',
  'report.history',
  'report.open',
  'report.openFolder',
  // search / dashboard / audit
  'search.query',
  'dashboard.get',
  'audit.list',
  // settings, backup, system
  'settings.get',
  'settings.save',
  'settings.chooseFolder',
  'backup.list',
  'backup.create',
  'backup.restore',
  'backup.chooseFile',
  'backup.exportArchive',
  'backup.excelBackup',
  'system.info',
  'system.openPath',
  'system.showInFolder',
  'system.openLog',
] as const;

export type Channel = (typeof CHANNELS)[number];
