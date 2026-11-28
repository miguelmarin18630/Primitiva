/**
 * API compartida entre el servidor local (Express) y el Worker de Cloudflare.
 * Toda la autenticación, validación y persistencia se decide aquí: así el
 * despliegue en la nube y el arranque en casa no pueden divergir.
 */

import { createInitialSyndicateData, type SyndicateData, type WinningCombination } from '../data/initialSyndicateData.ts';
import { normalizeSyndicate } from './finance.ts';
import { fetchOfficialHistoryLastYear, fetchOfficialHistoryRange, madridDateTime, refreshOfficialResults } from './results.ts';

export type Role = 'admin' | 'socio';

export interface StoreData {
  syndicate: SyndicateData;
  permissions: { sociosCanAddBets: boolean };
  adminPin: string;
  /** Secreto HMAC persistido: los tokens siguen siendo válidos tras un reinicio. */
  tokenSecret: string;
  tokenVersion: number;
  /** Versión de los datos precargados; permite migraciones únicas sin borrar el PIN ni los permisos. */
  dataVersion?: number;
  /** Último día (hora de Madrid) en que se intentó la recuperación automática. */
  lastResultsRefresh?: string;
}

export interface TokenPayload {
  role: Role;
  exp: number;
  v: number;
}

/** Petición HTTP reducida a lo que la API necesita (sirve para Express y para Workers). */
export interface ApiRequest {
  method: string;
  path: string;
  authorization?: string | null;
  clientIp?: string | null;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiEnvironment {
  readStore(): StoreData | Promise<StoreData>;
  writeStore(store: StoreData): void | Promise<void>;
  geminiApiKey?: string;
  geminiModel?: string;
}

type AuthResult = { payload: TokenPayload; store: StoreData } | { response: ApiResponse };

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * 2 = datos del Excel, con José Ramón al corriente con 22 € reales.
 * 3 = cuota mensual de 5 €, tablero por meses y aportaciones extras.
 */
export const CURRENT_DATA_VERSION = 4;

function randomHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createInitialStore(): StoreData {
  return {
    syndicate: createInitialSyndicateData(),
    permissions: { sociosCanAddBets: true },
    adminPin: '1234',
    tokenSecret: randomHex(),
    tokenVersion: 0,
    dataVersion: CURRENT_DATA_VERSION,
  };
}

/** Normaliza un estado guardado (JSON local, Durable Object o importación antigua). */
export function hydrateStore(raw: unknown): StoreData {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const permissions = data.permissions && typeof data.permissions === 'object'
    ? (data.permissions as Record<string, unknown>)
    : {};
  return {
    syndicate: normalizeSyndicate(data.syndicate),
    permissions: { sociosCanAddBets: permissions.sociosCanAddBets !== false },
    adminPin: typeof data.adminPin === 'string' && data.adminPin.length >= 4 ? data.adminPin : '1234',
    tokenSecret: typeof data.tokenSecret === 'string' && data.tokenSecret.length >= 16 ? data.tokenSecret : randomHex(),
    tokenVersion: typeof data.tokenVersion === 'number' && Number.isFinite(data.tokenVersion) ? data.tokenVersion : 0,
    dataVersion: typeof data.dataVersion === 'number' && Number.isFinite(data.dataVersion) ? data.dataVersion : 1,
    lastResultsRefresh: typeof data.lastResultsRefresh === 'string' ? data.lastResultsRefresh : undefined,
  };
}

/**
 * Migración única de un estado ya creado: reemplaza los datos precargados por la
 * versión actual del Excel sin tocar el PIN, los permisos ni las sesiones.
 * Se ejecuta una sola vez porque escribe `dataVersion` en el almacén.
 */
export function migrateStore(store: StoreData): { store: StoreData; changed: boolean } {
  if (store.dataVersion === CURRENT_DATA_VERSION) return { store, changed: false };
  const version = store.dataVersion ?? 1;
  let syndicate = store.syndicate;

  if (version < 2) {
    // Importación del Excel real (José Ramón 22 €, sorteo 23 corregido).
    syndicate = createInitialSyndicateData();
  }

  if (version < 3) {
    // Conserva socios, sorteos y repartos; sólo añade la nueva estructura de cuotas.
    const fresh = createInitialSyndicateData();
    syndicate = {
      ...syndicate,
      monthlyFee: fresh.monthlyFee,
      months: fresh.months,
      monthlyPayments: fresh.monthlyPayments,
      extraContributions: fresh.extraContributions,
      extraPrizes: syndicate.extraPrizes.filter((prize) => !(prize.memberOrConcept === 'LETI' && prize.amount === 3)),
    };
  }

  if (version < 4) {
    // Limpia números de Joker mostrados en sorteos donde la peña no jugó Joker (JOKER: NO).
    syndicate = {
      ...syndicate,
      draws: syndicate.draws.map((draw) => {
        if (draw.jokerPlayed === true) return draw;
        return {
          ...draw,
          jokerPlayed: false,
          winningCombination: draw.winningCombination
            ? { ...draw.winningCombination, joker: undefined }
            : undefined,
          officialCombination: draw.officialCombination
            ? { ...draw.officialCombination, joker: undefined }
            : undefined,
        };
      }),
    };
  }

  return { store: { ...store, syndicate, dataVersion: CURRENT_DATA_VERSION }, changed: true };
}

/** Recupera las combinaciones oficiales que falten y marca el día del intento. */
export async function refreshResultsInStore(store: StoreData): Promise<{ store: StoreData; updated: number; dateKey: string }> {
  const dateKey = madridDateTime().dateKey;
  const result = await refreshOfficialResults(store.syndicate);
  return {
    store: { ...store, syndicate: result.syndicate, lastResultsRefresh: dateKey },
    updated: result.updated,
    dateKey,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sign(payload: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function issueToken(role: Role, store: StoreData): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ role, exp: expiresAt, v: store.tokenVersion })));
  const signature = toBase64Url(await sign(payload, store.tokenSecret));
  return { token: `${payload}.${signature}`, expiresAt };
}

