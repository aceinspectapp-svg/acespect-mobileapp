import { useCallback, useEffect, useState } from 'react';
import { qcMe, QcMe } from '../services/qcPlatformApi';
import { withCache } from '../services/qcCache';

/** The signed-in person's QC role and capabilities (remembered, so screens still know them with no signal). */
export function useQcMe() {
  const [me, setMe] = useState<QcMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setMe((await withCache('me', qcMe)).data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your account');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const can = useCallback((cap: string) => !!me?.capabilities.includes(cap), [me]);
  return { me, can, error, reload: load };
}
