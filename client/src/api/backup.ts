import { apiFetch } from './client';

export interface RestoreResult {
  /** Rows restored per table */
  restored: Record<string, number>;
  /** File name of the copy of the database saved before restoring (next to the database) */
  safetyCopy: string | null;
}

/** Replaces all data with a backup file's contents (the parsed JSON). */
export const restoreBackup = (backup: unknown) =>
  apiFetch<RestoreResult>('/export/restore', { method: 'POST', body: JSON.stringify(backup) });
