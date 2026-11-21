import fs from 'fs';
import os from 'os';
import path from 'path';

/** Isolated data + storage directories for one test file (never touches the user's real data). */
export function sandbox(name: string) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `crm-test-${name}-`));
  const dataDir = path.join(base, 'data');
  const storageRoot = path.join(base, 'Records');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  process.env.CRM_DATA_DIR = dataDir;
  process.env.CRM_STORAGE_ROOT = storageRoot;
  process.env.CRM_QUIET_LOG = '1';
  return {
    base,
    dataDir,
    storageRoot,
    cleanup: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("../electron/db/core").closeDb();
      } catch {
        /* db may not be open */
      }
      try {
        fs.rmSync(base, { recursive: true, force: true });
      } catch {
        /* temp dir cleanup is best-effort on Windows */
      }
    },
  };
}
