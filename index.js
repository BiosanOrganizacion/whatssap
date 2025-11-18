import express from 'express';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';

// Config
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const ENABLE_CORS = (process.env.ENABLE_CORS || 'true').toLowerCase() === 'true';
const BODY_LIMIT = process.env.BODY_LIMIT || '100kb';
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || 'agenta_local';

// App
const app = express();
if (ENABLE_CORS) app.use(cors());
app.use(express.json({ limit: BODY_LIMIT }));

// State
let connected = false;
let authenticated = false;
let lastQRString = null; // raw string from whatsapp-web.js
let lastQRDataUrl = null; // data:image/png;base64,...
let lastQRPngBuffer = null; // Buffer of PNG image
let lastQRTimestamp = null;
let initializing = false;

// WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/last.json',
  },
});

const safeInitialize = async () => {
  if (initializing) return;
  initializing = true;
  try {
    console.log('[service] Inicializando cliente de WhatsApp...');
    await client.initialize();
  } catch (e) {
    console.error('[service] Error inicializando whatsapp-web.js:', e);
  } finally {
    initializing = false;
  }
};

client.on('qr', async (qr) => {
  lastQRString = qr;
  try {
    lastQRPngBuffer = await QRCode.toBuffer(qr, { type: 'png', margin: 1, width: 300 });
    lastQRDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
    lastQRTimestamp = Date.now();
    connected = false;
    console.log(`[whatsapp] QR generado${authenticated ? ' (después de desconexión)' : ''}. Listo para escanear.`);
  } catch (err) {
    console.error('[whatsapp] Error generando QR:', err);
  }
});

client.on('authenticated', () => {
  authenticated = true;
  console.log('[whatsapp] Autenticado.');
});

client.on('ready', () => {
  connected = true;
  // Limpia QR de memoria al estar listo
  lastQRString = null;
  lastQRDataUrl = null;
  lastQRPngBuffer = null;
  lastQRTimestamp = null;
  console.log('[whatsapp] Cliente listo (ready).');
});

client.on('disconnected', async (reason) => {
  connected = false;
  authenticated = false;
  console.warn('[whatsapp] Desconectado:', reason);
  try {
    // Reintenta inicializar para emitir nuevo QR si corresponde
    await safeInitialize();
    console.log('[whatsapp] Re-inicialización solicitada tras desconexión.');
  } catch (e) {
    console.error('[whatsapp] Error al re-inicializar:', e);
  }
});

// Start
safeInitialize();

// Routes
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/status', (_req, res) => {
  res.json({ connected });
});

app.get('/qr', (req, res) => {
  // Si ya está conectado no hay QR disponible
  if (connected) {
    return res.status(204).end();
  }
  if (!lastQRPngBuffer && !lastQRDataUrl) {
    return res.status(503).json({ ok: false, message: 'QR no disponible todavía' });
  }

  const wantsJson = req.query.format === 'json' || (req.get('accept') || '').includes('application/json');
  if (wantsJson) {
    // Responder como data URL en JSON (aceptamos qr o data)
    const dataUrl = lastQRDataUrl || (lastQRPngBuffer ? `data:image/png;base64,${lastQRPngBuffer.toString('base64')}` : null);
    return res.json({ qr: dataUrl, generatedAt: lastQRTimestamp });
  }

  // Por defecto, servir imagen PNG
  res.setHeader('Content-Type', 'image/png');
  return res.status(200).send(lastQRPngBuffer);
});

app.post('/send', async (req, res) => {
  try {
    if (!connected) {
      return res.status(503).json({ ok: false, message: 'No conectado' });
    }

    const { to, message } = req.body || {};
    if (!to || !message) {
      return res.status(400).json({ ok: false, message: 'Parámetros inválidos: se requiere to y message' });
    }

    const toStr = String(to).trim();
    if (!/^\d{12}$/.test(toStr)) {
      return res.status(400).json({ ok: false, message: 'El número debe ser 12 dígitos (e.g., 52 + 10 dígitos para MX)' });
    }

    const chatId = `${toStr}@c.us`;

    const sendPromise = client.sendMessage(chatId, String(message));
    const timeoutMs = Number(process.env.SEND_TIMEOUT_MS || 20000);

    const result = await Promise.race([
      sendPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);

    console.log('[send] OK ->', { to: toStr });
    return res.json({ ok: true });
  } catch (err) {
    if (String(err && err.message).includes('timeout')) {
      console.error('[send] Timeout enviando mensaje');
      return res.status(504).json({ ok: false, message: 'Timeout enviando mensaje' });
    }
    console.error('[send] Error enviando mensaje:', err);
    return res.status(500).json({ ok: false, message: 'Error enviando mensaje' });
  }
});

app.post('/logout', async (_req, res) => {
  try {
    await client.logout();
    connected = false;
    authenticated = false;
    lastQRString = null;
    lastQRDataUrl = null;
    lastQRPngBuffer = null;
    lastQRTimestamp = null;
    console.log('[whatsapp] Sesión cerrada por /logout.');

    // Re-inicializa para generar nuevo QR si se desea re-conectar
    setTimeout(() => {
      safeInitialize();
    }, 500);

    return res.json({ ok: true });
  } catch (err) {
    console.error('[logout] Error al cerrar sesión:', err);
    return res.status(500).json({ ok: false, message: 'Error al cerrar sesión' });
  }
});

// Error handling
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ ok: false, message: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`[service] WhatsApp Reminder Service escuchando en http://127.0.0.1:${PORT}`);
});
