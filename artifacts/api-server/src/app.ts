import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { config } from "./config";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { clientVersionMiddleware } from "./middleware/client-version.middleware";
import { errorHandler } from "./errors/error-handler";
import router from "./routes";

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // Required for Replit preview iframe
    contentSecurityPolicy: config.app.env === "production",
  }),
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = config.app.allowedOrigins;
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Device-ID",
      "X-Request-ID",
      "X-Client-Version",
    ],
    credentials: !allowedOrigins.includes("*"),
    maxAge: 86400,
  }),
);

// ── Request ID (before logger so it appears in logs) ─────────────────────────
app.use(requestIdMiddleware);

// ── HTTP request logger ───────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({
      requestId: req.requestId,
    }),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
// Global limit: 145 MB to accommodate media uploads (max video 100 MB × 1.37 base64 ≈ 137 MB).
// Non-media endpoints are protected at the Zod validation layer (field-level length limits).
// Route-level body parsers cannot override the global one because the global runs first
// and rejects before routing; setting a single global limit is the correct Express pattern.
app.use(express.json({ limit: "145mb" }));
app.use(express.urlencoded({ extended: true, limit: "145mb" }));

// ── Hostname redirect: investors.alphachat.sbs → /investor-book/en ────────────
// Quando il custom domain investors.alphachat.sbs è puntato a questo deploy,
// qualsiasi richiesta alla root viene mandata direttamente all'Investor Book.
app.use((req, res, next) => {
  const host = req.hostname ?? "";
  if (host === "investors.alphachat.sbs" && !req.path.startsWith("/investor-book")) {
    return res.redirect(301, "/investor-book/en");
  }
  next();
});

// ── Client version check ──────────────────────────────────────────────────────
app.use(clientVersionMiddleware);

// ── Application routes ────────────────────────────────────────────────────────
app.use("/api", router);

