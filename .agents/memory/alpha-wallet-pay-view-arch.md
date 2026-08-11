---
name: Alpha Wallet Pay View — full-screen architecture
description: ChatWalletPaySheet ora è una full-screen view in normal flow (non più bottom-sheet fixed overlay). Decisione definitiva per iOS Safari PWA.
---

# Alpha Wallet Pay View — architettura full-screen

## La regola

`ChatWalletPaySheet` NON è più un bottom-sheet (position:fixed backdrop). È una **full-screen view** che occupa il posto della chat quando `showWalletPay === true`.

## Perché

`overflow-y: auto` dentro un elemento il cui antenato è `position: fixed` non funziona su iOS Safari PWA. Qualsiasi workaround CSS (translateZ, max-height, dvh) è inaffidabile. L'unica soluzione è eliminare il fixed dall'antenato.

## Struttura CSS (awp-*)

```
awp-view       display:flex; flex-direction:column; height:100%
  awp-header   flex-shrink:0   ← non scrolla
  awp-content  flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch
  awp-footer   flex-shrink:0   ← CTA sempre visibile
```

**Why it works:** `awp-content` ha `overflow-y:auto` ma il suo antenato è `.chat-area` che è `position:relative`, NON `position:fixed`. iOS Safari gestisce questo correttamente.

## Integrazione ChatPage

```tsx
// In <main className="chat-area">:
{showGroupInfo ? <GroupInfoPage>
  : showWalletPay && activeConv && auth ? <ChatWalletPaySheet ... />  // ← full-screen
  : !activeConvId ? <empty>
  : <normal chat>}
```

`showWalletPay` fa anche rendere visibile `chat-area` su mobile (aggiunto `&& !showWalletPay` alla condizione `chat-area-mobile-hidden`).

## NON ripristinare mai il vecchio pattern

Non riportare `cwp-backdrop` o `cwp-sheet` con `position:fixed`. Se Step 4 avesse ancora problemi, la soluzione è ridurre il contenuto dello step — mai tornare al fixed overlay.

## Step 4 Riepilogo — layout compatto

- `cwp-summary-hero`: una riga "Nome riceverà / importo" (no big card centrata)
- `cwp-quote`: tabella compatta con Rete + Destinatario (truncated) + fee + totale
- Indirizzo: inline nella tabella, monospace 11px, max-width 160px truncato
- Nessun blocco indirizzo separato che occupa spazio
