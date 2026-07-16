# ADR-001 — Libreria crittografica Signal Protocol per browser

**Data**: 2026-07-16  
**Stato**: Accettato  
**Autore**: CTO Alpha Chat  
**Deciders**: Team tecnico

---

## Contesto

Alpha Chat implementa il Signal Protocol (X3DH + Double Ratchet) per la cifratura E2E dei messaggi. Il backend Node.js usa `@signalapp/libsignal-client` (native addon). Il frontend React/Vite deve eseguire le stesse operazioni crittografiche nel browser.

### Il problema

`@signalapp/libsignal-client` è un **native Node.js addon** (Rust compilato via NAPI):
- Nessun build WebAssembly pubblicato da Signal su npm (confermato: `rust/bridge/` contiene solo `ffi`, `jni`, `node`, `shared` — nessun `wasm/`)
- Non esiste un bridge WASM ufficiale che Signal abbia pubblicato
- La licenza è **AGPL-3.0-only**: incompatibile con Alpha Chat come prodotto proprietario (obbligo di rilasciare l'intero sorgente)

### Opzioni valutate

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| Build WASM da sorgente libsignal (Rust) | 100% interoperabile | No bridge WASM esiste; costruirlo = crypto custom; AGPL | ❌ Scartata |
| `@privacyresearch/libsignal-protocol-typescript` | Protocol-correct, browser-native, GPL-3 | Community-maintained, ultima versione 2023 | ✅ **Scelta** |
| `@noble/curves` + XEdDSA custom | MIT, attiva | Richiede XEdDSA custom (contro il principio "no crypto custom") | ❌ Scartata |
| Web Crypto API + noble/curves | Browser-native | No XEdDSA, stessa incompatibilità | ❌ Scartata |

---

## Decisione

Usare **`@privacyresearch/libsignal-protocol-typescript` v0.0.16** come fork interno nel monorepo (`packages/libsignal-ts/`), con versione congelata e nessun aggiornamento automatico.

### Perché questa libreria

1. **Protocollo corretto**: è un porting TypeScript dell'implementazione di riferimento JavaScript di Signal (`libsignal-protocol-javascript`), validata da Signal stessa prima della deprecazione
2. **Matematica identica**: dipende da `@privacyresearch/curve25519-typescript` — un wrapper WASM/asm.js della stessa libreria C di Curve25519 che Signal usava nell'implementazione JS
3. **Implementa l'intera catena**: X3DH (`SessionBuilder`), Double Ratchet (`SessionCipher`), XEdDSA (`KeyHelper.generateSignedPreKey`), PreKey Bundle (`DeviceType`)
4. **Nessun crypto custom**: il protocollo Signal è implementato interamente dalla libreria — Alpha Chat non scrive algoritmi crittografici

---

## Vincoli permanenti

### 1. Fork interno — nessuna dipendenza esterna diretta

Il pacchetto `@workspace/libsignal-ts` è il **punto di accesso unico** alla libreria Signal per il frontend. Nessun altro modulo importa direttamente `@privacyresearch/libsignal-protocol-typescript`.

### 2. Versione congelata

`package.json` di `@workspace/libsignal-ts` usa versione esatta (senza `^` o `~`):
```json
"@privacyresearch/libsignal-protocol-typescript": "0.0.16"
```
Nessun aggiornamento automatico. Ogni upgrade richiede:
- Review del diff
- Verifica che nessun algoritmo crittografico sia stato modificato
- Esecuzione della suite di test di interoperabilità
- Approvazione esplicita del CTO

### 3. Nessuna modifica agli algoritmi

Non modificare `@privacyresearch/libsignal-protocol-typescript` o `@privacyresearch/curve25519-typescript`. Il fork `@workspace/libsignal-ts` aggiunge solo:
- Wrapper di inizializzazione WASM
- Utilità base64 ↔ ArrayBuffer
- Store IndexedDB che implementa `StorageType`

### 4. Suite di test di interoperabilità obbligatoria

Prima di ogni upgrade e come requisito per Phase 2 completata:

| Test | Descrizione |
|---|---|
| Alice ↔ Bob base | Alice cifra → Bob decifra, e viceversa |
| Multi-device | Bob riceve da due dispositivi di Alice |
| Nuovo dispositivo | Sessione instaurata con device senza OTPK disponibili |
| Rotazione Signed PreKey | Rotazione SPK non rompe sessioni esistenti |
| OTPK esaurite | X3DH funziona senza OTPK (solo SPK) |
| Safety Number | Fingerprint consistente tra le due parti |
| Replay attack | Messaggio duplicato viene rifiutato |

---

## Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Vulnerabilità nella libreria non patchata | Bassa (protocollo stabile) | Alto | Monitoring CVE + fork ci dà controllo completo |
| Divergenza formato chiavi con libsignal-client server | Media (Phases 1-5) | Medio | Server è relay puro; verifica client-side consistente |
| Libreria non mantenuta | Alta (già così) | Medio | Fork interno: aggiornamenti solo quando necessario e con audit |

---

## Piano di migrazione futura

Se Signal pubblicherà una versione browser ufficiale di libsignal (WASM con licenza compatibile):

1. Valutare interoperabilità chiavi/sessioni con implementazione corrente
2. Scrivere adattatori per differenze di formato
3. Test completo della suite di interoperabilità
4. Migrazione progressiva (nuove sessioni prima, vecchie sessioni via re-keying)
5. Deprecare `@workspace/libsignal-ts` dopo verifica completa

---

## Deviazioni dalla spec Signal pura

| Deviazione | Descrizione | Impatto | Fase risoluzione |
|---|---|---|---|
| Identity Key format | Libreria usa 33 byte con prefisso 0x05; libsignal-client nativo usa stesso formato | Nessuno per ora (server è relay) | Phase 6 |
| Interoperabilità client-server direct | `@signalapp/libsignal-client` non può verificare firme XEdDSA generate da @privacyresearch senza adattatori | Nessuno per Phases 2-5 | Phase 6 (Safety Numbers) |

---

## Riferimenti

- [Signal Protocol spec](https://signal.org/docs/specifications/x3dh/)
- [XEdDSA spec](https://signal.org/docs/specifications/xeddsa/)
- [Double Ratchet spec](https://signal.org/docs/specifications/doubleratchet/)
- [privacyresearchgroup/libsignal-typescript](https://github.com/privacyresearchgroup/libsignal-typescript)
- [signalapp/libsignal](https://github.com/signalapp/libsignal) (sorgente Rust — AGPL-3.0)
