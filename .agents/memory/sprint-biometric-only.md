---
name: Biometric-only lock (Face ID senza PIN)
description: Modalità biometrica autonoma — Face ID / Touch ID come unico metodo di blocco, senza PIN.
---

## Cosa è stato implementato
- `biometricOnly: boolean` aggiunto a `LockSettings` (lock-settings.ts)
- `biometricOnlyEnabled` state in `LockContext` — inizializzato da `s.biometricOnly && bioExists`
- `enableBiometricOnly()` — registra credenziale WebAuthn + salva settings + blocca subito
- `disableBiometricOnly()` — disabilita settings + se no PIN rimuove credenziale
- `App.tsx` guard: `(hasPINSet || biometricOnlyEnabled) && isLocked`
- `LockScreen.tsx` — branch separato per biometric-only: no PinPad, bottone Face ID prominente, fallback "Esci dall'account" (logout)
- `PrivacyPage.tsx` — sezione "Face ID / Touch ID" con toggle + timeout grid (4 opzioni: subito/1min/5min/15min)

## Comportamento in caso di rimozione Face ID dal telefono
`verifyBiometric()` lancia errore → `tryUnlockWithBiometric()` imposta `error` → LockScreen mostra errore + link "Esci dall'account".
L'utente non può restare bloccato nell'app senza via d'uscita.

## Flusso di attivazione
1. PrivacyPage → toggle "Abilita Face ID" → `enableBiometricOnly()`
2. Se la credenziale non è già registrata: `setupBiometricLib(userId)` → dialog WebAuthn nativo
3. Se ok: `setIsLocked(true)` → LockScreen appare immediatamente per conferma
4. L'utente sblocca con Face ID → conferma che funziona

## Timer e visibilitychange
Activity listener e visibilitychange ora controllano `s.biometricOnly` oltre a `hasPIN(userId)`.
Timeout configurabile come per il PIN (TIMEOUT_OPTIONS filtrate a [0, 1min, 5min, 15min] nella UI).

**Why:** L'infrastruttura WebAuthn + LockContext esisteva già. La modifica minima era aggiungere `biometricOnly` come flag indipendente da `hasPIN`, ed esporre `enableBiometricOnly`/`disableBiometricOnly`.
