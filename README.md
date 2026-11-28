# Primitiva

Aplicación para el control integral de la peña de Lotería Primitiva **TeMe vs Parki**.

## Qué hace

- Gestión de socios: alta, baja, historial y estado de la cuota de cada mes.
- **Cuota mensual por socio, 5 € por defecto y editable** desde la pestaña «Cuotas». Tablero mensual en verde (pagado) / rojo (pendiente); los meses nuevos empiezan con todos pendientes.
- Aportaciones extras para conceptos fuera de la cuota (por ejemplo, los 3 € de LETI).
- Historial de sorteos con combinación ganadora y foto del boleto (lectura asistida por IA).
- Conciliación contable: aportaciones − apuestas + premios − repartos = caja disponible.
- Arrastre mensual de caja, con columna de aportaciones y previsión de sorteos futuros.
- Reparto equitativo de premios o de caja; cada reparto se contabiliza para que los fondos no se repartan dos veces.
- Asistente Gemini con el contexto financiero de la peña.
- Exportación/importación de copias de seguridad en JSON.

> Datos reales importados: 10 socios, 46 boletos por 230 €, 47 € en premios de sorteo, 3 € de aportación extra y 112 € en caja. El histórico de socios suma 292 € y José Ramón figura con sus 22 € reales y al corriente.
> Las cifras de la interfaz se calculan siempre a partir de los datos, nunca están escritas a mano. Los cuadros de noviembre de 2026 se marcan como históricos: ya están incluidos en los 292 € y no vuelven a sumarse a la caja.

## Arranque local

**Arranque directo (Windows):** haz doble clic en `iniciar.cmd`. Abre una única ventana de Windows Terminal con tres pestañas:

