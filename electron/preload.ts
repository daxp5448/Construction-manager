import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../src/shared/channels';

const allowed = new Set<string>(CHANNELS);

/** The only bridge into the main process: a whitelisted, validated request/response channel. */
async function invoke(channel: string, payload?: unknown) {
  if (!allowed.has(channel)) {
    return { ok: false, error: { message: `Action "${channel}" is not permitted.`, code: 'FORBIDDEN' } };
  }
  return ipcRenderer.invoke(channel, payload ?? {});
}

const legacy = async <T>(channel: string, payload: unknown, fallback: T, pick?: (d: any) => T): Promise<T> => {
  const r: any = await invoke(channel, payload);
  if (!r.ok) return fallback;
  return pick ? pick(r.data) : (r.data as T);
};

contextBridge.exposeInMainWorld('electronAPI', {
  invoke,
  // v1 convenience API (kept so the original screens keep working unchanged)
  createCompany: async (data: unknown) => {
    const r: any = await invoke('company.create', data);
    return r.ok ? r.data : { success: false, error: r.error.message };
  },
  updateCompany: async (data: unknown) => {
    const r: any = await invoke('company.update', data);
    return r.ok ? r.data : { success: false, error: r.error.message };
  },
  getAllCompanies: (search?: string) => legacy('company.list', { search }, []),
  getCompanyById: (id: string) => legacy('company.get', { id }, null),
  deleteCompany: async (id: string, deleteFiles: boolean) => {
    const r: any = await invoke('company.delete', { id, deleteFiles });
    return r.ok ? r.data : { success: false, error: r.error.message };
  },
  regenerateExcel: async (id: string) => {
    const r: any = await invoke('company.regenerateExcel', { id });
    return r.ok ? r.data : { success: false, error: r.error.message };
  },
  getSettings: () => legacy('settings.get', {}, null),
  updateSettings: (settings: unknown) => legacy('settings.save', settings, null),
  getStats: () => legacy('dashboard.get', {}, null),
  openPath: async (targetPath: string) => {
    const r: any = await invoke('system.openPath', { path: targetPath });
    return r.ok ? { success: true } : { success: false, error: r.error.message };
  },
  showInFolder: async (targetPath: string) => {
    const r: any = await invoke('system.showInFolder', { path: targetPath });
    return r.ok ? { success: true } : { success: false, error: r.error.message };
  },
  selectDirectory: () => legacy('settings.chooseFolder', { title: 'Select Construction Records Storage Folder' }, null as string | null, (d) => d.path),
  getDefaultStoragePath: () => legacy('settings.get', {}, '', (d) => d.storageRoot),
});
