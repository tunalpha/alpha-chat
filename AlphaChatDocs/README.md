# AlphaChatDocs — Indice della Documentazione
> Aggiornato: Luglio 2025

Questa cartella è la fonte di verità unica per tutto il progetto Alpha Chat.
Ogni sviluppatore, designer, e contributor inizia da qui.

---

## Struttura

| File | Contenuto | Status |
|---|---|---|
| `00_Manifesto.md` | Le 20 regole immutabili del prodotto | ✅ Completo |
| `01_Brand.md` | Logo, colori, tipografia, icone, suoni, haptic | ✅ Completo |
| `02_Product.md` | Visione di prodotto a lungo termine (V3) | ✅ Completo |
| `03_Bible.md` | Costituzione tecnica — 52 regole verificabili | ✅ Completo |
| `04_Architecture.md` | Architettura MVP — stack, moduli, sprint plan | ✅ Completo v3.0 |
| `04b_Security.md` | Analisi sicurezza, architettura E2E, roadmap pre-dev | ✅ Completo |
| `04c_TechnicalReview.md` | Review multi-prospettiva, scorecard, checklist produzione | ✅ Completo |
| `05_Database.md` | Schema MongoDB completo — ogni collection, campo, indice | ✅ Completo |
| `06_API.md` | Specifica API REST — endpoint, payload, errori | ⏳ Prossimo |
| `07_Frontend.md` | Specifiche UI per ogni schermata | ⏳ In pianificazione |
| `08_Backend.md` | Struttura backend, moduli, servizi | ⏳ In pianificazione |
| `09_Testing.md` | Strategia test — unit, integration, E2E | ⏳ In pianificazione |
| `10_Release.md` | Checklist release, versioning, deploy | ⏳ In pianificazione |

---

## Decisioni Chiuse (Non Riaprire)

| Decisione | Scelta | Data |
|---|---|---|
| Database principale | MongoDB Atlas | Luglio 2025 |
| Crittografia messaggi | Signal Protocol (libsignal) da V1 | Luglio 2025 |
| Algoritmo JWT | ES256 (ECDSA P-256) | Luglio 2025 |
| Real-time transport | Stream Chat SDK | Luglio 2025 |
| Storage media | Cloudflare R2 | Luglio 2025 |
| Chiamate | Daily.co WebRTC | Luglio 2025 |
| Push notifications | Expo Push (APNs + FCM) | Luglio 2025 |
| ORM | Mongoose | Luglio 2025 |
| Font | Inter (Variable) | Luglio 2025 |
| Icone | Phosphor Icons | Luglio 2025 |

---

## Regola di Aggiornamento

Un documento con status ✅ **non viene modificato** salvo:
- Bug reale nella specifica (qualcosa non funziona come scritto)
- Decisione tecnica che invalida una scelta precedente
- Requisito legale che forza un cambiamento

Ogni modifica a un documento ✅ viene documentata nel changelog del file stesso.
Le modifiche estetiche o i "miglioramenti" non giustificano la modifica di un documento chiuso.

---

## Feature Filter (da 03_Bible.md)

Ogni nuova funzionalità deve superare:
1. Rende Alpha Chat migliore di WhatsApp?
2. È utile al 90% degli utenti?
3. Vale la complessità che introduce?

Se la risposta a una delle tre è "no" → backlog, non V1.
