import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { QcConfigBundle, QcDefect, QcDefectDetail, QcTask, SpecForm, TaskStatus } from '../types/qc';
import * as qcApi from '../services/qcApi';

/**
 * QC data store — backed by the real API (see services/qcApi.ts). Tasks are
 * always "assigned to the signed-in user"; the server enforces that
 * (GET /qc/tasks/assigned, and ownership checks on GET/POST /qc/tasks/:id*) —
 * this context just caches what's been fetched this session and exposes
 * loading/refresh/mutate helpers.
 *
 * Clients, projects, sites, lots, users and defect creation/assignment are
 * admin-only, done from acespect-web's QC section. A defect starts as a draft;
 * whoever it's assigned to fills in its details here and confirms it as Open.
 * After that its status only moves through lifecycle actions, which the server
 * checks against the signed-in user's role (`allowedActions` on a defect says
 * what they may do right now).
 */

interface QcDataState {
  tasks: QcTask[];
  loading: boolean;
  error: string | null;
  refreshTasks: () => Promise<void>;
  /** Task detail (with its activity log) — fetches fresh and caches into `tasks`. */
  getTask: (id: string) => Promise<QcTask>;
  /** A defect with its history and the lifecycle actions available to this user. */
  getDefectDetail: (id: string) => Promise<QcDefectDetail>;
  /** Saves a draft defect's fields (the F16 keys). */
  updateDefect: (id: string, patch: Record<string, unknown>) => Promise<QcDefect>;
  /** Runs a lifecycle action with its form values and photos. */
  postDefectAction: (id: string, action: string, payload: Record<string, unknown>, photoUris: string[], expectedUpdatedAt?: string) => Promise<QcDefectDetail>;
  addDefectPhotos: (id: string, photoUris: string[]) => Promise<QcDefect>;
  getConfig: () => Promise<QcConfigBundle>;
  getSpecForm: (code: string) => Promise<SpecForm>;
  postTaskUpdate: (taskId: string, comment: string, markCompleted: boolean, photoUris: string[]) => Promise<void>;
  /** Direct, free change of the task's progress flag -- the Tasks list's inline status pill. */
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

  const getDefectDetail = useCallback((id: string) => qcApi.getDefectDetail(id), []);
  const updateDefect = useCallback((id: string, patch: Record<string, unknown>) => qcApi.updateDefect(id, patch), []);
  const postDefectAction = useCallback(
    (id: string, action: string, payload: Record<string, unknown>, photoUris: string[], expectedUpdatedAt?: string) =>
      qcApi.postDefectAction(id, action, payload, photoUris, expectedUpdatedAt),
    [],
  );
  const addDefectPhotos = useCallback((id: string, photoUris: string[]) => qcApi.addDefectPhotos(id, photoUris), []);
  const getConfig = useCallback(() => qcApi.getConfig(), []);
  const getSpecForm = useCallback((code: string) => qcApi.getSpecForm(code), []);

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
    () => ({
      tasks, loading, error, refreshTasks, getTask, getDefectDetail, updateDefect, postDefectAction, addDefectPhotos,
      getConfig, getSpecForm, postTaskUpdate, updateTaskStatus,
    }),
    [tasks, loading, error, refreshTasks, getTask, getDefectDetail, updateDefect, postDefectAction, addDefectPhotos, getConfig, getSpecForm, postTaskUpdate, updateTaskStatus],
  );

  return <QcDataContext.Provider value={value}>{children}</QcDataContext.Provider>;
}

export function useQcData(): QcDataState {
  const ctx = useContext(QcDataContext);
  if (!ctx) throw new Error('useQcData must be used within a QcDataProvider');
  return ctx;
}
