# WhatsApp Reminder Service

Microservicio Node.js (Express 4) para enviar recordatorios por WhatsApp usando whatsapp-web.js con sesión persistente local.

## Requisitos

- Node.js 18+
- Google Chrome/Chromium no es necesario: Puppeteer descarga Chromium automáticamente.
- Sistema Linux recomendado (probado en contenedores Alpine y Debian).

## Configuración

Variables de entorno:

- `PORT` (default `3001`)
- `ENABLE_CORS` (default `true`)
- `BODY_LIMIT` (default `100kb`)
- `WHATSAPP_CLIENT_ID` (default `agenta_local`)
- `SEND_TIMEOUT_MS` (default `20000`)

## Instalación y arranque

```bash
npm install
npm start
```

El servicio quedará en `http://127.0.0.1:3001` (o el `PORT` configurado).

## Endpoints

- `GET /health`
  - Responde `{ ok: true }`.

- `GET /status`
  - Responde `{ connected: boolean }`.

- `GET /qr`
  - Si hay QR disponible y aún no hay sesión activa:
    - Por defecto devuelve imagen PNG (`Content-Type: image/png`).
    - Con `?format=json` o encabezado `Accept: application/json`, devuelve JSON con data URL `{ qr: "data:image/png;base64,...", generatedAt }`.
  - Si no hay QR disponible, responde `503` con `{ ok:false, message }`.
  - Si ya está conectado, responde `204 No Content`.

- `POST /send`
  - Body JSON: `{ to: "52XXXXXXXXXX", message: "texto" }`.
  - Normaliza a JID `${to}@c.us` (se espera `52 + 10 dígitos` para MX -> 12 dígitos en total).
  - Requiere sesión activa; si no, `503 { ok:false, message:"No conectado" }`.
  - En éxito: `{ ok: true }`.

- `POST /logout`
  - Cierra sesión, limpia estado/QR y responde `{ ok: true }`.
  - El servicio re-inicializa para emitir un nuevo QR si se desea reconectar.

## Ejemplos cURL

```bash
# Health
curl -s http://127.0.0.1:3001/health | jq

# Status
curl -s http://127.0.0.1:3001/status | jq

# Obtener QR como PNG (guardar a archivo)
curl -s http://127.0.0.1:3001/qr -o qr.png

# Obtener QR como data URL en JSON
curl -s "http://127.0.0.1:3001/qr?format=json" | jq

# Enviar mensaje (cuando connected == true)
curl -s -X POST http://127.0.0.1:3001/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"521234567890","message":"Hola desde el bot"}' | jq

# Logout
curl -s -X POST http://127.0.0.1:3001/logout | jq
```

## Notas de implementación

- Librería: `whatsapp-web.js` ^1.23.0.
- Autenticación persistente local: `LocalAuth({ clientId: WHATSAPP_CLIENT_ID })`.
- Puppeteer: `headless: true` con flags `--no-sandbox` y `--disable-setuid-sandbox`.
- Eventos manejados: `qr`, `authenticated`, `ready`, `disconnected`.
- CORS opcional (por defecto habilitado). Límite de body configurable.
- Logs: inicio, QR generado, autenticado, ready, send ok, errores.

## Docker (opcional)

Build y run:

```bash
docker build -t whatsapp-reminder-service .
docker run --rm -it \
  -p 3001:3001 \
  -e PORT=3001 \
  -e ENABLE_CORS=true \
  -e WHATSAPP_CLIENT_ID=agenta_local \
  -v ${PWD}/.wwebjs_auth:/home/node/app/.wwebjs_auth \
  whatsapp-reminder-service
```

La carpeta `.wwebjs_auth` almacena la sesión persistente.

## Integración con Laravel

Usa `config('services.whatsapp.bot_url')`, por ejemplo `http://127.0.0.1:3001` y consume los endpoints descritos arriba. El endpoint `/qr` soporta imagen directa o JSON con data URL, compatible con proxys.
