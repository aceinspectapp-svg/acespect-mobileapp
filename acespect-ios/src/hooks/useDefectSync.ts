import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { flushDefectQueue, listQueue, onQueueChange, QueueEntry } from '../services/defectQueue';

/**
 * Keeps the defect outbox moving: sends it when a screen opens, when the app comes back to the foreground and
 * every half minute. Returns what is still waiting so a screen can say "3 changes waiting to send".
 * `onSent` runs after something was sent so the screen can reload.
 */
export function useDefectSync(onSent?: () => void) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const cb = useRef(onSent);
  cb.current = onSent;

  const refresh = useCallback(async () => setEntries(await listQueue()), []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await flushDefectQueue();
      if (r.sent > 0) cb.current?.();
      return r;
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const off = onQueueChange(() => void refresh());
    void syncNow();
    const timer = setInterval(() => void syncNow(), 30_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void syncNow(); });
    return () => { off(); clearInterval(timer); sub.remove(); };
  }, [refresh, syncNow]);

  return { entries, pending: entries.length, failed: entries.filter((e) => e.error).length, syncing, syncNow };
}
