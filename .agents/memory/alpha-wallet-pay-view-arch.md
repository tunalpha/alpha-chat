---
name: Alpha Wallet Pay Sheet — presentation architecture
description: Bottom-sheet compatto per ChatWalletPaySheet; causa del bug "Step 4 bianco"; regole di presentazione iOS PWA
---

# Architettura finale (approvata dall'utente, ago 2026)

Bottom-sheet overlay (`cwp-backdrop` fixed + `cwp-sheet` ancorato in basso), NON full-screen in-place.
- Sheet alto quanto il contenuto (max-height 100dvh − safe-area), flex column: header / content / footer.
- **Regola fondamentale**: NESSUNO step dipende dallo scroll interno; ogni step compatto sta nel viewport mobile. Il CTA vive nel footer strutturale (flex-shrink:0), mai dentro l'area scrollabile → il bug iOS "fixed + overflow interno" non può nasconderlo.
- Backdrop click chiude, MA disabilitato durante `sending` E `auth` (in auth sendPayment awaita la promise del PIN: chiudere orfanerebbe pinResolveRef e lascerebbe il mutex anti-double-send attivo fino al reload).

# Bug "Step 4 bianco" (causa esatta)

`bridge.calculateQuote()` risolve **null senza throw** quando il wallet non è `ready` (es. auto-lock iOS PWA) o l'importo non è parsabile. Il vecchio codice faceva `setQuote(null); setStep("summary")` → contenuto E footer di summary gated su `step==="summary" && quote` → schermo bianco con solo header.

**Regole permanenti:**
1. Ogni chiamata che può risolvere null deve gestire il null esplicitamente (non solo il catch).
2. Su quote null → errore + `setStep("amount")` SEMPRE (il handler può essere invocato anche dal fallback su summary).
3. Fallback difensivo renderizzato per `summary && !quote` (messaggio + "Ricalcola i costi") — mai uno step senza render path.
4. Effect countdown scadenza quote: functional `setStep` (deps solo [quote] → `step` è stale nella closure).
5. `handlePinCancel`: torna a `summary` solo se quote esiste ancora, altrimenti `amount`.

# Test infrastructure gotcha

Il file `src/components/chat/__tests__/chat-wallet-pay-sheet-wizard.test.tsx` NON era incluso in vitest (`include` copriva solo `src/tests/**`) → "641 test verdi" non copriva affatto il wizard. Fix: include esteso, `@testing-library/react`+`jest-dom` installati, `setup-dom.ts` con `afterEach(cleanup)` (con `globals:false` l'auto-cleanup non si attiva → elementi duplicati tra test). Ora 665 test.
