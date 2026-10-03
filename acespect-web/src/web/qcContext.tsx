import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getActiveClientId, setActiveClientId, type ApiError } from "./api";
import { qcx, type QcMe } from "./qcApi";

interface QcState {
  me: QcMe | null;
  loading: boolean;
  error: string | null;
  /** Several clients and none chosen yet: the layout asks which one. */
  pickClient: Array<{ id: string; name: string; role: string }> | null;
  can: (capability: string) => boolean;
  refresh: () => Promise<void>;
  switchClient: (id: string) => Promise<void>;
  enterSupport: (clientId: string, reason: string, ticketRef?: string) => Promise<void>;
  exitSupport: () => Promise<void>;
}

const Ctx = createContext<QcState | null>(null);

export function useQc(): QcState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQc must be used inside QcProvider");
  return v;
}

export function QcProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<QcMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickClient, setPickClient] = useState<QcState["pickClient"]>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await qcx.me();
      setMe(m);
      setPickClient(null);
      setError(null);
      // Remember the client the server resolved so later requests name it explicitly.
      if (m.clientId && !m.isSA) setActiveClientId(m.clientId);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "CONTEXT_REQUIRED" && err.details?.clients) {
        setPickClient(err.details.clients as QcState["pickClient"]);
        setMe(null);
      } else if (err.status === 404 && getActiveClientId()) {
        // The remembered client is no longer one of ours; start again.
        setActiveClientId(null);
        setError("Your access to that client has changed. Choose a client again.");
        try { setMe(await qcx.me()); } catch { /* handled below on next refresh */ }
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const caps = useMemo(() => new Set(me?.capabilities ?? []), [me]);
  const value: QcState = {
    me, loading, error, pickClient,
    can: (c) => caps.has(c),
    refresh,
    switchClient: async (id) => { setActiveClientId(id); setLoading(true); await refresh(); },
    enterSupport: async (clientId, reason, ticketRef) => { await qcx.support.start(clientId, reason, ticketRef); setActiveClientId(clientId); await refresh(); },
    exitSupport: async () => { await qcx.support.end(); setActiveClientId(null); await refresh(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
