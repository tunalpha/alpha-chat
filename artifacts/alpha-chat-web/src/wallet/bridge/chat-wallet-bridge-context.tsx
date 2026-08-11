/**
 * ChatWalletBridgeContext — Provider + hook (Phase G)
 *
 * Wrappa WalletContext internamente ed espone SOLO la surface
 * definita da ChatWalletBridge. ChatPage importa questo file,
 * non useWallet() né nessun altro modulo wallet/*.
 *
 * ARCHITETTURA (Phase G §3.1):
 *   App root → WalletProvider → ChatWalletBridgeProvider → ChatPage
 *   AlphaWalletPage usa useWallet() direttamente (non il bridge)
 *
 * SICUREZZA:
 *   - sendPayment() richiede onAuthRequired callback (PIN/Face ID UI)
 *   - Il mnemonic è azzerato in finally block dopo ogni firma
 *   - Nessun tipo interno del wallet (WalletPhase, WalletMeta, etc.)
 *     è mai esposto al chiamante del bridge
 *   - Un evento WS non può chiamare sendPayment() — richiede UI interaction
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ── Wallet internals — solo questo file li importa da wallet/ ─────────────
import { useWallet }                             from "../context/WalletContext";
import { loadKeystore, decryptSeed }             from "../core/keystore";
import { validatePin }                           from "../core/wallet-auth";
import {
  signAndBroadcastNativeEvm,
  signAndBroadcastErc20Evm,
}                                                from "../services/evm-signer";
import {
  estimateNativeTransferGas,
  estimateErc20TransferGas,
}                                                from "../services/gas-service";
import { signAndBroadcastBtcTx }                 from "../services/btc-signer";
import { saveTxRecord }                          from "../services/tx-store";
import { VERIFIED_TOKENS }                       from "../evm/token-registry";
import { EVM_NETWORKS }                          from "../evm/evm-network-config";
import {
  apiGetAlphaWalletFeeConfig,
  apiRecordFeeOutcome,
}                                                from "../../lib/alpha-wallet-api";
// Phase G #90: fee collector con retry + report backend (sostituisce fire-and-forget)
import { collectPlatformFeeReliable }            from "./platform-fee-collector";

// ── Bridge types (public surface) ─────────────────────────────────────────
import {
  type ChatWalletBridge,
  type BridgeStatus,
  type WalletCapabilities,
  type SupportedNetwork,
  type SupportedEvmNetwork,
  type ChatPaymentRequest,
  type ChatPaymentResult,
  type PaymentQuote,
  NETWORK_CHAIN_IDS,
  NETWORK_LABELS,
  NETWORK_COLORS,
} from "./chat-wallet-bridge";

// ─── Context ──────────────────────────────────────────────────────────────

const ChatWalletBridgeCtx = createContext<ChatWalletBridge | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useChatWalletBridge(): ChatWalletBridge {
  const ctx = useContext(ChatWalletBridgeCtx);
  if (!ctx) {
    throw new Error(
      "[ChatWalletBridge] useChatWalletBridge() deve essere chiamato dentro ChatWalletBridgeProvider",
    );
  }
  return ctx;
}

// ─── Helper: EVM explorer URL ─────────────────────────────────────────────

function evmExplorerUrl(chainId: number, txHash: string): string {
  const net = Object.values(EVM_NETWORKS).find(n => n.chainId === chainId);
  if (!net) return `https://polygonscan.com/tx/${txHash}`;
  return `${net.explorerUrl}${net.txPath}${txHash}`;
}

// ─── Helper: parse human-readable amount to raw bigint ───────────────────

function parseAmount(amount: string, decimals: number): bigint {
  const f = parseFloat(amount);
  if (isNaN(f) || f <= 0) throw new Error("Importo non valido");
  // Avoid floating-point rounding: split on decimal
  const [whole = "0", frac = ""] = amount.split(".");
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded);
}

// ─── Provider ─────────────────────────────────────────────────────────────

interface Props { children: ReactNode }

export function ChatWalletBridgeProvider({ children }: Props) {
  const wallet = useWallet();
  const sendInProgressRef = useRef(false);
  // Force re-render when sendInProgress changes so callers see updated value
  const [, setSendTick] = useState(0);

  // ── BridgeStatus — never exposes WalletPhase to callers ───────────────
  const status: BridgeStatus = useMemo((): BridgeStatus => {
    switch (wallet.phase) {
      case "unlocked":     return "ready";
      case "locked":       return "locked";
      case "no-wallet":    return "unavailable";
      case "initializing": return "unavailable";
    }
  }, [wallet.phase]);

  // ── getCapabilities ───────────────────────────────────────────────────
  const getCapabilities = useCallback((): WalletCapabilities | null => {
    if (status !== "ready" || !wallet.meta) return null;

    const evmNetworks = (["polygon", "ethereum", "bsc"] as SupportedEvmNetwork[]).map(net => ({
      network:     net,
      networkName: NETWORK_LABELS[net],
      color:       NETWORK_COLORS[net],
      // Assets populated by ChatWalletPaySheet using balance-service live data
      assets:      [],
    }));

    return {
      evmNetworks,
      bitcoin: wallet.meta.btcAddress ? { balance: "0", balanceSat: 0n } : null,
      lastBalanceSyncAt: null,
    };
  }, [status, wallet.meta]);

  // ── getReceiveAddress ─────────────────────────────────────────────────
  const getReceiveAddress = useCallback((network: SupportedNetwork): string | null => {
    if (!wallet.meta) return null;
    if (network === "bitcoin") return wallet.meta.btcAddress ?? null;
    // All EVM networks share the same BIP-44 address (m/44'/60'/0'/0/0)
    return wallet.meta.evmAddress ?? null;
  }, [wallet.meta]);

  // ── calculateQuote ────────────────────────────────────────────────────
  const calculateQuote = useCallback(async (
    network:              SupportedNetwork,
    _tokenContractAddress: string | null,
    assetSymbol:          string,
    amount:               string,
  ): Promise<PaymentQuote | null> => {
    if (status !== "ready") return null;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return null;

    let feeConfig = { feeBps: 10, quoteValiditySec: 30, fetchedAt: Date.now() };
    try {
      const raw = await apiGetAlphaWalletFeeConfig();
      feeConfig = {
        feeBps:           raw.fee_bps,
        quoteValiditySec: raw.quote_validity_sec,
        fetchedAt:        Date.now(),
      };
    } catch { /* use defaults */ }

    const platformFeeNum = (amountNum * feeConfig.feeBps) / 10000;
    // Round to max 8 decimal places for display
    const platformFee = platformFeeNum.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

    let networkFee       = "~0.002";
    let networkFeeSymbol = assetSymbol;

    if (network !== "bitcoin") {
      const chainId  = NETWORK_CHAIN_IDS[network];
      const netEntry = Object.values(EVM_NETWORKS).find(n => n.chainId === chainId);
      networkFeeSymbol = netEntry?.nativeSymbol ?? "ETH";
      networkFee       = "~0.002";
    } else {
      networkFeeSymbol = "BTC";
      networkFee       = "~0.00001";
    }

    const totalAsset = (amountNum + platformFeeNum)
      .toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

    return {
      recipientAmount:  amount,
      platformFee,
      networkFee,
      networkFeeSymbol,
      totalAsset,
      frozenAt:         Date.now(),
      quoteValiditySec: feeConfig.quoteValiditySec,
    };
  }, [status]);

  // ── sendPayment ────────────────────────────────────────────────────────
  const sendPayment = useCallback(async (
    params:         ChatPaymentRequest,
    onAuthRequired: () => Promise<string | null>,
  ): Promise<ChatPaymentResult> => {

    // ── Anti-double-send mutex ──────────────────────────────────────────
    if (sendInProgressRef.current) {
      return {
        status:       "failed",
        errorCode:    "DOUBLE_SEND_PREVENTED",
        errorMessage: "Un pagamento è già in corso.",
        metadata:     params.metadata,
      };
    }

    // ── Guard: wallet disponibile? ──────────────────────────────────────
    if (status === "unavailable") {
      return { status: "failed", errorCode: "WALLET_UNAVAILABLE",
               errorMessage: "Nessun wallet creato.", metadata: params.metadata };
    }
    if (status === "locked") {
      return { status: "failed", errorCode: "WALLET_LOCKED",
               errorMessage: "Wallet bloccato.", metadata: params.metadata };
    }
    if (!wallet.meta?.evmAddress) {
      return { status: "failed", errorCode: "WALLET_UNAVAILABLE",
               errorMessage: "Wallet non inizializzato.", metadata: params.metadata };
    }

    // ── Quote scaduta? ──────────────────────────────────────────────────
    const age = Date.now() - params.frozenQuote.frozenAt;
    if (age > params.frozenQuote.quoteValiditySec * 1000) {
      return { status: "failed", errorCode: "QUOTE_EXPIRED",
               errorMessage: "La quote è scaduta. Ricalcola i costi e riconferma.",
               metadata: params.metadata };
    }

    sendInProgressRef.current = true;
    setSendTick(t => t + 1);
    let mnemonic: string | null = null;

    try {
      // ── 1. Autenticazione locale obbligatoria ───────────────────────
      // SECURITY RULE §16: mai bypassabile, anche con sessione attiva
      const pin = await onAuthRequired();
      if (pin === null) {
        return { status: "cancelled", metadata: params.metadata };
      }
      if (!validatePin(pin)) {
        return { status: "failed", errorCode: "AUTHENTICATION_FAILED",
                 errorMessage: "PIN non valido.", metadata: params.metadata };
      }

      // ── 2. Decripta mnemonic (usa PIN appena inserito) ──────────────
      const keystore = await loadKeystore();
      if (!keystore) {
        return { status: "failed", errorCode: "WALLET_UNAVAILABLE",
                 errorMessage: "Keystore non trovato.", metadata: params.metadata };
      }
      try {
        mnemonic = await decryptSeed(keystore, pin);
      } catch {
        return { status: "failed", errorCode: "AUTHENTICATION_FAILED",
                 errorMessage: "PIN errato. Riprova.", metadata: params.metadata };
      }

      // ── 3. Firma e broadcast ────────────────────────────────────────
      let txHash:      string;
      let explorerUrl: string;
      const { network, tokenContractAddress, assetSymbol, amount, recipientAddress } = params;

      if (network === "bitcoin") {
        // ── BTC ──────────────────────────────────────────────────────
        // Phase G #91: Platform fee è ATOMICA — inclusa nel PSBT come secondo output.
        // Se la TX è minata: sia il destinatario che il fee wallet vengono pagati.
        // Se fallisce il broadcast: né il destinatario né il fee wallet ricevono nulla.
        // Nessuna TX separata necessaria per BTC (a differenza di EVM).
        const amountSat     = parseAmount(amount, 8);
        const feeAmountSat  = parseAmount(params.frozenQuote.platformFee, 8);
        const DUST_SAT      = 546n;

        let btcFeeWallet: string | undefined;
        try {
          const feeConf = await apiGetAlphaWalletFeeConfig();
          if (feeConf.fee_wallet_btc) btcFeeWallet = feeConf.fee_wallet_btc;
        } catch { /* fee wallet non critico per il pagamento */ }

        const result = await signAndBroadcastBtcTx({
          mnemonic,
          recipientAddress,
          amountSat,
          feeTarget:          "normal",
          platformFeeAddress: feeAmountSat >= DUST_SAT ? btcFeeWallet : undefined,
          platformFeeSat:     feeAmountSat >= DUST_SAT ? feeAmountSat  : undefined,
        });
        txHash      = result.txid;
        explorerUrl = `https://blockstream.info/tx/${txHash}`;

        // Report fee outcome al backend (atomico: txHash = stesso della TX principale)
        void apiRecordFeeOutcome({
          mainTxHash:  txHash,
          network:     "bitcoin",
          assetSymbol: params.assetSymbol,
          feeAmount:   params.frozenQuote.platformFee,
          feeWallet:   btcFeeWallet ?? "",
          status:      btcFeeWallet && feeAmountSat >= DUST_SAT
            ? "success"
            : "failed_permanent",
          feeTxHash:   txHash, // stesso TX — atomico
          attempts:    1,
          error:       !btcFeeWallet
            ? "BTC_FEE_WALLET_NOT_CONFIGURED"
            : feeAmountSat < DUST_SAT
              ? "BTC_FEE_BELOW_DUST"
              : undefined,
        }).catch(() => {});

      } else {
        // ── EVM ──────────────────────────────────────────────────────
        const chainId    = NETWORK_CHAIN_IDS[network];
        const evmAddress = wallet.meta.evmAddress as `0x${string}`;

        if (tokenContractAddress) {
          // ERC-20 send
          const tokenInfo = VERIFIED_TOKENS.find(
            t => t.chainId === chainId &&
                 t.contractAddress?.toLowerCase() === tokenContractAddress.toLowerCase(),
          );
          const decimals  = tokenInfo?.decimals ?? 6;
          const amountRaw = parseAmount(amount, decimals);

          const gasEst = await estimateErc20TransferGas({
            chainId,
            from:             evmAddress,
            tokenContractAddr: tokenContractAddress as `0x${string}`,
            recipient:        recipientAddress as `0x${string}`,
            amount:           amountRaw,
          });

          const result = await signAndBroadcastErc20Evm({
            mnemonic,
            chainId,
            tokenContractAddr: tokenContractAddress as `0x${string}`,
            recipient:        recipientAddress as `0x${string}`,
            amount:           amountRaw,
            gasLimit:         gasEst.gasLimit,
            gasPrice:         gasEst.gasPrice,
            nonce:            gasEst.nonce,
          });
          txHash = result.txHash;

          // Phase G #90: fee TX con retry + report backend (NON fire-and-forget)
          // Awaited prima del finally che azzera il mnemonic.
          // Un fallimento qui non fa fallire il pagamento principale.
          await collectPlatformFeeReliable({
            mnemonic:    mnemonic!,
            chainId,
            network:     params.network,
            assetSymbol: params.assetSymbol,
            feeAmount:   params.frozenQuote.platformFee,
            mainTxHash:  txHash,
            tokenAddr:   tokenContractAddress as `0x${string}`,
            decimals,
            nonce:       gasEst.nonce + 1,
            gasLimit:    gasEst.gasLimit,
            gasPrice:    gasEst.gasPrice,
          }).catch(() => {/* errore fee non blocca il pagamento */});

        } else {
          // Native token send (ETH / POL / BNB)
          const amountWei = parseAmount(amount, 18);

          const gasEst = await estimateNativeTransferGas({
            chainId,
            from:     evmAddress,
            to:       recipientAddress as `0x${string}`,
            valueWei: amountWei,
          });

          const result = await signAndBroadcastNativeEvm({
            mnemonic,
            chainId,
            to:       recipientAddress as `0x${string}`,
            valueWei: amountWei,
            gasLimit: gasEst.gasLimit,
            gasPrice: gasEst.gasPrice,
            nonce:    gasEst.nonce,
          });
          txHash = result.txHash;

          // Phase G #90: fee TX con retry + report backend (NON fire-and-forget)
          await collectPlatformFeeReliable({
            mnemonic:    mnemonic!,
            chainId,
            network:     params.network,
            assetSymbol: params.assetSymbol,
            feeAmount:   params.frozenQuote.platformFee,
            mainTxHash:  txHash,
            // tokenAddr/decimals omessi → native send
            nonce:       gasEst.nonce + 1,
            gasLimit:    gasEst.gasLimit,
            gasPrice:    gasEst.gasPrice,
          }).catch(() => {/* errore fee non blocca il pagamento */});
        }

        explorerUrl = evmExplorerUrl(chainId, txHash);
      }

      // ── 4. Salva nel tx-store (con chatMessageId opzionale) ─────────
      const txId = network === "bitcoin"
        ? `btc:${txHash}:out:`
        : `${NETWORK_CHAIN_IDS[network]}:${txHash}:out:chat`;

      await saveTxRecord({
        id:        txId,
        chainId:   network === "bitcoin" ? 0 : NETWORK_CHAIN_IDS[network],
        network:   NETWORK_LABELS[network],
        txHash,
        direction: "out",
        asset:     assetSymbol,
        amount,
        toAddress: recipientAddress,
        timestamp: Date.now(),
        status:    "pending",
        updatedAt: Date.now(),
      });

      return {
        status:      "sent",
        txHash,
        explorerUrl,
        network,
        assetSymbol,
        amountSent:  amount,
        fee:         params.frozenQuote.platformFee,
        metadata:    params.metadata,
      };

    } catch (err: unknown) {
      const msg  = err instanceof Error ? err.message : "Errore sconosciuto";
      const code = msg.toLowerCase().includes("insufficient") ? "INSUFFICIENT_BALANCE"
        : (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch"))
          ? "NETWORK_ERROR"
          : "UNKNOWN";
      return { status: "failed", errorCode: code, errorMessage: msg, metadata: params.metadata };

    } finally {
      // SECURITY §17: azzera mnemonic dalla memoria
      mnemonic = null;
      sendInProgressRef.current = false;
      setSendTick(t => t + 1);
    }
  }, [status, wallet.meta]);

  // ─── Context value ────────────────────────────────────────────────────
  const bridge: ChatWalletBridge = useMemo(() => ({
    get status()         { return status; },
    get sendInProgress() { return sendInProgressRef.current; },
    getCapabilities,
    getReceiveAddress,
    calculateQuote,
    sendPayment,
  }), [status, getCapabilities, getReceiveAddress, calculateQuote, sendPayment]);

  return (
    <ChatWalletBridgeCtx.Provider value={bridge}>
      {children}
    </ChatWalletBridgeCtx.Provider>
  );
}

// ─── Nota Phase G #90 ─────────────────────────────────────────────────────
// Le funzioni _sendPlatformFeeErc20 e _sendPlatformFeeNative (fire-and-forget)
// sono state rimosse e sostituite da collectPlatformFeeReliable()
// in platform-fee-collector.ts, che implementa:
//   - retry (max 2 tentativi)
//   - idempotency via mainTxHash
//   - report outcome al backend (POST /alpha-wallet/fee-record)
//   - alert strutturato su fallimento permanente
