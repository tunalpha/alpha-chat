/**
 * BTC_LN_COMING_SOON
 *
 * Quando è `true`:
 *   - La tab BTC/Lightning mostra "Presto disponibile"
 *   - Nessun provider BTC/LN viene istanziato (BoltzBtcLnProvider, BreezSparkBtcLnProvider)
 *   - Nessuna quote, firma, transazione o deposito BTC/LN può essere avviata
 *   - EVM Swap non è coinvolto e continua a funzionare normalmente
 *
 * Per riattivare BTC/Lightning quando il nuovo provider è pronto:
 *   1. Imposta `BTC_LN_COMING_SOON = false`
 *   2. Sostituisci/collega il provider desiderato in SwapView.tsx (router useMemo)
 *
 * NON eliminare i provider esistenti (BoltzBtcLnProvider, BreezSparkBtcLnProvider,
 * SwapRouter, hardening LN→BTC, idempotency, recovery, timeout/unknown state).
 * Rimangono nel codice pronti per il futuro.
 */
export const BTC_LN_COMING_SOON = true as const;
