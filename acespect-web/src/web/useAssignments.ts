import { useCallback, useEffect, useState } from "react";
import { api, type AssignmentOverview } from "./api";

/** The assignment overview (who has how many, pending hand-over requests), refreshed on mount, when the tab regains focus, and every minute. */
export function useAssignments(enabled = true) {
  const [overview, setOverview] = useState<AssignmentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOverview(await api.getAssignments());
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Could not load assignments.");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 60_000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, reload]);

  return { overview, error, reload };
}
