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
import { apiGetAlphaWalletFeeConfig }            from "../../lib/alpha-wallet-api";

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
        const amountSat = parseAmount(amount, 8); // BTC has 8 decimal places
        const result = await signAndBroadcastBtcTx({
          mnemonic,
          recipientAddress,
          amountSat,
          feeTarget: "normal",
        });
        txHash      = result.txid;
        explorerUrl = `https://blockstream.info/tx/${txHash}`;

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

          // Platform fee: fire-and-forget ERC-20 fee TX (non-blocking)
          void _sendPlatformFeeErc20(
            mnemonic,
            chainId,
            tokenContractAddress as `0x${string}`,
            params.frozenQuote.platformFee,
            decimals,
            gasEst.nonce + 1,
            gasEst.gasLimit,
            gasEst.gasPrice,
          ).catch(err => console.warn("[Bridge] Platform fee TX failed (non-critical):", err));

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

          // Platform fee: fire-and-forget native fee TX
          void _sendPlatformFeeNative(
            mnemonic,
            chainId,
            params.frozenQuote.platformFee,
            gasEst.nonce + 1,
            gasEst.gasLimit,
            gasEst.gasPrice,
          ).catch(err => console.warn("[Bridge] Platform fee TX failed (non-critical):", err));
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

// ─── Private helpers: platform fee collection (fire-and-forget) ──────────
// These run AFTER the main TX with the same mnemonic still in scope.
// They are non-blocking — a failure here does NOT affect the user's TX.

async function _sendPlatformFeeErc20(
  mnemonic:    string,
  chainId:     number,
  tokenAddr:   `0x${string}`,
  feeAmount:   string,
  decimals:    number,
  nonce:       number,
  gasLimit:    bigint,
  gasPrice:    bigint,
): Promise<void> {
  let feeConfig: { fee_wallet_evm?: string } = {};
  try { feeConfig = await apiGetAlphaWalletFeeConfig(); } catch { return; }
  const feeWallet = feeConfig.fee_wallet_evm;
  if (!feeWallet || !feeWallet.startsWith("0x")) return;

  const feeRaw = parseAmount(feeAmount, decimals);
  if (feeRaw <= 0n) return;

  await signAndBroadcastErc20Evm({
    mnemonic,
    chainId,
    tokenContractAddr: tokenAddr,
    recipient:         feeWallet as `0x${string}`,
    amount:            feeRaw,
    gasLimit,
    gasPrice,
    nonce,
  });
}

async function _sendPlatformFeeNative(
  mnemonic:  string,
  chainId:   number,
  feeAmount: string,
  nonce:     number,
  gasLimit:  bigint,
  gasPrice:  bigint,
): Promise<void> {
  let feeConfig: { fee_wallet_evm?: string } = {};
  try { feeConfig = await apiGetAlphaWalletFeeConfig(); } catch { return; }
  const feeWallet = feeConfig.fee_wallet_evm;
  if (!feeWallet || !feeWallet.startsWith("0x")) return;

  const feeWei = parseAmount(feeAmount, 18);
  if (feeWei <= 0n) return;

  await signAndBroadcastNativeEvm({
    mnemonic,
    chainId,
    to:       feeWallet as `0x${string}`,
    valueWei: feeWei,
    gasLimit,
    gasPrice,
    nonce,
  });
}
