---
name: Path C double-decrypt bug
description: ChatPage.decryptSingleMsg aveva un cache guard mancante nel path 1:1 senza device_ciphertexts — secondo tentativo Signal sovrascriveva il plaintext con [Messaggio non decifrabile]. Bug separato: clearMediaCache al logout distruggeva il plaintext cache.
---

## Bug 1 — Cache guard mancante in Path C (WS reconnect)

`decryptSingleMsg` in `ChatPage.tsx` ha tre path per i messaggi ricevuti:

| Path | Condizione | IDB cache guard |
|---|---|---|
| A | gruppo con device_ciphertexts | ✅ `getMetaByMessageId` prima di Signal |
| B | 1:1 con device_ciphertexts | ✅ `getMetaByMessageId` prima di Signal |
| **C** | **1:1 senza device_ciphertexts** | fix applicato (2026-07-19: guard toplevele + cache write testo) |
| **D** | **1:1 con device_ciphertexts** | stesso guard toplevel copre anche questo path |

**Path C attivo quando:** `device_ciphertexts: []` — fan-out Signal non trova bundle server (es. post-DB-reset).

**Trigger:** WS reconnect → `decryptBatch()` rieseguito → Path C chiama `signalDecrypt()` una seconda volta → ratchet già avanzato → eccezione → catch scrive `[Messaggio non decifrabile]` sovrascrivendo il plaintext.

**Fix:** IDB cache guard (`getMetaByMessageId`) aggiunto all'inizio di Path C + guard nel catch che non sovrascrive plaintext già esistente in state.

## Bug 2 — clearMediaCache al logout (logout → login)

**`AuthContext.tsx`, `logout()`:** la funzione chiamava `clearMediaCache()` contraddicendo il suo stesso commento ("la media cache viene preservata in IDB, così al re-login i messaggi precedenti restano decifrabili").

**Catena di fallimento:**
1. Sessione 1: messaggio Path C decifrato → plaintext salvato in media IDB via `cacheDecryptedMeta`
2. Logout: `clearMediaCache()` → wipe dell'intera media IDB incluso il plaintext
3. Sessione 2 (re-login): `getMetaByMessageId` → null (cache svuotata)
4. Path C chiama `signalDecrypt()` → Double Ratchet già avanzato → eccezione
5. Tutti i messaggi → `[Messaggio non decifrabile]`

**Fix:** rimossa `clearMediaCache()` da `logout()`. Rimane solo in `logoutAll()` (revoca device). Signal IDB e media cache sono companion — devono avere lo stesso ciclo di vita.

**Why:** il Double Ratchet è forward-only; un messaggio può essere decifrato UNA SOLA VOLTA. Il plaintext cache è l'unico modo per rileggere i messaggi decifrati in precedenza senza possedere una copia server-side in chiaro.

**How to apply:** ogni volta che si valuta di "pulire" la media cache, verificare che anche le Signal sessions vengano cancellate (e viceversa). Se uno dei due sopravvive al logout, devono sopravvivere entrambi.
