---
name: Signal recovery guard fix
description: Fix al ramo di recovery in signalDecrypt() che consumava OTPK inutilmente; analisi forense Cricco; sincronismo processV3
---

## Recovery guard — signalDecrypt() (signal-messenger.ts)

### Problema dimostrato
Il ramo `catch(firstErr)` in `signalDecrypt()` attivava `rebuildSession(senderUserId)` per **tutti** i fallimenti con `ciphertextType === 3`. Ogni chiamata a `rebuildSession` scarica il bundle del mittente via `apiGetKeyBundle()`, che esegue un pop atomico di 1 OTPK dalla pool del mittente (repository: `$inc: { otpk_count: -1 }`).

Risultato: 100 OTPK di Cricco esaurite in 10 sessioni di Alpha che tentava di decriptare messaggi falliti (10 burst × ~10 pops ciascuno, verificato via `consumed_at` in MongoDB).

### Fix applicato
```typescript
// PRIMA — troppo largo, attivato per qualsiasi fallimento type=3:
if (ciphertextType === 3) { ... rebuildSession ... }

// DOPO — circoscritto al caso legittimo:
if (
  ciphertextType === 3 &&
  firstErr instanceof Error &&
  firstErr.message.startsWith("Unknown identity key")
) { ... rebuildSession ... }
```

### Analisi della libreria (v0.0.16, congelato ADR-001)
- `"Unknown identity key"` → `session-builder.js:232` (template literal, prefisso fisso)
- `"Bad MAC"` → `internal/crypto.js:154` (quando OTPK privata è assente → shared secret errato)

Quando OTPK è consumata: `processV3` riceve `loadPreKey(N) → undefined`, continua senza OTPK, X3DH produce shared secret diverso → "Bad MAC". Il retry con la stessa chiave privata assente fallisce sempre.

### Nota critica: processV3 non awaita isTrustedIdentity
`session-builder.js:230` chiama `isTrustedIdentity` **SENZA yield**:
```javascript
const trusted = this.storage.isTrustedIdentity(name, ik, Direction.RECEIVING);
```
Con store async (key-store.ts in produzione), `trusted` è una Promise (truthy) → il check non scatta mai. "Unknown identity key" è **irraggiungibile in produzione** con il nostro store async.

**Why:** Questo significa che la nuova condizione `startsWith("Unknown identity key")` non si attiva mai in produzione → il recovery è di fatto disabilitato → il consumo anomalo di OTPK si interrompe. La condizione è comunque corretta: se la libreria viene aggiornata con `yield` o il store diventa sincrono, il recovery funzionerà solo nel caso legittimo.

**How to apply:** Verificato in `packages/signal-interop-tests/src/tests/20-recovery-guard.test.ts` con `SyncTrustStore` (override sincrono di `isTrustedIdentity`). Tutti 4 test passano.

### Root cause del problema Cricco/Alpha (forense completa)
1. **Causa A**: Cricco eseguiva codice vecchio (tab Safari aperto prima del deploy). Prova: assenza di log `[FORENSIC] SESSION CHECK` (chiamata incondizionale) dal send di Cricco.
2. **Causa B**: Alpha falliva decrypt dei messaggi di Cricco (pre_key_id=8, OTPK già consumata) → recovery attivava `rebuildSession(CRICCO)` → pop OTPK da Cricco × N volte → pool esaurita.
3. **Causa C**: Messaggi Alpha→Cricco con pre_key_id=8 sono permanentemente indecifrabili (OTPK #8 privata rimossa da IDB dopo primo decrypt).

### Cache-Control per il problema Safari
Per prevenire che Safari esegua vecchio codice con tab già aperto: aggiungere `Cache-Control: no-cache` sull'`index.html` nel server Express (i JS bundle con hash nel nome sono già immutabili). Non ancora implementato — da fare separatamente.
