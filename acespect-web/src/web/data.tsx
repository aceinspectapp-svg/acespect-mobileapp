import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, clearSession, getStoredUser, getToken, type AuthUser } from "./api";
import type { Inspection, SectionReviewStatus, User } from "./mockData";
import { composePhoneSections, saveComposedSections } from "./recomposeText";

interface AppData {
  currentUser: AuthUser | null;
  loading: boolean;
  inspections: Inspection[];
  users: User[];
  getInspectionById: (id: string) => Inspection | undefined;
  /** Fetches the complete inspection (answers, photos, damages) when only its light list row is held. Safe to call repeatedly. */
  loadInspectionDetail: (id: string) => Promise<void>;
  /** Ids whose full inspection could not be fetched (not found / not allowed), so a page can stop waiting. */
  detailFailed: ReadonlySet<string>;
  getInspectionsByInspector: (inspectorId: string) => Inspection[];
  getInspectionsForReviewer: (reviewerId: string) => Inspection[];
  getUser: (id: string) => User | undefined;
  /** Admin-only: edit another user's profile (name/phone/region/license). Refreshes `users` on success. */
  patchUser: (
    id: string,
    patch: { name?: string; phone?: string | null; region?: string | null; licenseNumber?: string | null },
  ) => Promise<void>;
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Finish a sign-in that needed a second step (MFA, invitation, single sign-on) and load the data. */
  completeSignIn: (user: AuthUser) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  patchSection: (
    inspectionId: string,
    sectionId: string,
    patch: {
      reviewStatus?: SectionReviewStatus;
      reviewComment?: string;
      reportText?: string;
      fields?: Record<string, unknown>;
      excludedPhotoUrls?: string[];
      photos?: string[];
      answers?: Record<string, unknown>;
      damages?: { type: string; location: string; direction: string; widthMm: number; lengthMm: number; notes: string; photos?: string[] }[];
    },
  ) => Promise<void>;
  /** Same idea as patchSection, one level down -- a damage record's own photo-exclusion list. */
  patchDamage: (
    inspectionId: string,
    damageId: string,
    patch: { excludedPhotoUrls?: string[]; photos?: string[] },
  ) => Promise<void>;
  patchInspection: (id: string, patch: { status?: Inspection["status"]; notes?: string }) => Promise<void>;
  /** Inspector's own draft save -- replaces the section set. Refreshes the inspection on success. */
  saveInspectionDraft: (id: string, patch: Parameters<typeof api.updateInspectionDraft>[1]) => Promise<void>;
  /** Sends a draft for review -- one-way. Refreshes the inspection on success. */
  finalizeInspection: (id: string) => Promise<void>;
  /** Inspector starts a brand-new draft from the web. Refreshes `inspections` and returns the new id. */
  createInspection: (input: Parameters<typeof api.createInspection>[0]) => Promise<string>;
}

const Ctx = createContext<AppData | null>(null);

/** Newest first, the order the server lists them in. */
const byDateDesc = (a: Inspection, b: Inspection) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1);

/** Every this-often the whole light list is fetched again (not only what changed), so nothing can stay out of step for long. */
const FULL_RELOAD_MS = 10 * 60_000;

export function useAppData(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}

/**
 * The inspection a page needs in full. The list holds light rows (no answers or photos); this asks for the real thing the first time one is
 * opened. `inspection` is undefined while that is on its way (`loadingDetail`), so a page can show "Loading" instead of an empty form.
 */
