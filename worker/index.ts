/**
 * Worker de Cloudflare: sirve la app estática y ejecuta la misma API que el
 * servidor local. El estado vive en un Durable Object con SQLite, así que no
 * depende de que el ordenador de casa esté encendido.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  createInitialStore,
  handleApiRequest,
  hydrateStore,
  migrateStore,
  refreshResultsInStore,
  type ApiEnvironment,
  type StoreData,
} from '../src/lib/serverApi.ts';
import { isScheduledResultsTime, madridDateTime } from '../src/lib/results.ts';

export interface Env {
  SYNDICATE: DurableObjectNamespace<SyndicateStore>;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

export class SyndicateStore extends DurableObject<Env> {
  private readonly sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  async getStore(): Promise<StoreData> {
    const rows = this.sql.exec<{ value: string }>('SELECT value FROM state WHERE key = ?', 'penya').toArray();
    if (rows.length) {
      try {
        const migrated = migrateStore(hydrateStore(JSON.parse(rows[0].value)));
        if (migrated.changed) await this.setStore(migrated.store);
        return migrated.store;
      } catch {
        // Un valor corrupto se reconstruye con datos iniciales.
      }
    }
    const initial = createInitialStore();
    await this.setStore(initial);
    return initial;
  }

  async setStore(store: StoreData): Promise<void> {
    this.sql.exec(
      'INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'penya',
      JSON.stringify(store),
    );
  }
}

/** Se llama desde los crons de las 21:00 y 22:00 UTC; sólo actúa a las 23:00 de Madrid. */
async function runScheduledResultsRefresh(env: Env): Promise<string> {
  const now = new Date();
  if (!isScheduledResultsTime(now)) return 'Fuera de horario.';

  const localDate = madridDateTime(now).dateKey;
  const stub = env.SYNDICATE.get(env.SYNDICATE.idFromName('penya'));
  const store = await stub.getStore();
  if (store.lastResultsRefresh === localDate) return 'Ya se actualizó hoy.';

  const refreshed = await refreshResultsInStore(store);
  await stub.setStore(refreshed.store);
  return `Combinaciones añadidas: ${refreshed.updated}.`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // El resto de rutas las sirven los assets estáticos (SPA) antes que el Worker.
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
    }

    const stub = env.SYNDICATE.get(env.SYNDICATE.idFromName('penya'));
    const apiEnv: ApiEnvironment = {
      readStore: () => stub.getStore(),
      writeStore: (store) => stub.setStore(store),
      geminiApiKey: env.GEMINI_API_KEY,
      geminiModel: env.GEMINI_MODEL,
    };

    try {
      const result = await handleApiRequest(
        {
          method: request.method,
          path: url.pathname + url.search,
          authorization: request.headers.get('authorization'),
          clientIp: request.headers.get('cf-connecting-ip'),
          body,
        },
        apiEnv,
      );
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (error) {
      console.error('Worker API error:', error);
      return new Response(JSON.stringify({ error: 'Error interno del servidor.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduledResultsRefresh(env)
        .then((message) => console.log('Resultados automáticos:', message))
        .catch((error) => console.error('Error en la recuperación automática de resultados:', error)),
    );
  },
};
