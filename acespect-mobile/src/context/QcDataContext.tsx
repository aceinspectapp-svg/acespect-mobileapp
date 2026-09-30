import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { QcDefect, QcTask } from '../types/qc';
import * as qcApi from '../services/qcApi';

/**
 * QC data store — backed by the real API (see services/qcApi.ts) as of
 * Phase 3. Tasks are always "assigned to the signed-in user"; the server
 * enforces that (GET /qc/tasks/assigned, and ownership checks on
 * GET/POST /qc/tasks/:id*) — this context just caches what's been fetched
 * this session and exposes loading/refresh/mutate helpers.
 *
 * Config (clients/projects/properties/severities/statuses), defect
 * creation, and assignment are admin-only now, done from acespect-web's QC
 * section — there is deliberately no mobile equivalent of those anymore.
 */

interface QcDataState {
  tasks: QcTask[];
  loading: boolean;
  error: string | null;
  refreshTasks: () => Promise<void>;
  /** Task detail (with its activity log) — fetches fresh and caches into `tasks`. */
  getTask: (id: string) => Promise<QcTask>;
  /** Read-only defect lookup for the "Defect" link on Task Detail. */
  getDefect: (id: string) => Promise<QcDefect>;
  postTaskUpdate: (taskId: string, comment: string, markCompleted: boolean, photoUris: string[]) => Promise<void>;
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

  const postTaskUpdate = useCallback(
    async (taskId: string, comment: string, markCompleted: boolean, photoUris: string[]) => {
      await qcApi.postTaskUpdate(taskId, comment, markCompleted, photoUris);
      await getTask(taskId); // refetch so the new update + status land in the cache
    },
    [getTask],
  );

  const value = useMemo<QcDataState>(
    () => ({ tasks, loading, error, refreshTasks, getTask, getDefect, postTaskUpdate }),
    [tasks, loading, error, refreshTasks, getTask, getDefect, postTaskUpdate],
  );

  return <QcDataContext.Provider value={value}>{children}</QcDataContext.Provider>;
}

export function useQcData(): QcDataState {
  const ctx = useContext(QcDataContext);
  if (!ctx) throw new Error('useQcData must be used within a QcDataProvider');
  return ctx;
}
