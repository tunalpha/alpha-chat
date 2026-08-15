---
name: Payment System — Regola assoluta di non regressione (🔒 permanente)
description: Policy utente vincolante per ogni sessione — l'intero payment stack di Alpha Chat è PROTECTED / DO NOT BREAK
---

**Regola:** l'intera architettura pagamenti di Alpha Chat è PROTECTED. Nessuna modifica, refactoring, unificazione, rinomina, spostamento o aggiornamento dipendenze sul payment stack se il task non riguarda direttamente un bug di pagamento. Testo integrale della policy: `attached_assets/Pasted--PAYMENT-SYSTEM-REGOLA-ASSOLUTA-DI-NON-REGRESSIONE-Da-q_1786799325915.txt` (262 righe).

**Why:** richiesta esplicita dell'utente (2026-08-15) dopo incidenti reali (double-charge, timeout ETH, payout al wallet sbagliato). La stabilità dei pagamenti ha priorità assoluta su refactoring/DRY/performance/feature.

**How to apply — punti operativi:**
- **Flussi protetti:** BTC on-chain, Lightning/Spark/Breez, USDA, USDT BSC/ETH/Polygon, Alpha Wallet, WalletConnect, iOS/PWA lifecycle, firma+retry, detection/polling, gas top-up, escrow, release, recovery, scheduler, webhook, stato/storico/UI pagamenti.
- **Codice condiviso:** prima di toccare una funzione usata anche dai pagamenti → FERMARSI e chiedere autorizzazione indicando: file, funzione, flow coinvolti, motivo, rischio, come si dimostra la non-regressione.
- **Nuove reti/pagamenti:** codice isolato (nuovi adapter/service/feature flag), mai modificare logica già in uso.
- **Test:** un solo test rosso su un payment flow BLOCCA la modifica. Regression minima: BTC → Lightning → USDA → USDT BSC → ETH → Polygon.
- **Produzione:** mai publish diretto dopo il primo fix; sequenza: analisi → root cause → fix minimo → test → regression → review indipendente → verifica diff → commit separato → report → APPROVAZIONE UTENTE → publish → test reale.
- **No blind fix:** su pagamento fallito, prima raccogliere tx hash/network/wallet/stato backend+frontend/log/escrow/release e identificare il punto esatto della catena; poi proporre il fix.
- **Wallet:** priorità destinatario SEMPRE Alpha Wallet → USDA/WalletConnect → legacy; validare formato indirizzo prima di ogni payout.
- **Retry:** errori frontend/WC/Safari/timeout ≠ "TX non effettuata": verificare firma/hash/mempool/conferma/deposito prima di consentire retry; mai un secondo pagamento se il primo può essere già broadcastato.
- **Timeout:** per-rete, mai hardcoded arbitrari.
- **Scheduler/recovery:** mai recovery concorrenti sullo stesso pagamento; verificare stato/TX pending/lock prima di ogni ciclo.
- **BTC/Lightning:** sistemi separati dall'EVM — mai introdurre gas station/escrow EVM/receipt polling nei loro percorsi.
- **Dipendenze:** mai aggiornare Breez/Spark/WalletConnect/Thirdweb/Alchemy/SDK blockchain/librerie wallet-signing senza verifica d'impatto.
- **Diff pre-publish:** mostrare file/funzioni/righe, flow coinvolti e NON coinvolti, test e risultati; se il diff contiene modifiche non necessarie → FERMARSI.
- In caso di dubbio anche minimo → FERMARSI E CHIEDERE.
