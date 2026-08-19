---
name: ChangeNOW fixed-rate minimum UI
description: Semantica e comunicazione corretta della soglia minAmount del flusso ChangeNOW fixed-rate.
---

`minAmount` del range ChangeNOW fixed-rate è l'importo minimo del token
**inviato** necessario per poter bloccare una quota a tasso fisso. Non è il
minimo del token ricevuto né il valore del tasso.

**Why:** Presentare, per esempio, `84 POL` come “Minimo tasso garantito”
faceva sembrare che il valore fosse una garanzia espressa nella moneta
ricevuta (USDC). Convertirlo in output produrrebbe solo una stima derivata,
non una garanzia comunicata dal provider.

**How to apply:** Nella UI ChangeNOW usare una dicitura equivalente a
“Minimo da inviare per tasso fisso”, mostrare il simbolo del token sorgente e
spiegare che non è l'importo ricevuto. Applicare la stessa semantica alla card
di input e ai dettagli della quotazione.