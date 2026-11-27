/** Cliente HTTP: gestiona el token de sesión y convierte errores de la API en excepciones. */

export type Role = 'admin' | 'socio';

export interface Auth {
  token: string;
  role: Role;
  expiresAt: number;
}

const AUTH_KEY = 'penya_auth_v2';

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthError';
  }
}

const safeJson = async (response: Response): Promise<Record<string, any> | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export function loadAuth(): Auth | null {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw) as Auth;
    if (!auth.token || !auth.role || !auth.expiresAt || auth.expiresAt <= Date.now()) {
      sessionStorage.removeItem(AUTH_KEY);
      return null;
    }
    return auth;
  } catch {
    return null;
  }
}

export function saveAuth(auth: Auth): void {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  sessionStorage.removeItem(AUTH_KEY);
}

export async function apiFetch(path: string, init: RequestInit = {}, auth: Auth | null = null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (auth?.token) headers.set('Authorization', `Bearer ${auth.token}`);
  const response = await fetch(path, { ...init, headers });

  if (response.status === 401 || response.status === 403) {
    const body = await safeJson(response);
    throw new AuthError(body?.error || 'No tienes permiso para realizar esta acción.', response.status);
  }
  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error || `Error del servidor (${response.status}).`);
  }
  return response;
}

export async function authenticateAdmin(pin: string): Promise<Auth> {
  const response = await apiFetch('/api/verify-admin-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await response.json();
  if (!data.valid || !data.token) throw new Error('PIN incorrecto.');
  return { token: data.token, role: 'admin', expiresAt: Number(data.expiresAt) || Date.now() + 12 * 3_600_000 };
}

export async function authenticateSocio(): Promise<Auth> {
  const response = await apiFetch('/api/auth/socio', { method: 'POST' });
  const data = await response.json();
  if (!data.token) throw new Error('No se pudo iniciar la sesión de socio.');
  return { token: data.token, role: 'socio', expiresAt: Number(data.expiresAt) || Date.now() + 12 * 3_600_000 };
}

export async function changeAdminPin(currentPin: string, newPin: string, auth: Auth): Promise<Auth | null> {
  const response = await apiFetch(
    '/api/permissions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin, newPin }),
    },
    auth,
  );
  const data = await response.json();
  // Cambiar el PIN invalida los tokens anteriores; el servidor devuelve uno nuevo.
  return data.token ? { token: data.token, role: 'admin', expiresAt: Number(data.expiresAt) || Date.now() + 12 * 3_600_000 } : null;
}
