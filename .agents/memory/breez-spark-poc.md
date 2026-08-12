---
name: Breez SDK Spark PoC
description: Stato architettura, findings critici e decision log per l'integrazione Lightning con Breez SDK Spark nel PoC isolato (artifacts/breez-spark-poc/)
---

## Ambiente

- **COOP/COEP headers**: sopravvivono al proxy Replit dev → `crossOriginIsolated=true` confermato
- **SharedArrayBuffer**: disponibile
- **WASM binary**: 7.2MB, carica nel browser
- **IDB**: `breez-poc-live-v1/mainnet/d2ea863c` (v15) — creato da connect() live
- **getSparkStatus() browser**: bloccato da CORS. Funziona in Node.js. In produzione: backend proxy.

## API Key — MODELLO UFFICIALE CONFERMATO

- **Client-side è il modello UFFICIALE Breez** — README dice esplicitamente `config.apiKey = "<your api key>"` in codice browser
- **Nessun token exchange** né backend proxy documentato o necessario
- **Gratuita**: "The Breez SDK is free for developers"
- **Modello**: app identifier semi-pubblico (rate limiting), analogo a Firebase API key
- **Per PWA/WASM**: `VITE_BREEZ_API_KEY` come Replit secret è CORRETTO — non è una vulnerabilità
- **VITE_BREEZ_API_KEY**: aggiunta come Replit secret ✓

## Live Connect Checkpoint — TUTTI PASS ✅

Test eseguito su mainnet con API key reale (Playwright):
- **connect()**: PASS — connesso a mainnet con API key
- **getInfo()**: PASS
  - identityPubkey: `0281363910b0dc0015a4a25e758da30f0e28388ea5252c0e3713936f2d4ef7d3d5`
  - balanceSats: 0 (test mnemonic senza fondi reali)
  - tokenBalances: {}
- **syncWallet()**: PASS in 10936ms (~11 secondi)
- **listPayments()**: PASS — **20 pagamenti trovati** ⚠️ (mnemonic pubblico = altri utenti hanno usato la stessa seed)
- **IDB isolation**: PASS — solo `breez-poc-live-v1/mainnet/d2ea863c`, zero store Alpha

## Security inspection PASS

- Private key: mai trasmessa (ExternalSigner locale)
- Mnemonic: mai inviato agli operatori
- API key: letta da env, mai loggata, mai in localStorage/IDB manuale
- IDB Spark separata da store Alpha: CONFERMATO
- Console: zero errori, messaggi attesi "Web IndexedDB storage automatically enabled"

## Derivation path (FORMALMENTE DOCUMENTATO)

- Spark purpose: `m/8797555'/accountNumber'/keyType'`
- Identity key mainnet: `m/8797555'/1'/0'`
- **MAINNET default account = 1** (non 0 — errore comune)
- BTC on-chain: `m/84'/0'/0'/0/{idx}` (purpose 84) — no collision
- Empiricamente verificato: BIP84 pubkey ≠ Spark identity pubkey

## Findings critici

- **20 pagamenti su test mnemonic**: il BIP39 "abandon x11 about" è pubblico → altri l'hanno usato su mainnet Spark. In produzione usare SEMPRE seed utente reale, mai test vectors
- **syncWallet() ~11s**: sync iniziale mainnet richiede ~10-15 secondi. UX: spinner necessario
- **SDK v0.15.1**: BOLT12 receive non supportato in ReceivePaymentMethod
- **better-sqlite3**: blocca Node.js SDK su Replit NixOS — usa browser WASM (IDB)
- **Network**: gRPC over HTTPS porta 443 → operatori Spark raggiungibili da Replit

## Cosa manca prima di integrazione production

1. ✅ API key ricevuta + connect() PASS
2. Costi operatori Spark: risposta Breez pendente
3. Architecture design document approvato esplicitamente
4. Test su iPhone Safari reale (iOS background behavior)
5. Analisi contenuto IDB Spark (cosa viene persistito dal WASM)
6. PRODUCTION: `BREEZ_API_KEY` server-side senza prefisso VITE_ (se backend proxy desiderato in futuro)