- `Local (dev)` → `npm run dev` con `PORT=3100` (http://localhost:3100, Vite + API). El puerto 3000 se deja libre para AI Hub.
- `Local (start)` → `npm start` con `PORT=3001` (http://localhost:3001, sirve `dist/` con la API).
- `Cloud (wrangler)` → `npm run dev:cloud` (http://localhost:8787, Worker + Durable Object local).

Si no tienes Windows Terminal, el propio script te indica cómo abrir las tres pestañas a mano.

```bash
npm install
set PORT=3100 && npm run dev   # http://localhost:3100 (servidor API + Vite)
npm run build
npm start        # sirve dist/ con la API (NODE_ENV=production)
npm run lint     # comprobación de tipos (app + Worker)
```

Variables de entorno locales (ver `.env.example`): `PORT`, `GEMINI_API_KEY` y, opcionalmente, `GEMINI_MODEL` (por defecto `gemini-3.8-flash`).

## Despliegue en Cloudflare (sin dejar el ordenador encendido)

La app se publica como un **Worker con assets estáticos** y los datos viven en un **Durable Object con SQLite**. Tú publicas con un `git push`; los socios sólo abren una URL.

1. **Dominio:** si `marinweb.org` aún no está en Cloudflare, ve a *Websites → Add a site*, añádelo y cambia los nameservers en tu registrador hasta que aparezca como *Active*. Si ya está, salta este paso.
2. En Cloudflare: **Workers & Pages → Create → Connect to Git**. Elige este repositorio y la rama `main`. El Worker se llama **`primitiva`** (antes `penya-primitiva`); si habías creado el antiguo, puedes borrarlo después.
3. Configura el build:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** dejar vacío (raíz del repo).
4. En *Settings → Variables and Secrets* añade `GEMINI_API_KEY` como **Secret** si quieres el asistente y la lectura de boletos. `GEMINI_MODEL` ya está definido en `wrangler.jsonc` (se puede sobreescribir aquí).
5. **Dominio propio:** `wrangler.jsonc` ya contiene `routes` con `primitiva.marinweb.org` y `custom_domain: true`. En el primer deploy Wrangler crea el registro DNS y el certificado. Si ya tenías un registro A/CNAME para `primitiva.marinweb.org`, bórralo antes para evitar el conflicto. También se puede revisar en *Worker → Settings → Domains & Routes*.
6. Haz el primer deploy (botón *Deploy* o `git push`). `wrangler.jsonc` crea automáticamente el Durable Object (`SyndicateStore`) con la migración `v1`. La URL definitiva será **`https://primitiva.marinweb.org`** (la de `workers.dev` queda como respaldo: `https://primitiva.<tu-subdominio>.workers.dev`).
7. **Pasar los datos actuales:** abre la app local, descarga la copia JSON (icono de descarga), abre `https://primitiva.marinweb.org`, identifícate como administrador (PIN inicial `1234`) e importa el JSON. Si no quieres arrastrar el historial, la nube arranca con los datos iniciales.
8. **Cambia el PIN** en *Permisos* y comparte `https://primitiva.marinweb.org` con los socios. Ellos entran como *Socio* y no necesitan instalar nada.

### Actualizaciones automáticas

```bash
git add . && git commit -m "..." && git push
```

La automatización activa es **GitHub Actions** (`.github/workflows/deploy.yml`): cada `push` a `main` instala dependencias, comprueba tipos y despliega con el action oficial de Cloudflare. También se puede lanzar a mano con *Run workflow* en la pestaña *Actions*.

Secretos necesarios en GitHub → repo → **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con plantilla **Edit Cloudflare Workers** (y *Zone DNS Edit* sobre `marinweb.org`).
- `CLOUDFLARE_ACCOUNT_ID`: *Workers & Pages* → columna derecha → **Account ID**.

Si el Worker está conectado además a *Workers Builds* en Cloudflare, desactívalo: usa **un solo** sistema de despliegue automático para evitar dos despliegues por `push`. Para desplegar a mano desde el PC: `npx wrangler login` y `npm run deploy`.

Los socios sólo tienen que recargar la página. Tu ordenador no participa en el servicio.

### Datos y sesiones

- El estado se guarda en el Durable Object: sobrevive a despliegues y reinicios, y es coherente para todos los socios (las escrituras se serializan en el servidor).
- El secreto de los tokens también se guarda ahí: las sesiones ya no se invalidan al reiniciar. Cambiar el PIN sí cierra todas las sesiones.
- Las copias de seguridad se descargan desde la app; guárdalas de vez en cuando fuera de Cloudflare.
- Para probar el Worker en casa: `npm run dev:cloud` (por defecto puerto 8787, o `npm run dev:cloud -- --port 3001`). Para desplegar a mano: `npx wrangler login` y `npm run deploy`.

## Sesiones y permisos

- El PIN de administrador por defecto es **1234** y se puede cambiar desde *Permisos*. El PIN antiguo deja de funcionar al cambiarlo.
- El servidor emite tokens firmados (12 h). Las escrituras se validan en el servidor: un socio sólo puede registrar apuestas/boletos y sólo si el administrador ha concedido el permiso. Su copia local desactualizada no puede sobrescribir cuotas ni repartos.
- Los tokens se guardan en `sessionStorage` (caducan al cerrar la pestaña). Sin sesión se puede consultar, pero no modificar.

## Estructura

```
server.ts                       API local (Express) + persistencia atómica en JSON
worker/index.ts                 Worker de Cloudflare + Durable Object (SQLite)
wrangler.jsonc                  assets, binding del Durable Object y migración
src/lib/serverApi.ts            API compartida: tokens, permisos, validación y Gemini
src/App.tsx                     composición de pantallas y flujos de usuario
src/components/                 componentes reutilizables (modales, tarjetas, sorteos, toasts)
src/hooks/useSyncedSyndicate.ts estado central, cola de escrituras y sincronización
src/lib/finance.ts              cálculos y validaciones puras
src/lib/api.ts                  cliente HTTP y gestión de sesión
src/data/initialSyndicateData.ts datos iniciales y tipos
tsconfig.worker.json            comprobación de tipos del Worker
```
