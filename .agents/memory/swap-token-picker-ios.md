---
name: Swap token picker on iOS
description: Comportamento affidabile del selettore token nelle schermate swap mobile/PWA.
---

I selettori token dei flussi swap devono usare un bottom sheet fixed con
backdrop, coerente con il selettore Li.Fi, anziché un menu assoluto ancorato
alla card del form.

**Why:** nei contenitori scrollabili della PWA iOS un menu inline può risultare
coperto o tagliato, dando l’impressione che il tap sul token non abbia aperto
nessuna lista.

**How to apply:** montare il sheet in un React portal su `document.body`, poi
mostrare rete e saldo nelle righe; chiudere alla selezione, alla X o al tap sul
backdrop. Riutilizzare le classi `asw-sheet-*` per mantenere z-index e
comportamento mobile coerenti.