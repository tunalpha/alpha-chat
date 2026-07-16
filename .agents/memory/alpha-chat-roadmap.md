---
name: Alpha Chat Roadmap
description: Roadmap ufficiale Sprint 13–21, approvata dal CTO (aggiornamento post Sprint 15)
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

### Sprint 16 — Signal Protocol (M3) — migrazione architetturale completa

⚠️ VINCOLI PERMANENTI — NON NEGOZIABILI:

**[A] Nessuna crittografia custom**
  Usare ESCLUSIVAMENTE `@signalapp/libsignal-client` (libreria ufficiale Signal Foundation).
  NON implementare algoritmi crittografici personalizzati.
  NON modificare X3DH, Double Ratchet o Sender Keys.
  Limitarsi a integrare il protocollo con l'architettura esistente.

**[B] Zero Plaintext Rule — regola di progetto permanente**
  Il server NON deve mai ricevere testo in chiaro.
  ❌ Niente log del testo, niente debug del testo, niente analytics del testo
  ❌ Niente preview generate dal server, niente ricerca server-side sul contenuto
  ✅ Il server vede SOLO: ciphertext, nonce, key ids, metadata strettamente necessari

**[C] Metadata Minimization**
  Anche con Signal il server conosce alcuni metadati — ridurli al minimo:
  - Lunghezza messaggio: padding opzionale per oscurare la dimensione reale
  - Tipo messaggio, timestamp, sender, recipient: necessari per routing
  - Contenuto: completamente opaco per il server

**[D] Recovery Strategy — decisione architetturale pre-codice**
  Filosofia scelta: Backup cifrato opzionale (non Signal pura)
  - Reinstallo / cambio telefono / rottura dispositivo: chiavi locali perse di default
  - Funzione opzionale: export backup cifrato con passphrase nota solo all'utente
  - Messaggi vecchi non recuperabili senza backup (massima sicurezza come default)
  Questa scelta va comunicata chiaramente all'utente in UI prima dell'onboarding.

**[E] Crypto Review Gate — checklist obbligatoria pre-merge Sprint 16**
  Nessun merge accettato finché non verificati:
  ☐ Nessuna chiave privata nei log
  ☐ Nessuna chiave privata nel database
  ☐ Nessun plaintext inviato al server
  ☐ Nessun algoritmo custom
  ☐ Uso esclusivo di @signalapp/libsignal-client
  ☐ Test di interoperabilità
  ☐ Test di migrazione chat esistenti

**Fase 1 — Crittografia**
- Identity Key Pair
- Signed PreKey
- One-Time PreKeys
- PreKey Bundle
- X3DH (Extended Triple Diffie-Hellman)
- Session Builder

**Fase 2 — Double Ratchet**
- Encrypt / Decrypt
- Forward Secrecy
- Rotazione automatica chiavi

**Fase 3 — Media E2E**
- Foto, Video, Vocali, Documenti cifrati E2E
- Il server riceve solo dati cifrati (zero-knowledge)

**Fase 4 — Multi-device**
- Identity propria per ogni dispositivo
- Signed PreKey per ogni dispositivo
- Sessioni indipendenti per dispositivo

**Fase 5 — Verifica identità**
- QR Code di verifica
- Fingerprint (Safety Numbers)
- Stato "verificato" visibile in UI
- Avviso cambio chiavi (key change warning)

**Fase 6 — Migrazione**
- Nuove chat → E2E Signal da subito
- Chat esistenti → migrazione progressiva (compatibilità temporanea)
- sender_key_id obbligatorio (attualmente nullable, va reso mandatory)

**Fase 7 — Audit post-migrazione**
- Penetration test
- Test replay attack, MITM, key compromise
- Device revoke + restore
- Performance sotto carico

### Sprint 17 — Sicurezza dispositivo
- Face ID, Touch ID, PIN, Password secondaria, Gestione sessioni, Gestione dispositivi

### Sprint 18 — Organizzazione
- Archivio, Preferiti, Cartelle, Ricerca locale (client-side dopo decifratura — E2E
  rende impossibile la ricerca server-side), Filtri, Messaggi fissati

### Sprint 19 — Gruppi
- Gruppi E2E, Ruoli, Amministratori, Permessi, QR gruppo, Inviti monouso

### Sprint 20 — Ecosistema
- Multi-dispositivo, PWA, Backup cifrato opzionale, Temi, Notifiche Push

### Sprint 21 — Military Edition (traguardo finale)
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
- Sprint 16 è il momento fondante — trasforma Alpha Chat da buona app di messaggistica
  a piattaforma con base crittografica solida. Solo allora il motto è pienamente onesto.

## Motto
"Il tuo bunker digitale."