async function readToken(token: string, store: StoreData): Promise<TokenPayload | null> {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  let received: Uint8Array;
  try {
    received = fromBase64Url(signature);
  } catch {
    return null;
  }
  if (!bytesEqual(await sign(payload, store.tokenSecret), received)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as TokenPayload;
    if (data.v !== store.tokenVersion || data.exp <= Date.now()) return null;
    if (data.role !== 'admin' && data.role !== 'socio') return null;
    return data;
  } catch {
    return null;
  }
}

// Freno a fuerza bruta del PIN. En memoria: se reinicia con el proceso/isolate.
const pinAttempts = new Map<string, { count: number; resetAt: number }>();

function pinIsBlocked(ip: string): boolean {
  const now = Date.now();
  const attempt = pinAttempts.get(ip);
  if (!attempt || attempt.resetAt <= now) {
    pinAttempts.delete(ip);
    return false;
  }
  return attempt.count >= 5;
}

function registerFailedPin(ip: string): void {
  const now = Date.now();
  const attempt = pinAttempts.get(ip);
  if (!attempt || attempt.resetAt <= now) pinAttempts.set(ip, { count: 1, resetAt: now + 5 * 60_000 });
  else attempt.count += 1;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function authenticate(req: ApiRequest, env: ApiEnvironment): Promise<AuthResult> {
  const store = await env.readStore();
  const header = req.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? await readToken(token, store) : null;
  if (!payload) {
    return { response: { status: 401, body: { error: 'Sesión caducada. Vuelve a identificarte.' } } };
  }
  return { payload, store };
}

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const FALLBACK_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

function resolveGeminiModels(configured?: string): string[] {
  const clean = (configured || '').trim().replace(/^models\//, '');
  const primary = !clean || clean === 'gemini-2.5-flash' || clean === 'gemini-2.0-flash' || clean === 'gemini-1.5-flash'
    ? DEFAULT_GEMINI_MODEL
    : clean;
  return [...new Set([primary, ...FALLBACK_GEMINI_MODELS])];
}

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function callGeminiOnce(apiKey: string, model: string, payload: unknown): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'User-Agent': 'aistudio-build',
    },
    body: JSON.stringify(payload),
  });
  const data = asObject(await response.json().catch(() => null));
  if (!response.ok) {
    const error = asObject(data.error);
    const msg = typeof error.message === 'string' ? error.message : `Gemini devolvió ${response.status}.`;
    throw new GeminiHttpError(response.status, msg);
  }
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const content = asObject(asObject(candidates[0]).content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts
    .filter((part) => !asObject(part).thought)
    .map((part) => (asObject(part).text as string) || '')
    .join('');
}

