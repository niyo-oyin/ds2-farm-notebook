import type { OwnedHorse, PlannedHorse } from '../src/core/types';
import type { Plan } from '../src/store/model';

export const timestamp = '2025-01-01T00:00:00.000Z';
export const owned = (id: string, patch: Partial<OwnedHorse> = {}): OwnedHorse => ({
  id, kind: 'owned', name: id, sex: 'F', category: '現役', sireKey: '', damKey: '', createdAt: timestamp, updatedAt: timestamp, ...patch,
});
export const planned = (id: string, patch: Partial<PlannedHorse> = {}): PlannedHorse => ({
  id, kind: 'planned', name: id, sex: null, desiredSex: 'F', role: 'broodmare', status: '繁殖入り予定',
  sireKey: '', damKey: '', realizedIds: [], createdAt: timestamp, updatedAt: timestamp, ...patch,
});
export const plan = (id: string, foalIds: string[], patch: Partial<Plan> = {}): Plan => ({
  id, name: id, startKey: 'u:start', steps: foalIds.map((foalId, i) => ({ sire: 's:1', dam: i ? foalIds[i - 1] : 'u:start', foalId })),
  goals: [], rulesVersion: '1', dataVersion: '1', memo: '', createdAt: timestamp, updatedAt: timestamp, ...patch,
});

export function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), clear: () => data.clear() };
}
