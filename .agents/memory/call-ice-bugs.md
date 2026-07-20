---
name: Call ICE bugs — TURN cache + buffered candidates InvalidStateError
description: Due bug distinti nel flusso WebRTC chiamate che impedivano l'audio su reti NAT restrittive.
---

## Bug 1 — `_iceLoaded` flag impediva l'uso del TURN dopo il deploy

`loadIceConfig()` in `webrtc.ts` usava un flag booleano `_iceLoaded` di modulo per caricare la config ICE una sola volta per sessione. Se la prima chiamata avveniva prima che i server TURN fossero configurati, `_iceServers` restava con solo STUN per tutta la vita della pagina — anche dopo il deploy del TURN.

**Fix:** rimosso `_iceLoaded`. `loadIceConfig()` ora fa una fetch fresca ad ogni chiamata. Latenza trascurabile (~50ms); garantisce sempre TURN aggiornati.

**Why:** il flag era un'ottimizzazione prematura. La config ICE è critica e deve essere sempre aggiornata.

## Bug 2 — `InvalidStateError` sui candidati ICE bufferizzati (callee)

`buildPC()` faceva il flush dei candidati ICE bufferizzati (arrivati durante lo squillo, prima che il PC esistesse) immediatamente dopo `new RTCPeerConnection()`. Ma sul callee, `setRemoteDescription(offer)` viene chiamato solo al passo successivo. `addIceCandidate()` senza remote description → `InvalidStateError` → candidati persi → ICE non completa.

**Fix:** rimosso il flush da `buildPC()`. Il flush è ora in `acceptCall()` immediatamente dopo `await pc.setRemoteDescription(incomingCall.sdp)`.

**How to apply:** qualunque flush di `iceCandidateBufferRef` deve avvenire DOPO `setRemoteDescription()`, mai prima.

## TURN server configurato

`openrelay.metered.ca` — server TURN pubblico gratuito di Metered.ca, credenziali pubbliche (`openrelayproject`/`openrelayproject`). Impostato come variabile d'ambiente `shared` (TURN_URLS, TURN_USERNAME, TURN_PASSWORD). Backend `/api/v1/calls/ice-config` già supportava TURN via env var.

## Nuovo diagLog aggiunto

`ice.config.loaded` — logga count e `hasRelay: true/false` ad ogni fetch ICE, così è verificabile dai log se i TURN arrivano al client.
