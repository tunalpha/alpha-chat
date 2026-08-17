---
name: iOS PWA notification icon limitation
description: Su iOS, le push notification PWA mostrano sempre l'icona dell'app — il campo `icon` del payload è ignorato.
---

# iOS PWA Notification Icon — Limitazione Permanente

**Rule:** Non promettere o tentare di cambiare l'icona delle notifiche push per iOS PWA.

**Why:** iOS Safari (≥16.4 da Home Screen) ignora il campo `icon` nelle push notification VAPID e nella Notification API. Mostra sempre l'icona del manifest dell'app. Il testo "from [App Name]" sotto il titolo è aggiunto automaticamente da iOS e non è configurabile.

**How to apply:**
- Per differenziare visivamente le notifiche su iOS, usare emoji nel TITOLO (es. "💰 Alpha Wallet — X ricevuto", "✅ Alpha Swap completato").
- Su Android/desktop il campo `icon` funziona normalmente — si può usare un'icona diversa per tipo di notifica.
- Non creare ticket/task per "cambiare icona notifiche iOS" — è una limitazione della piattaforma, non un bug.
