/**
 * WalletSetupSheet — configura/modifica un indirizzo wallet per una chain specifica.
 */

import { useState } from "react";
import { apiUsdaSetWalletAddress } from "../../lib/usda-api";
import type { WalletInfo, WalletChain } from "../../lib/usda-types";
import { WALLET_CHAIN_LABELS } from "../../lib/usda-types";

interface Props {
  initialChain?: WalletChain;
  onClose: () => void;
  onSetup: (wallet: WalletInfo) => void;
}

export function WalletSetupSheet({ initialChain = "usda", onClose, onSetup }: Props) {
  const [chain,   setChain]   = useState<WalletChain>(initialChain);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const chainMeta = WALLET_CHAIN_LABELS[chain];

  async function handleSave() {
    if (!address.trim()) {
      setError("Inserisci un indirizzo wallet valido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const wallet = await apiUsdaSetWalletAddress(address.trim(), chain);
      onSetup(wallet);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Configura wallet ${chainMeta.label}`}
      onClick={onClose}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">🔗 Configura Wallet</span>
          <button
            type="button"
            className="usda-sheet-close"
            aria-label="Chiudi"
            onClick={onClose}
          >✕</button>
        </div>

        {/* Chain selector */}
        <div className="usda-sheet-field">
          <label id="chain-select-label">Network</label>
          <div
            className="usda-chain-grid"
            role="radiogroup"
            aria-labelledby="chain-select-label"
          >
            {(Object.keys(WALLET_CHAIN_LABELS) as WalletChain[]).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={chain === c}
                aria-label={WALLET_CHAIN_LABELS[c].label}
                className={`usda-chain-btn ${chain === c ? "active" : ""}`}
                onClick={() => setChain(c)}
              >
                <span aria-hidden="true">{WALLET_CHAIN_LABELS[c].icon}</span>
                <span>{WALLET_CHAIN_LABELS[c].label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="usda-sheet-field">
          <label htmlFor="wallet-address-input">Indirizzo {chainMeta.label}</label>
          <input
            id="wallet-address-input"
            className="usda-note-input"
            type="text"
            placeholder={chainMeta.placeholder}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
            aria-label={`Indirizzo ${chainMeta.label}`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>

        <div className="usda-wallet-hint">
          💡 In futuro potrai collegare il wallet automaticamente tramite ThirdWeb Connect.
        </div>

        {error && <div className="usda-error" role="alert">{error}</div>}

        <div className="usda-sheet-actions">
          <button type="button" className="usda-btn-secondary" aria-label="Annulla" onClick={onClose}>
            Annulla
          </button>
          <button type="button" className="usda-btn-primary" aria-label={`Salva indirizzo ${chainMeta.label}`} onClick={handleSave} disabled={loading}>
            {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Salvataggio…</> : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
}
