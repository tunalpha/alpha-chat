---
name: Li.FI BTC PSBT safety
description: Regola permanente per i depositi BTC→EVM gestiti da Li.FI.
---

## Regola

Un deposito Bitcoin per una route Li.FI BTC→EVM deve firmare e trasmettere **soltanto** il PSBT restituito dalla quote Li.FI. Prima di accedere alla chiave o fare broadcast, devono coincidere il memo `OP_RETURN` univoco, il vault dichiarato e l'importo in satoshi. Non è consentito ricostruire una normale transazione BTC verso il vault, aggiungere un memo manualmente o usare il sender BTC generico.

Uno stato Li.FI `DONE` è completato solo se collega il txid BTC firmato (`sending`) alla chain EVM e alla transazione di payout (`receiving`) attese.

**Why:** Li.FI correla l'ordine tramite il PSBT/memo; un output BTC al solo vault non dimostra la route e può lasciare fondi non attribuibili. Il vecchio controllo basato sul solo hash di destinazione poteva accettare uno stato appartenente a un'altra direzione o deposito.

**How to apply:** Ogni modifica a BTC→EVM Li.FI deve mantenere un signer isolato dal normale invio BTC e da ChangeNOW, conservare la validazione fail-closed e testare memo assente/alterato, vault o importo diversi, e status con source txid assente o differente. Li.FI resta inattivo finché non viene verificato un PSBT reale in ambiente controllato.