export function useInspectionDetail(id: string | undefined): { inspection: Inspection | undefined; loadingDetail: boolean } {
  const { getInspectionById, loadInspectionDetail, detailFailed } = useAppData();
  const found = id ? getInspectionById(id) : undefined;
  const needs = !!id && !!found && found.detail === false && !detailFailed.has(id);
  useEffect(() => {
    if (id && needs) void loadInspectionDetail(id);
  }, [id, needs, loadInspectionDetail]);
  return { inspection: found && found.detail === false ? undefined : found, loadingDetail: needs };
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(getStoredUser());
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailFailed, setDetailFailed] = useState<ReadonlySet<string>>(new Set());
  // What the server said the time was at the last successful list, and when the whole list was last fetched.
  const lastSync = useRef<string | null>(null);
  const lastFull = useRef(0);
  const inspectionsRef = useRef<Inspection[]>([]);
  inspectionsRef.current = inspections;
  const listRun = useRef<Promise<void> | null>(null);
  const detailRuns = useRef(new Map<string, Promise<void>>());

  /**
   * The inspection list used to be one download of every inspection with every answer and photo link (90 MB at 1,500 inspections), repeated
   * every time the tab regained focus. Now: the light list, a page at a time, the first time; afterwards only what changed since.
   * Whatever is already shown stays if a request fails.
   */
  const loadInspections = useCallback(async (forceFull: boolean) => {
    const full = forceFull || !lastSync.current || Date.now() - lastFull.current > FULL_RELOAD_MS;
    const since = full ? undefined : new Date(Date.parse(lastSync.current!) - 5000).toISOString();
    const rows: Inspection[] = [];
    let cursor: string | undefined;
    let serverTime: string | undefined;
    for (let page = 0; page < 200; page++) {
      const r = await api.getInspectionsSummary({ since, cursor });
      rows.push(...r.inspections);
      serverTime = r.serverTime;
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    // Rows we already hold in full are kept while they are unchanged; a changed one is fetched again below.
    const held = new Map(inspectionsRef.current.map((i) => [i.id, i]));
    const refetch: string[] = [];
    const merged = rows.map((row) => {
      const have = held.get(row.id);
      if (have && have.detail !== false) {
        if (have.updatedAt && have.updatedAt === row.updatedAt) return have;
        if (row.detail === false) refetch.push(row.id);
        else return row; // an older server sent it in full already
        return have;
      }
      return row;
    });
    setInspections((prev) => {
      if (full) return merged.sort(byDateDesc);
      const byId = new Map(prev.map((i) => [i.id, i]));
      for (const m of merged) byId.set(m.id, m);
      return [...byId.values()].sort(byDateDesc);
    });
    if (serverTime) {
      lastSync.current = serverTime;
      if (full) lastFull.current = Date.now();
    } else {
      lastSync.current = null; // an older server: no delta support, so always take the whole list
    }
    await Promise.all(
      refetch.map((id) =>
        api
          .getInspection(id)
          .then((fresh) => setInspections((prev) => prev.map((i) => (i.id === id ? fresh : i))))
          .catch(() => undefined),
      ),
    );
  }, []);

  const loadData = useCallback(async (forceFull = false) => {
    // A load that fails (the server refusing with 429 or 401, a restart, a network blip) must leave what is already on screen alone:
    // this runs every time the tab regains focus, and replacing the lists with empty ones made the whole app go blank
    // ("Inspection not found") until the next successful load. The only failure that really means "empty" is a 403 on the users list
    // (inspectors may not list users).
    // Two overlapping triggers (focus and visibility change fire together) share one run.
    if (!listRun.current) {
      listRun.current = loadInspections(forceFull)
        .catch(() => undefined)
        .finally(() => { listRun.current = null; });
    }
    const [, us] = await Promise.all([
      listRun.current,
      api.getUsers().catch((e: { status?: number }): User[] | null => (e?.status === 403 ? [] : null)),
    ]);
    if (us) setUsers(us);
  }, [loadInspections]);

  // On mount: if a token exists, validate it and load data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const u = await api.me();
        if (cancelled) return;
        setCurrentUser(u);
        await loadData(true);
      } catch {
        clearSession();
        setCurrentUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // Inspections are submitted from the mobile app, so a tab left open on the
  // web dashboard never sees new/updated rows until something refetches. Do
  // that when the tab regains focus (e.g. switching back from checking a
  // phone) rather than requiring a manual page reload.
  useEffect(() => {
    if (!currentUser) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") loadData();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [currentUser, loadData]);

  const login = useCallback(
    async (email: string, password: string) => {
      const u = await api.login(email, password);
      setCurrentUser(u);
      setLoading(true);
      await loadData(true);
      setLoading(false);
      return u;
    },
    [loadData],
  );

  const completeSignIn = useCallback(
    async (u: AuthUser) => {
      setCurrentUser(u);
      setLoading(true);
      await loadData(true);
      setLoading(false);
    },
    [loadData],
  );

  const logout = useCallback(() => {
    clearSession();
    setCurrentUser(null);
    setInspections([]);
    setUsers([]);
    lastSync.current = null;
    lastFull.current = 0;
    setDetailFailed(new Set());
  }, []);

  const refresh = useCallback(async () => {
    await loadData(true);
  }, [loadData]);

  /** One inspection in full. A section that came from the phone with its raw "Question?: answer" wording is composed into sentences (and saved). */
  const fetchInspectionDetail = useCallback(async (id: string): Promise<Inspection> => {
    const fresh = await api.getInspection(id);
    const { inspection, changed } = await composePhoneSections(fresh);
    if (changed.length) void saveComposedSections(fresh, changed);
    return inspection;
  }, []);

  const loadInspectionDetail = useCallback(async (id: string) => {
    const running = detailRuns.current.get(id);
    if (running) return running;
    const run = fetchInspectionDetail(id)
      .then((fresh) => {
        setInspections((prev) => (prev.some((i) => i.id === id) ? prev.map((i) => (i.id === id ? fresh : i)) : [fresh, ...prev]));
      })
      .catch(() => {
        setDetailFailed((prev) => new Set(prev).add(id));
      })
      .finally(() => { detailRuns.current.delete(id); });
    detailRuns.current.set(id, run);
    return run;
  }, [fetchInspectionDetail]);

  const replaceInspection = useCallback(async (id: string) => {
    const fresh = await fetchInspectionDetail(id);
    setInspections((prev) => prev.map((i) => (i.id === id ? fresh : i)));
  }, [fetchInspectionDetail]);

  const patchSection = useCallback<AppData["patchSection"]>(
    async (inspectionId, sectionId, patch) => {
      await api.updateSection(sectionId, patch);
      await replaceInspection(inspectionId);
    },
    [replaceInspection],
  );

  const patchDamage = useCallback<AppData["patchDamage"]>(
    async (inspectionId, damageId, patch) => {
      await api.updateDamage(damageId, patch);
      await replaceInspection(inspectionId);
    },
    [replaceInspection],
  );

  const patchInspection = useCallback<AppData["patchInspection"]>(
    async (id, patch) => {
      await api.updateInspection(id, patch);
      await replaceInspection(id);
    },
    [replaceInspection],
  );

  const saveInspectionDraft = useCallback<AppData["saveInspectionDraft"]>(
    async (id, patch) => {
      await api.updateInspectionDraft(id, patch);
      await replaceInspection(id);
    },
    [replaceInspection],
  );

  const finalizeInspection = useCallback<AppData["finalizeInspection"]>(
    async (id) => {
      await api.finalizeInspection(id);
      await replaceInspection(id);
    },
    [replaceInspection],
  );

  const patchUser = useCallback<AppData["patchUser"]>(async (id, patch) => {
    const updated = await api.updateUser(id, patch);
    setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
  }, []);

  const createInspection = useCallback<AppData["createInspection"]>(
    async (input) => {
      const { inspectionId } = await api.createInspection(input);
      // Brand new, so `replaceInspection`'s map-in-place wouldn't add it --
      // refetch the whole list instead.
      await loadData();
      return inspectionId;
    },
    [loadData],
  );

  const value: AppData = {
    currentUser,
    loading,
    inspections,
    users,
    getInspectionById: (id) => inspections.find((i) => i.id === id),
    loadInspectionDetail,
    detailFailed,
    getInspectionsByInspector: (inspectorId) => inspections.filter((i) => i.inspectorId === inspectorId),
    getInspectionsForReviewer: (reviewerId) =>
      inspections.filter((i) => i.reviewerId === reviewerId && i.status !== "draft"),
    getUser: (id) => users.find((u) => u.id === id),
    patchUser,
    login,
    completeSignIn,
    logout,
    refresh,
    patchSection,
    patchDamage,
    patchInspection,
    createInspection,
    saveInspectionDraft,
    finalizeInspection,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
