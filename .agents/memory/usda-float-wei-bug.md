---
name: USDA float→wei precision bug
description: Number(amount).toFixed(18) produce wei in meno → detectDeposit scarta la TX reale per sempre (loop "Conferma blockchain…")
---

# USDA — conversione importo float → wei (incidente 2026-08-15)

**Sintomo**: TX confermata on-chain (wallet mostra "Completata"), ma la sheet resta in loop "Conferma blockchain…" per sempre; log backend: `alchemyCount>0` ma "nessun tx trovato".

**Root cause**: `toWei18()` in SendPaymentSheet convertiva con `Number(amount).toFixed(18)`. Il double IEEE-754 non rappresenta 0.7 → `"0.699999999999999956"` → on-chain 44 wei in MENO di `amount_units` nel DB → il filtro `value < minAmount` in `detectDeposit` scartava la TX reale a ogni polling.

**Regole durevoli**:
1. Qualsiasi conversione decimale→unità token deve essere string-based (o `parseUnits` di viem) — MAI passare da `Number()`.
2. Un confronto `>=` esatto su importi on-chain generati da client è fragile: serve una micro-tolleranza verso il basso, dimensionata sull'errore IEEE-754 (~1e-16 relativo), quindi `units/10^15 + costante piccola` — NON percentuali tipo 1 ppm (underpayment materiale su importi grandi).
3. La tolleranza va applicata in TUTTI i punti di verifica (detect + verifica receipt finale): applicarla solo al primo fa passare il detect e fallire la conferma → loop identico.

**Come diagnosticare**: riprodurre la scansione Alchemy con gli stessi parametri e confrontare `rawContract.value` con `amount_units` — una differenza di pochi wei è la firma di questo bug. Nota: `getRpcUrl()` preferisce ALCHEMY_API_KEY; USDA_POLYGON_RPC può NON supportare i metodi `alchemy_*`.
