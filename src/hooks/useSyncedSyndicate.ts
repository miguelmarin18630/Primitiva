import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, AuthError, type Auth } from '../lib/api';
import { normalizeSyndicate } from '../lib/finance';
import { createInitialSyndicateData, type SyndicateData } from '../data/initialSyndicateData';

const STORAGE_KEY = 'penya_teme_parki_state_v3';

export interface Permissions {
  sociosCanAddBets: boolean;
}

/** 'draws' permite a un socio enviar apuestas/boletos; 'all' exige administrador. */
type Scope = 'all' | 'draws';
type Updater = (prev: SyndicateData) => SyndicateData;

interface Options {
  getAuth: () => Auth | null;
  onAuthError: () => void;
}

/**
 * Estado central de la peña: una sola fuente de verdad, escrituras en cola y
 * sondeo que nunca sobrescribe cambios locales pendientes de guardar.
 */
export function useSyncedSyndicate({ getAuth, onAuthError }: Options) {
  const [syndicate, setSyndicate] = useState<SyndicateData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeSyndicate(JSON.parse(saved)) : createInitialSyndicateData();
    } catch {
      return createInitialSyndicateData();
    }
  });
  const [permissions, setPermissions] = useState<Permissions>({ sociosCanAddBets: true });
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState('');
  const [serverError, setServerError] = useState(false);

  const stateRef = useRef(syndicate);
  const pendingRef = useRef(0);
  const dirtyRef = useRef(false);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(syndicate));
    } catch {
      // Almacenamiento lleno (fotos en base64): el servidor sigue siendo la fuente de verdad.
    }
  }, [syndicate]);

  const markSynced = useCallback(() => {
    if (!mountedRef.current) return;
    setLastSyncTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/api/syndicate');
      const data = await response.json();
      if (data.permissions && typeof data.permissions.sociosCanAddBets === 'boolean') {
        setPermissions({ sociosCanAddBets: data.permissions.sociosCanAddBets });
      }
      if (data.syndicate && pendingRef.current === 0 && !dirtyRef.current) {
        const normalized = normalizeSyndicate(data.syndicate);
        stateRef.current = normalized;
        setSyndicate(normalized);
        markSynced();
      }
      if (mountedRef.current) setServerError(false);
    } catch {
      if (mountedRef.current) setServerError(true);
    }
  }, [markSynced]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 6000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  /** Aplica el cambio de forma optimista y lo envía en orden, sin closures obsoletos. */
  const commit = useCallback(
    async (updater: Updater, scope: Scope = 'all'): Promise<boolean> => {
      const auth = getAuth();
      if (!auth || (scope === 'all' && auth.role !== 'admin')) return false;

      const next = updater(stateRef.current);
      stateRef.current = next;
      setSyndicate(next);
      dirtyRef.current = true;
      pendingRef.current += 1;
      if (mountedRef.current) setIsSyncing(true);

      const task = async (): Promise<boolean> => {
        try {
          await apiFetch(
            '/api/syndicate',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ syndicate: next, scope }),
            },
            auth,
          );
          // Sólo se considera limpio cuando no queden más escrituras en cola.
          dirtyRef.current = pendingRef.current > 1;
          if (mountedRef.current) setServerError(false);
          markSynced();
          return true;
        } catch (error) {
          dirtyRef.current = true;
          if (mountedRef.current) setServerError(true);
          if (error instanceof AuthError) onAuthError();
          return false;
        } finally {
          pendingRef.current -= 1;
          if (mountedRef.current && pendingRef.current === 0) setIsSyncing(false);
        }
      };

      const result = queueRef.current.then(task, task);
      queueRef.current = result.then(() => undefined, () => undefined);
      return result;
    },
    [getAuth, markSynced, onAuthError],
  );

  const updatePermissions = useCallback(
    async (patch: Partial<Permissions>): Promise<boolean> => {
      const auth = getAuth();
      if (!auth || auth.role !== 'admin') return false;
      try {
        const response = await apiFetch(
          '/api/permissions',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
          auth,
        );
        const data = await response.json();
        if (data.permissions) setPermissions({ sociosCanAddBets: Boolean(data.permissions.sociosCanAddBets) });
        return true;
      } catch (error) {
        if (error instanceof AuthError) onAuthError();
        return false;
      }
    },
    [getAuth, onAuthError],
  );

  return { syndicate, permissions, isSyncing, lastSyncTime, serverError, commit, updatePermissions, refresh };
}
