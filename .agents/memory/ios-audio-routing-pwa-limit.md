---
name: iOS audio routing — PWA fundamental limit
description: Routing earpiece/speaker su iOS Safari PWA per WebRTC — tutti i tentativi falliti e conclusione definitiva
---

## Conclusione definitiva
Su iOS Safari PWA non esiste API JavaScript per instradare l'audio WebRTC all'auricolare (earpiece).
Safari non imposta `AVAudioSession.mode = .voiceChat` — usa `.videoChat` o `.default` che defaultano allo speaker.

**Why:** iOS espone controllo AVAudioSession solo a codice nativo (Swift/ObjC). JavaScript nel browser non può cambiarlo.

## Tentativi falliti (tutti confermati con log diagnostici)
1. `playsInline = true` su `<audio>` → speaker (era già il comportamento originale)
2. `playsInline = false` su `<audio>` → speaker (nessun effetto)
3. `<video>` senza `playsInline` su iOS → **crash dell'app** + speaker comunque (rollback immediato)
4. Ordine `unlockNotifAudio` prima/dopo getUserMedia → nessun effetto sul routing

## Prova diagnostica
- Build versioning implementato (app_version = git SHA, build_time ISO, service_worker_version via MessageChannel)
- Confermato stessa build su entrambi i dispositivi — il codice era corretto, iOS ignorava l'intento

## Stato corrente del codice
`getEl()` in `remoteAudio.ts` usa `<audio>` senza `playsInline` su iOS (dopo rollback video).
`applyRouting` path `ios_earpiece` esiste ma iOS va sempre a speaker.

## Unica soluzione definitiva
Wrapper Capacitor (app nativa iOS) — permette `AVAudioSession.setCategory(.playAndRecord, mode: .voiceChat)` via plugin nativo.

## Note collaterali
- `SW_VERSION` via MessageChannel → `sw-timeout` perché il SW non risponde al ping in tempo (< 1500ms);
  comportamento accettabile, non bloccante.
- `DECRYPT-FAILURE Bad MAC` nei log di Cricco (build `e6d2697`) — problema Signal separato, non correlato alle chiamate.
