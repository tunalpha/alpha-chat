---
name: Wallet unlock auto-trigger bug
description: UnlockView aveva un useEffect che auto-triggerava Face ID al mount, vanificando lockWallet()
---

# Wallet unlock auto-trigger — risolto

## La regola
**Non aggiungere auto-trigger biometrico in UnlockView del wallet.** L'utente deve premere esplicitamente il pulsante "Face ID / Touch ID".

**Why:** `lockWallet()` chiama `setPhase("locked")` → `setSubView("unlock")` → UnlockView monta.
Se UnlockView ha `useEffect(() => { if (primaryBiometric) void handleBiometric(); }, [])`,
Face ID si attiva automaticamente prima che l'utente possa premere ←, sblocca il wallet,
e `phase` torna "unlocked". L'utente non può uscire senza aver sbloccato.

**How to apply:** Se si deve aggiungere auto-trigger in futuro, verificare che il contesto
sia solo apertura fredda dell'app (non post-`lockWallet()`). Una flag tipo `fromExplicitLock`
passata alla UnlockView potrebbe discriminare i due casi.

## Traccia navigazione wallet (per futuri debug)

```
App.tsx:232  goBack = () => setView("chat")
App.tsx:306  case "alpha-wallet": return <AlphaWalletPage onBack={goBack} />

WalletContext init useEffect (deps=[]):
  → gira UNA VOLTA al mount del WalletProvider (al root, non si rimonta mai)
  → isSessionValid() → true → setPhase("unlocked") | false → setPhase("locked")

AlphaWalletInner useEffect([wallet.phase]):
  locked   → setSubView("unlock")
  unlocked + subView∈{"unlock","welcome"} → setSubView("overview")

Header back button:
  (subView==="overview" || subView==="unlock") ? onBack() : setSubView("overview")
```

## Invarianti architetturali
- WalletProvider è al root → NON si rimonta su navigazione tra view
- `phase` persiste in React state fino a `lockWallet()` o `forgetWallet()`
- `invalidateSession()` → `_lastAuthAt = 0` (wallet-auth.ts, modulo globale)
- `isSessionValid()` controllato SOLO nell'init useEffect (al mount dell'app)