async function callGeminiWithFallback(apiKey: string, configuredModel: string | undefined, payload: unknown): Promise<string> {
  const models = resolveGeminiModels(configuredModel);
  let lastError: unknown;

  for (let round = 0; round < 2; round += 1) {
    for (const model of models) {
      try {
        return await callGeminiOnce(apiKey, model, payload);
      } catch (error) {
        lastError = error;
        const status = error instanceof GeminiHttpError ? error.status : 0;
        const msg = error instanceof Error ? error.message.toLowerCase() : '';
        // Si la clave de API es inválida o no tiene permisos, no reintentar otros modelos.
        if (status === 401 || status === 403 || msg.includes('api key')) {
          throw error;
        }
        // En 503 (alta demanda), 429, 404 o 5xx probamos automáticamente el siguiente modelo.
        const retryable = status === 404 || status === 429 || status >= 500 || msg.includes('high demand') || msg.includes('overloaded');
        if (!retryable) throw error;
      }
    }
    if (round === 0) await waitMs(1200);
  }

  if (lastError instanceof GeminiHttpError && (lastError.status === 503 || lastError.status === 429)) {
    throw new Error('Los servidores de Gemini están temporalmente saturados por alta demanda. Inténtalo de nuevo en unos segundos.');
  }
  throw lastError instanceof Error ? lastError : new Error('No se pudo analizar la foto del boleto con IA.');
}

const TICKET_PROMPT = `Analiza esta imagen de un boleto o resguardo oficial de la Lotería Primitiva de España.
Extrae los datos de las APUESTAS JUGADAS por el usuario o peña, NO la combinación ganadora oficial.

Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin markdown fuera del JSON):
{
  "date": "YYYY-MM-DD (fecha del sorteo si aparece en el boleto)",
  "dayOfWeek": "Lunes, Jueves o Sábado",
  "betCost": 5.0,
  "reintegro": 6,
  "joker": "",
  "jokerPlayed": false,
  "lines": [
    {
      "line": 1,
      "numbers": [6 enteros distintos entre 1 y 49 ordenados de menor a mayor],
      "reintegro": 6
    },
    {
      "line": 2,
      "numbers": [6 enteros distintos entre 1 y 49 ordenados de menor a mayor]
    }
  ],
  "winningCombination": {
    "numbers": [los 6 números de la primera apuesta/línea 1],
    "complementario": 0,
    "reintegro": 6
  }
}

Reglas importantes:
- Un boleto de La Primitiva suele contener entre 1 y 8 apuestas (bloques o filas de 6 números del 1 al 49). Extrae TODAS las líneas o bloques jugados en el array "lines".
- "numbers" en cada línea DEBE contener exactamente 6 enteros distintos del 1 al 49, ordenados de menor a mayor.
- Si ves el número de Reintegro (REINTEGRO: X), inclúyelo en "reintegro" (entero del 0 al 9).
- MUY IMPORTANTE SOBRE EL JOKER: busca la línea que pone "JOKER:" (justo debajo de REINTEGRO). El número de Joker SOLO existe si justo a la derecha de "JOKER:" aparece un número de 7 cifras (por ejemplo, "JOKER: 1 234 567"). Si pone "JOKER: NO", o no aparece un número de 7 cifras junto a "JOKER:", devuelve OBLIGATORIAMENTE "jokerPlayed": false y "joker": "". NUNCA confundas el número de referencia del boleto, el código de administración (ej. 37170-0), el número de sorteo ni la serie de control/código de barras inferior con el Joker.
- Si no logras leer con certeza una línea, no la inventes. Devuelve solo las líneas leídas con claridad.`;

