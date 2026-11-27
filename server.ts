/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import {
  createInitialStore,
  handleApiRequest,
  hydrateStore,
  migrateStore,
  type ApiEnvironment,
  type StoreData,
} from './src/lib/serverApi.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, 'src/data/syndicate_store.json');

function loadStore(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return hydrateStore(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')));
    }
  } catch (error) {
    console.error('Error reading syndicate store:', error);
  }
  return createInitialStore();
}

let store: StoreData = loadStore();

/** Migración única: actualiza los datos precargados sin borrar el PIN ni los permisos. */
const migrated = migrateStore(store);
if (migrated.changed) {
  store = migrated.store;
  saveStore();
}

function saveStore(): void {
  try {
    // Escritura atómica: nunca se pierde el estado si el proceso se corta a mitad de escritura.
    const temp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(temp, DATA_FILE);
  } catch (error) {
    console.error('Error saving syndicate store:', error);
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '25mb' })); // Boleto en base64

  const PORT = Number(process.env.PORT) || 3000;

  const apiEnv: ApiEnvironment = {
    readStore: () => store,
    writeStore: (next) => {
      store = next;
      saveStore();
    },
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  };

  // Una única implementación de la API para local y para la nube.
  app.all('/api/*', async (req: Request, res: Response) => {
    try {
      const result = await handleApiRequest(
        {
          method: req.method,
          path: req.originalUrl,
          authorization: req.headers.authorization,
          clientIp: req.ip,
          body: req.body,
        },
        apiEnv,
      );
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error('API error:', error);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Invalid request body:', error.message);
    res.status(400).json({ error: 'Cuerpo de petición no válido.' });
  });

  const isProduction = process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.webmanifest')
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Fatal server error:', error);
  process.exit(1);
});
