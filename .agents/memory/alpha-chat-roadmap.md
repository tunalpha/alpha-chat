---
name: Alpha Chat Roadmap
description: Roadmap ufficiale Sprint 13–20, approvata dal CTO (aggiornamento post Sprint 12)
---

## Stato
- Sprint 1–12: ✅ Completati
  - Include: Auth, WebSocket, Chat E2E, Reply, Edit, Delete, Inviti monouso, QR,
    Ricerca pubblica rimossa, Profili, Impostazioni, Dispositivi, Demo interattiva,
    Secure Destroy completo (hard delete MongoDB, eliminazione media, aggiornamento
    preview conversazioni, broadcast WebSocket, multi-device, reply invalidati,
    predisposizione autodistruzione)

## Prossimi Sprint

### Sprint 13 — Media sicuri ✅ COMPLETATO
Modulo completo allegati — la logica Secure Destroy viene riutilizzata per ogni tipo di contenuto.
- 🎙️ Messaggi vocali (Secure Destroy)
- 📷 Foto
- 🎥 Video
- 📄 Documenti
- 🖼️ Anteprime
- 📥 Download
- 🔒 Cifratura E2E degli allegati
- 🛡️ Secure Destroy dei media

### Sprint 14 — Chiamate protette
- Audio + Video, WebRTC, TURN/STUN, Riduzione rumore, Verifica connessione E2E

### Sprint 15 — Privacy avanzata ✅ COMPLETATO
- Timer autodistruzione, Burn After Read, Modalità Ghost
- Nascondi stato, Lista bloccati, Privacy avanzata
⚠️ AUDIT COMPLETO richiesto prima di Sprint 16 (sicurezza, performance, batteria, memoria,
   sincronizzazione multi-device, test iPhone/Android/desktop).

### Sprint 16 — Sicurezza
- Face ID, Touch ID, PIN, Password secondaria, Gestione sessioni, Gestione dispositivi

### Sprint 17 — Organizzazione
- Archivio, Preferiti, Cartelle, Ricerca locale (client-side dopo decifratura — E2E
  rende impossibile la ricerca server-side), Filtri, Messaggi fissati

### Sprint 18 — Gruppi
- Gruppi E2E, Ruoli, Amministratori, Permessi, QR gruppo, Inviti monouso

### Sprint 19 — Ecosistema
- Multi-dispositivo, PWA, Backup cifrato opzionale, Temi, Notifiche Push

### Sprint 20 — Military Edition (traguardo finale)
- 🛡️ Panic Mode
- 🛡️ Distruzione completa conversazione
- 🛡️ Distruzione completa account
- 🛡️ Burn After Read
- 🛡️ Autodistruzione programmata
- 🛡️ Zero Tracking
- 🛡️ Modalità Ghost
- 🛡️ Audit di sicurezza completo

## Note architetturali
- Ricerca messaggi: solo client-side dopo decifratura (E2E rende impossibile server-side)
- Audit completo obbligatorio tra Sprint 15 e 16

## Motto
"Il tuo bunker digitale."