export async function handleApiRequest(req: ApiRequest, env: ApiEnvironment): Promise<ApiResponse> {
  const method = req.method.toUpperCase();
  const qIndex = req.path.indexOf('?');
  const path = qIndex >= 0 ? req.path.slice(0, qIndex) : req.path;
  const queryString = qIndex >= 0 ? req.path.slice(qIndex) : '';
  const body = asObject(req.body);

  if (method === 'GET' && path === '/api/syndicate') {
    const store = await env.readStore();
    return { status: 200, body: { syndicate: store.syndicate, permissions: store.permissions } };
  }

  if ((method === 'GET' && (path === '/api/results/last-year' || path === '/api/results/range')) || (method === 'POST' && path === '/api/results/range')) {
    let fromDate: string | undefined;
    let toDate: string | undefined;
    if (method === 'POST') {
      if (typeof body.from === 'string') fromDate = body.from;
      if (typeof body.to === 'string') toDate = body.to;
    } else if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      fromDate = searchParams.get('from') || undefined;
      toDate = searchParams.get('to') || undefined;
    }

    const store = await env.readStore();
    const history = fromDate && toDate
      ? await fetchOfficialHistoryRange(fromDate, toDate)
      : await fetchOfficialHistoryLastYear();
    const byDate = new Map<string, WinningCombination>();
    for (const item of history.draws) {
      byDate.set(item.date, item.combination);
    }
    for (const draw of store.syndicate.draws) {
      if (draw.officialCombination && draw.date >= history.fromDate && draw.date <= history.toDate && !byDate.has(draw.date)) {
        byDate.set(draw.date, draw.officialCombination);
      }
    }

    const numberCounts = new Map<number, number>();
    const complementCounts = new Map<number, number>();
    const reintegroCounts = new Map<number, number>();
    for (const combination of byDate.values()) {
      for (const n of combination.numbers) {
        numberCounts.set(n, (numberCounts.get(n) ?? 0) + 1);
      }
      complementCounts.set(combination.complementario, (complementCounts.get(combination.complementario) ?? 0) + 1);
      reintegroCounts.set(combination.reintegro, (reintegroCounts.get(combination.reintegro) ?? 0) + 1);
    }

    return {
      status: 200,
      body: {
        totalDraws: byDate.size,
        fromDate: history.fromDate,
        toDate: history.toDate,
        source: history.draws.length > 0 ? 'official' : 'local',
        numberCounts: [...numberCounts.entries()],
        complementCounts: [...complementCounts.entries()],
        reintegroCounts: [...reintegroCounts.entries()],
      },
    };
  }

  if (method === 'POST' && path === '/api/verify-admin-pin') {
    const ip = req.clientIp || 'unknown';
    if (pinIsBlocked(ip)) {
      return { status: 429, body: { valid: false, error: 'Demasiados intentos. Espera 5 minutos.' } };
    }
    const store = await env.readStore();
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (pin && pin === store.adminPin) {
      pinAttempts.delete(ip);
      return { status: 200, body: { valid: true, ...(await issueToken('admin', store)) } };
    }
    registerFailedPin(ip);
    return { status: 401, body: { valid: false, error: 'PIN incorrecto.' } };
  }

  if (method === 'POST' && path === '/api/auth/socio') {
    const store = await env.readStore();
    return { status: 200, body: await issueToken('socio', store) };
  }

  const auth = await authenticate(req, env);
  if ('response' in auth) return auth.response;
  const { payload, store } = auth;

  if (method === 'POST' && path === '/api/syndicate') {
    if (!body.syndicate || typeof body.syndicate !== 'object') {
      return { status: 400, body: { error: 'Faltan los datos de la peña.' } };
    }
    const incoming = normalizeSyndicate(body.syndicate);
    if (payload.role === 'socio') {
      if (body.scope !== 'draws' || !store.permissions.sociosCanAddBets) {
        return { status: 403, body: { error: 'Los socios sólo pueden registrar apuestas y boletos.' } };
      }
      const incomingIds = new Set(incoming.draws.map((draw) => draw.id));
      const removed = store.syndicate.draws.filter((draw) => !incomingIds.has(draw.id));
      if (removed.some((draw) => draw.createdBy !== 'socio')) {
        return { status: 403, body: { error: 'Un socio sólo puede eliminar las apuestas que ha registrado él.' } };
      }
      // Una copia local desactualizada nunca debe sobrescribir cuotas ni repartos.
      // Tampoco puede cambiar la autoría ni la combinación oficial de un sorteo.
      const draws = incoming.draws.map((draw) => {
        const original = store.syndicate.draws.find((item) => item.id === draw.id);
        if (!original) return { ...draw, createdBy: 'socio' as const };
        return { ...draw, createdBy: original.createdBy, officialCombination: original.officialCombination };
      });
      store.syndicate = { ...store.syndicate, draws };
    } else {
      store.syndicate = incoming;
    }
    await env.writeStore(store);
    return { status: 200, body: { success: true, syndicate: store.syndicate } };
  }

  if (method === 'POST' && path === '/api/permissions') {
    if (payload.role !== 'admin') {
      return { status: 403, body: { error: 'Esta acción está reservada al administrador.' } };
    }
    if (typeof body.sociosCanAddBets === 'boolean') store.permissions.sociosCanAddBets = body.sociosCanAddBets;
    let token: { token: string; expiresAt: number } | undefined;
    if (body.newPin !== undefined) {
      const newPin = typeof body.newPin === 'string' ? body.newPin.trim() : '';
      if (newPin.length < 4 || body.currentPin !== store.adminPin) {
        return { status: 403, body: { error: 'PIN actual incorrecto o nuevo PIN demasiado corto.' } };
      }
      store.adminPin = newPin;
      store.tokenVersion += 1; // invalida todas las sesiones anteriores
      token = await issueToken('admin', store);
    }
    await env.writeStore(store);
    return { status: 200, body: { success: true, permissions: store.permissions, ...token } };
  }

  if (method === 'POST' && path === '/api/results/refresh') {
    if (payload.role !== 'admin') {
      return { status: 403, body: { error: 'Sólo el administrador puede actualizar los resultados.' } };
    }
    try {
      const refreshed = await refreshResultsInStore(store);
      await env.writeStore(refreshed.store);
      return { status: 200, body: { success: true, updated: refreshed.updated, dateKey: refreshed.dateKey } };
    } catch (error) {
      return { status: 500, body: { error: error instanceof Error ? error.message : 'No se pudieron recuperar los resultados.' } };
    }
  }

  if (method === 'POST' && path === '/api/syndicate/reset') {
    if (payload.role !== 'admin') {
      return { status: 403, body: { error: 'Esta acción está reservada al administrador.' } };
    }
    store.syndicate = createInitialSyndicateData();
    await env.writeStore(store);
    return { status: 200, body: { success: true, syndicate: store.syndicate } };
  }

  if (method === 'POST' && path === '/api/gemini/extract-ticket') {
    const apiKey = env.geminiApiKey;
    if (!apiKey) {
      return { status: 400, body: { error: 'La clave de Gemini no está configurada (GEMINI_API_KEY).' } };
    }
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
    if (!imageBase64 || imageBase64.length > 22_000_000) {
      return { status: 400, body: { error: 'Imagen del boleto no válida o demasiado grande (máx. ~16 MB).' } };
    }
    const matches = imageBase64.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
    const mimeType = matches?.[1] || 'image/jpeg';
    const data = matches?.[2] || imageBase64;
    try {
      const text = await callGeminiWithFallback(apiKey, env.geminiModel, {
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: TICKET_PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });
      const cleaned = (text || '{}').replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      return { status: 200, body: { success: true, data: JSON.parse(jsonMatch ? jsonMatch[0] : cleaned) } };
    } catch (error) {
      return { status: 500, body: { error: error instanceof Error ? error.message : 'Error al analizar la foto del boleto con IA.' } };
    }
  }

  return { status: 404, body: { error: 'Ruta no encontrada.' } };
}
