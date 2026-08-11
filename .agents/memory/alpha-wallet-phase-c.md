---
name: Alpha Wallet Phase C–E — findings and decisions
description: Decisioni architetturali, bug critici e finding di Phase C, D, E del wallet Alpha.
---

## BSC USDT decimals
BSC USDT ha 18 decimali (non 6). MC_DECIMALS["bsc"]=18. Fonte: token-registry.ts è la fonte di verità unica.

## AppError in wallet code
`throw new AppError(CODE, httpStatus)` — non usare Error generico.

## EVM key zeroing
La chiave privata va azzerata nel `finally` block dopo ogni firma, prima del GC.

## Phase E — EVM signing test setup (agosto 2026)
- `vi.resetAllMocks()` in `beforeEach` (NON `vi.clearAllMocks()`) — clearAllMocks non svuota la coda di `mockImplementationOnce`, resetAllMocks sì.
- Indirizzi contratto nei test devono essere lowercase (checksum EIP-55 non valido → `getAddress()` lancia prima del broadcast).

## USDA contract address — verificato on-chain (agosto 2026)

**Indirizzo corretto: `0xe714655fD1B3ba96B887DF1F94336c2A78E24001`**

PolygonScan: "AlphaBit USDA (USDA)" — corrisponde all'API getusda.xyz (`"message":"AlphaBit USD (USDA) API"`).

L'indirizzo precedente `0x23396cF899Ca06c4472205fC903bDB4de249D6f` (39 hex chars, non 40) restituiva "Error Code: Invalid Token" su PolygonScan — era un placeholder mai esistito on-chain.

**File aggiornati:**
- `artifacts/alpha-chat-web/src/wallet/evm/token-registry.ts` — `USDA_POLYGON_ADDRESS`
- `artifacts/alpha-chat-web/src/lib/thirdweb.ts` — `USDA_CONTRACT_ADDRESS`
- `artifacts/api-server/src/wallet/token-registry-server.ts` — `contractAddress` chain 137 USDA
- `artifacts/alpha-chat-web/src/tests/wallet/custom-token-import.test.ts` — `THIRDWEB_USDA_ADDRESS` locale

Dopo la correzione: 516/516 test verdi.

**Why:** Un token EVM esiste on-chain solo se il suo address ha 40 hex chars e PolygonScan lo riconosce come contratto. Il vecchio indirizzo a 39 chars non superava nemmeno la validazione EIP-55 (`getAddress()` lancia). Il payment engine aveva già il corretto da prima.
