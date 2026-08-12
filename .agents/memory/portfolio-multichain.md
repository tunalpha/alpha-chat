---
name: Portfolio Multi-Chain
description: How the Portfolio view is implemented in Alpha Wallet — architecture, hook, components, navigation
---

## Rule
Portfolio Multi-Chain è una view separata (`"portfolio"`) nel wallet che mostra il totale EUR su tutte le chain e un elenco ordinato per valore decrescente. NON toccare l'OverviewView se non per aggiungere/rimuovere la card.

## Architecture

### Hook condiviso: `usePortfolioBalances()`
- Definito in `AlphaWalletPage.tsx`, prima di `AssetList`
- Chiama `fetchEvmBalance` per Polygon (137), Ethereum (1), BSC (56) + `fetchBtcBalance` + `fetchPrices` in `Promise.allSettled`
- Refresh ogni 60s + su evento `aw:new-tx` — stessa cadenza dell'overview esistente
- Restituisce `{ all: PortfolioAllBalances, prices: AssetPrices | null, loading: boolean }`

### PortfolioTotalCard
- Card cliccabile sopra il network selector in `OverviewView`
- Mostra totale fiat, "N chain · M asset"
- Al tap → `onNavigate("portfolio")`
- Ha il proprio stato via `usePortfolioBalances()` (separato dall'overview, ma stesso pattern)

### PortfolioView
- Subview `"portfolio"` nella navigazione di `AlphaWalletInner`
- Usa lo stesso hook `usePortfolioBalances()`
- Tap su un asset → `onSelectChain(chainId)` = `wallet.setSelectedChainId(chainId)` + `setSubView("overview")`
- Lista ordinata per fiatValue DESC

### calcPortfolioTotal()
- Funzione pura condivisa da PortfolioTotalCard e PortfolioView
- Nessun double-counting: ogni (chainId, contractAddress) è unico

**Why:** L'approccio self-contained con hook condiviso minimizza le modifiche all'OverviewView esistente e non richiede lift-state-up.

**How to apply:** Per aggiungere nuove chain (es. Arbitrum), aggiungere in `usePortfolioBalances`, `calcPortfolioTotal`, e `addEvm()` in PortfolioView. Nessuna modifica all'OverviewView necessaria.
