import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { QcDefect, QcSeverity, QcStatus, QcTask, TaskStatus } from '../types/qc';
import * as qcApi from '../services/qcApi';

/**
 * QC data store — backed by the real API (see services/qcApi.ts) as of
 * Phase 3. Tasks are always "assigned to the signed-in user"; the server
 * enforces that (GET /qc/tasks/assigned, and ownership checks on
 * GET/POST /qc/tasks/:id*) — this context just caches what's been fetched
 * this session and exposes loading/refresh/mutate helpers.
 *
 * Config (clients/projects/properties) and defect creation/assignment stay
 * admin-only, done from acespect-web's QC section. Filling in a defect's own
 * location/summary/severity/status/due date, though, is the assigned field
 * user's job now — done right here via `updateDefect` (the server checks
 * this defect is actually assigned to the caller; reassigning isn't exposed
 * here on purpose, that stays admin-only).
 */

interface QcDataState {
  tasks: QcTask[];
  loading: boolean;
  error: string | null;
  refreshTasks: () => Promise<void>;
  /** Task detail (with its activity log) — fetches fresh and caches into `tasks`. */
  getTask: (id: string) => Promise<QcTask>;
  /** Defect lookup for the "Defect" link on Task Detail. */
  getDefect: (id: string) => Promise<QcDefect>;
  /** Fills in what the admin didn't set at creation, plus the status dropdown — see qcApi.updateDefect. */
  updateDefect: (
    id: string,
    patch: Partial<{ location: string; locationDetails: string; summary: string; severityId: string; statusId: string; dueDate: string | null }>,
  ) => Promise<QcDefect>;
  /** Severity options for the Defect screen's picker. */
  getSeverities: () => Promise<QcSeverity[]>;
  /** The full status lifecycle for the Defect screen's free status picker. */
  getStatuses: () => Promise<QcStatus[]>;
  postTaskUpdate: (taskId: string, comment: string, markCompleted: boolean, photoUris: string[]) => Promise<void>;
  /** Direct, free status change -- the Tasks list's inline status pill. */
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
}

const QcDataContext = createContext<QcDataState | undefined>(undefined);

export function QcDataProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<QcTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await qcApi.getMyTasks();
      setTasks(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  const getTask = useCallback(async (id: string): Promise<QcTask> => {
    const task = await qcApi.getTask(id);
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === id);
      return exists ? prev.map((t) => (t.id === id ? task : t)) : [task, ...prev];
    });
    return task;
  }, []);

  const getDefect = useCallback((id: string) => qcApi.getDefect(id), []);
  const updateDefect = useCallback(
    (id: string, patch: Parameters<typeof qcApi.updateDefect>[1]) => qcApi.updateDefect(id, patch),
    [],
  );
  const getSeverities = useCallback(() => qcApi.getSeverities(), []);
  const getStatuses = useCallback(() => qcApi.getStatuses(), []);

  const postTaskUpdate = useCallback(
    async (taskId: string, comment: string, markCompleted: boolean, photoUris: string[]) => {
      await qcApi.postTaskUpdate(taskId, comment, markCompleted, photoUris);
      await getTask(taskId); // refetch so the new update + status land in the cache
    },
    [getTask],
  );

  const updateTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus) => {
      await qcApi.updateTaskStatus(taskId, status);
      await getTask(taskId); // refetch so the activity feed's logged status change lands in the cache
    },
    [getTask],
  );

  const value = useMemo<QcDataState>(
    () => ({ tasks, loading, error, refreshTasks, getTask, getDefect, updateDefect, getSeverities, getStatuses, postTaskUpdate, updateTaskStatus }),
    [tasks, loading, error, refreshTasks, getTask, getDefect, updateDefect, getSeverities, getStatuses, postTaskUpdate, updateTaskStatus],
  );

  return <QcDataContext.Provider value={value}>{children}</QcDataContext.Provider>;
}

export function useQcData(): QcDataState {
  const ctx = useContext(QcDataContext);
  if (!ctx) throw new Error('useQcData must be used within a QcDataProvider');
  return ctx;
}