// ── WebRTC earpiece diagnostic test page ─────────────────────────────────────
// Servita dal backend per evitare il rewrite SPA "/* → /index.html"
// URL: /api/webrtc-test
app.get("/api/webrtc-test", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // helmet blocca gli inline script in produzione — questa route di test ne ha bisogno
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; media-src *; connect-src *");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>WebRTC Earpiece Test</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0f; color: #e0e0e0;
      min-height: 100dvh; display: flex; flex-direction: column;
      align-items: center; justify-content: flex-start;
      padding: 32px 20px; gap: 20px;
    }
    h1 { font-size: 20px; font-weight: 600; color: #fff; text-align: center; }
    .subtitle { font-size: 13px; color: #888; text-align: center; line-height: 1.5; max-width: 320px; }
    .card {
      width: 100%; max-width: 360px;
      background: #16161e; border: 1px solid #2a2a3a;
      border-radius: 16px; padding: 20px;
    }
    .card-title { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
    button {
      width: 100%; padding: 15px; border-radius: 12px; border: none;
      font-size: 16px; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
    }
    button:active { opacity: 0.7; }
    button:disabled { opacity: 0.35; cursor: default; }
    #btnStart { background: #4a90e2; color: #fff; }
    #btnStop  { background: #e24a4a; color: #fff; display: none; }
    .status-box {
      width: 100%; max-width: 360px;
      background: #16161e; border: 1px solid #2a2a3a;
      border-radius: 16px; padding: 16px 20px;
    }
    #status { font-size: 14px; line-height: 1.6; color: #ccc; white-space: pre-wrap; font-family: monospace; }
    .note {
      width: 100%; max-width: 360px; font-size: 12px; color: #666;
      line-height: 1.6; border-top: 1px solid #1e1e2a; padding-top: 16px;
    }
  </style>
</head>
<body>
  <h1>WebRTC Earpiece Test</h1>
  <p class="subtitle">Minimal isolated test — no Alpha Chat code, no routing logic, no ringtones.</p>
  <div class="card">
    <div class="card-title">Test config</div>
    <div style="font-size:13px; color:#aaa; margin-bottom:16px; line-height:1.7;">
      &bull; getUserMedia({ audio: true })<br>
      &bull; Two local RTCPeerConnections (loopback)<br>
      &bull; Single &lt;audio&gt; element — no playsInline on iOS<br>
      &bull; No rings, no app logic
    </div>
    <button id="btnStart">&#9654; Start test</button>
    <button id="btnStop">&#9632; Stop</button>
    <div id="js-init-indicator" style="margin-top:10px;font-size:11px;color:#555;text-align:center;">JS: not yet executed</div>
  </div>
  <div class="status-box"><div id="status">Waiting for start&hellip;</div></div>
  <audio id="remoteAudio"></audio>
  <p class="note">
    Speak into the mic — you will hear your own voice with a short delay.<br><br>
    <strong>Earpiece</strong> &rarr; iOS can do it; Alpha Chat has a specific bug to isolate.<br>
    <strong>Speaker</strong> &rarr; iOS PWA platform limit; no JS can change it.
  </p>
  <script>
    // ── Diagnostica: cattura qualsiasi errore JS prima che si perda ──────────────
    window.onerror = function(msg, src, line, col, err) {
      var el = document.getElementById('status');
      if (el) el.textContent += '\\n[JS-ERROR] ' + msg + ' (' + src + ':' + line + ':' + col + ')';
      return false;
    };
    window.addEventListener('unhandledrejection', function(e) {
      var el = document.getElementById('status');
      if (el) el.textContent += '\\n[PROMISE-ERROR] ' + (e.reason && e.reason.message || e.reason);
    });

    const btnStart = document.getElementById('btnStart');
    const btnStop  = document.getElementById('btnStop');
    const statusEl = document.getElementById('status');
    const audioEl  = document.getElementById('remoteAudio');
    let pc1 = null, pc2 = null, micStream = null;

    // ── Indicatore visibile: conferma che il JS è arrivato fin qui ───────────────
    (function() {
      var el = document.getElementById('js-init-indicator');
      if (el) el.textContent = 'JS: loaded ✓  |  listeners: attaching…';
    })();

    function log(msg) {
      const ts = new Date().toTimeString().slice(0, 8);
      statusEl.textContent += '\\n[' + ts + '] ' + msg;
    }
    function cleanup() {
      if (pc1) { pc1.close(); pc1 = null; }
      if (pc2) { pc2.close(); pc2 = null; }
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
      audioEl.srcObject = null;
      btnStart.style.display = ''; btnStop.style.display = 'none';
    }
    // flag: srcObject già assegnato ma play() non ancora tentato
    let trackReady = false;
    let iceConnected = false;

    function maybePlay() {
      if (trackReady && iceConnected) {
        log('ICE connected + track ready → play()');
        audioEl.play()
          .then(() => { log('play() OK — listen: earpiece or speaker?'); })
          .catch(err => { log('play() FAIL: ' + err.name + ': ' + err.message); });
      }
    }

    btnStop.addEventListener('click', () => { log('Stopped.'); cleanup(); });
    btnStart.addEventListener('click', async () => {
      statusEl.textContent = '';
      trackReady = false;
      iceConnected = false;
      btnStart.style.display = 'none'; btnStop.style.display = '';
      const ua = navigator.userAgent;
      const iosM = ua.match(/OS ([\\d_]+)/);
      log('Device: ' + (iosM ? 'iOS ' + iosM[1].replace(/_/g, '.') : ua.slice(0, 60)));
      log('playsInline: ' + audioEl.playsInline);
      log('---');
      log('getUserMedia({ audio: true })…');
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        log('OK mic tracks: ' + micStream.getAudioTracks().length);
      } catch(e) { log('FAIL getUserMedia: ' + e.message); cleanup(); return; }

      // FIX 1: STUN server — senza di esso iOS non raccoglie candidati host locali
      const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
      log('Creating loopback RTCPeerConnections (STUN: stun.l.google.com)…');
      pc1 = new RTCPeerConnection(iceConfig);
      pc2 = new RTCPeerConnection(iceConfig);

      // FIX 2: log candidati per debug
      pc1.onicecandidate = e => {
        if (e.candidate) {
          log('pc1 cand → pc2: ' + e.candidate.type + ' ' + (e.candidate.address || '?'));
          pc2.addIceCandidate(e.candidate).catch(err => log('addIce pc2 ERR: ' + err.message));
        } else {
          log('pc1 gathering complete');
        }
      };
      pc2.onicecandidate = e => {
        if (e.candidate) {
          log('pc2 cand → pc1: ' + e.candidate.type + ' ' + (e.candidate.address || '?'));
          pc1.addIceCandidate(e.candidate).catch(err => log('addIce pc1 ERR: ' + err.message));
        } else {
          log('pc2 gathering complete');
        }
      };

      pc1.oniceconnectionstatechange = () => log('pc1 ICE state: ' + pc1.iceConnectionState);
      pc2.oniceconnectionstatechange = () => {
        log('pc2 ICE state: ' + pc2.iceConnectionState);
        // FIX 3: play() SOLO dopo ICE connected
        if (pc2.iceConnectionState === 'connected' || pc2.iceConnectionState === 'completed') {
          iceConnected = true;
          maybePlay();
        }
        if (pc2.iceConnectionState === 'failed') {
          log('ICE FAILED — nessun audio possibile. Prova con rete attiva o VPN disattivata.');
        }
      };

      // FIX 4: srcObject in ontrack ma play() rimandato a dopo ICE connected
      pc2.ontrack = e => {
        log('ontrack: ' + e.track.kind + ' readyState=' + e.track.readyState);
        audioEl.srcObject = e.streams[0] || new MediaStream([e.track]);
        trackReady = true;
        maybePlay();
      };

      micStream.getTracks().forEach(t => pc1.addTrack(t, micStream));
      log('Mic track added to pc1');
      try {
        const offer = await pc1.createOffer();
        log('offer SDP lines: ' + offer.sdp.split('\\n').length);
        await pc1.setLocalDescription(offer);
        await pc2.setRemoteDescription(offer);
        const answer = await pc2.createAnswer();
        log('answer SDP lines: ' + answer.sdp.split('\\n').length);
        await pc2.setLocalDescription(answer);
        await pc1.setRemoteDescription(answer);
        log('SDP exchange complete — waiting for ICE…');
      } catch(e) { log('SDP FAIL: ' + e.message); cleanup(); }
    });
  </script>
</body>
</html>`);
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Endpoint non trovato.",
      field: null,
      details: null,
      docs: "https://docs.alphachat.app/api",
    },
  });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

export default app;
