---
name: Alpha Wallet Phase A — core crypto
description: Quirks trovati durante l'implementazione del wallet core (mnemonic, HD derivation, keystore, token-registry)
---

## @scure/bip39 versione installata: 2.3.0 (non 1.5.4)

La versione installata localmente in `alpha-chat-web` è la **2.3.0**, non la 1.5.4 che è nel monorepo root.
Le subpath exports nella v2.x usano estensioni `.js` esplicite:

```typescript
// SBAGLIATO (v1.x):
import { wordlist } from "@scure/bip39/wordlists/english";

// CORRETTO (v2.x):
import { wordlist } from "@scure/bip39/wordlists/english.js";
```

`wordlist` NON è re-esportato dall'entry principale (`import { wordlist } from "@scure/bip39"` → undefined).

## IndexedDB in test (happy-dom)

happy-dom non espone `indexedDB` come bare global (non su `globalThis`). La libreria `idb` usa `indexedDB` direttamente → `ReferenceError`.

**Fix**: aggiungere `import "fake-indexeddb/auto"` nei test che usano IDB. Il pacchetto è installato come devDependency.

## IDB singleton condiviso (wallet-db.ts)

`keystore.ts` e `token-registry.ts` usano lo stesso DB `alpha-wallet-v1`. Se entrambi definiscono `getDB()` separati con upgrade handler diversi, il secondo upgrade non gira mai (DB già alla versione richiesta).

**Fix**: file `src/wallet/core/wallet-db.ts` con un unico `getWalletDB()` singleton che crea tutti gli store (`keystore`, `custom-tokens`). Entrambi i moduli importano da lì. Espone anche `closeWalletDB()` per reset tra test.

## Struttura file Phase A

```
src/wallet/
  core/
    mnemonic.ts     — BIP-39 (createMnemonic, isValidMnemonic, mnemonicToSeedBytes)
    hd-wallet.ts    — BIP-44 EVM (m/44'/60'/0'/0/idx) + BIP-84 BTC (m/84'/0'/0'/0/idx)
    keystore.ts     — AES-256-GCM, PBKDF2 100k iter, IndexedDB via wallet-db.ts
    wallet-auth.ts  — PIN validator, WebAuthn stub Phase E, sessione 15min
    wallet-db.ts    — IDB singleton (WALLET_DB_NAME="alpha-wallet-v1", v1)
  evm/
    evm-network-config.ts  — ETH(1), POL(137), BSC(56), explorer URLs
    token-registry.ts      — VERIFIED_TOKENS + custom token IDB storage
  index.ts          — barrel export

src/tests/wallet/
  mnemonic.test.ts
  hd-wallet.test.ts
  keystore.test.ts
  token-registry.test.ts
  evm-network-config.test.ts
```

## Vettore di test EVM

Hardhat mnemonic "test test...junk" → account 0 → `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (MetaMask confermato).

## Decimali BSC

BSC USDT: **18 decimali** (non 6). BSC USDC: **18 decimali** (non 6). Regola: il token registry è fonte di verità unica per i decimali.

## Pre-existing test failure corretto

`20-device-security.test.ts` riga ~163: il tipo `LockSettings` aveva ricevuto il campo `biometricOnly` (Sprint Biometric-Only) ma il test non era stato aggiornato. Fix: aggiungere `biometricOnly: false` all'oggetto `custom` nel test.

## USDA contract address

L'indirizzo USDA su Polygon era di soli 39 hex chars (typo). Aggiornato a 40 chars con suffisso `A`. **Da verificare con l'indirizzo ufficiale reale prima di andare in produzione.**
