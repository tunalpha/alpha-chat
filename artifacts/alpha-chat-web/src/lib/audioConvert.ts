/**
 * audioConvert — conversione audio lato client prima della cifratura E2E.
 *
 * Problema: Android Chrome registra esclusivamente audio/webm;codecs=opus.
 * iOS Safari non riesce a riprodurre WebM → "Formato non compatibile con iOS".
 *
 * Soluzione: converte WebM/Opus → WAV PCM 16-bit prima di encryptMediaBlob().
 * WAV è universalmente supportato da tutti i browser e sistemi operativi.
 *
 * Pipeline corretta:
 *   Registrazione → [webmToWav, solo se WebM] → encryptMediaBlob() → upload
 *
 * Perché questo è sicuro:
 * - Non tocca Signal, decrypt, encrypt, cache, sessioni, WebSocket.
 * - La conversione avviene sul blob grezzo, PRIMA della cifratura.
 * - encryptMediaBlob() riceve un Blob opaco: è indifferente al formato.
 * - detectAudioMimeType() lato ricezione legge i magic bytes RIFF → WAV → OK.
 * - I path iOS→iOS, iOS→Android, Android→Android rimangono invariati.
 */

/**
 * Converte un Blob audio WebM/Opus in WAV PCM 16-bit mono a 22050 Hz.
 *
 * Usa esclusivamente la Web Audio API nativa (zero dipendenze aggiuntive).
 * Garantito su Android Chrome: se il browser sa registrare WebM/Opus (encoder),
 * sa anche decodificarlo in AudioContext (stesso codec, libopus simmetrico).
 *
 * In caso di errore (formato non decodificabile) rigetta la promise →
 * il chiamante può fare fallback al blob originale.
 *
 * @param blob  Blob audio in formato WebM/Opus
 * @returns     Blob in formato WAV audio/wav
 */
export async function webmToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decodifica WebM/Opus → AudioBuffer usando la pipeline nativa del browser.
  // Il contesto viene chiuso subito dopo per liberare risorse hardware.
  const decodeCtx = new AudioContext();
  let sourceBuffer: AudioBuffer;
  try {
    sourceBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    // Non bloccare se close() fallisce (e.g. già chiuso)
    await decodeCtx.close().catch(() => undefined);
  }

  // Ricampiona a 22050 Hz mono (qualità voce ottimale, ~1.3 MB/min).
  // OfflineAudioContext gestisce il downsampling senza AudioWorklet.
  const TARGET_SAMPLE_RATE = 22_050;
  const numFrames = Math.ceil(sourceBuffer.duration * TARGET_SAMPLE_RATE);

  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  const pcm = rendered.getChannelData(0); // Float32Array [-1.0, 1.0]

  return encodePcmToWav(pcm, TARGET_SAMPLE_RATE);
}

/**
 * Codifica un Float32Array PCM mono in un Blob WAV standard (RIFF/PCM 16-bit).
 * WAV è supportato su iOS Safari, Android Chrome, tutti i desktop browser.
 */
function encodePcmToWav(pcm: Float32Array, sampleRate: number): Blob {
  const NUM_CHANNELS   = 1;
  const BITS_PER_SAMPLE = 16;
  const byteRate   = (sampleRate * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const dataLen    = pcm.length * blockAlign;

  // WAV = 44 byte header + PCM data
  const buffer = new ArrayBuffer(44 + dataLen);
  const view   = new DataView(buffer);

  // ── RIFF chunk ────────────────────────────────────────────────────────────
  writeAscii(view,  0, "RIFF");
  view.setUint32(4, 36 + dataLen, /*little-endian*/ true);
  writeAscii(view,  8, "WAVE");

  // ── fmt  chunk ────────────────────────────────────────────────────────────
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16,              true); // chunk size
  view.setUint16(20,  1,              true); // PCM format
  view.setUint16(22, NUM_CHANNELS,    true);
  view.setUint32(24, sampleRate,      true);
  view.setUint32(28, byteRate,        true);
  view.setUint16(32, blockAlign,      true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // ── data chunk ────────────────────────────────────────────────────────────
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLen, true);

  // Campioni PCM: Float32 [-1, 1] → Int16 [-32768, 32767]
  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]!));
    const int16   = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Scrive una stringa ASCII in un DataView a partire dall'offset dato. */
function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
