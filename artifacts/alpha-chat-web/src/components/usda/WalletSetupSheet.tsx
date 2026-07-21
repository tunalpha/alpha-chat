/**
 * WalletSetupSheet — configura/modifica un indirizzo wallet per una chain specifica.
 * Mostrato quando l'utente tenta di inviare USDA senza wallet configurato,
 * oppure acceduto da WalletCenterPage per aggiornare un indirizzo.
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">🔗 Configura Wallet</span>
          <button className="usda-sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Chain selector */}
        <div className="usda-sheet-field">
          <label>Network</label>
          <div className="usda-chain-grid">
            {(Object.keys(WALLET_CHAIN_LABELS) as WalletChain[]).map((c) => (
              <button
                key={c}
                className={`usda-chain-btn ${chain === c ? "active" : ""}`}
                onClick={() => setChain(c)}
              >
                <span>{WALLET_CHAIN_LABELS[c].icon}</span>
                <span>{WALLET_CHAIN_LABELS[c].label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="usda-sheet-field">
          <label>Indirizzo {chainMeta.label}</label>
          <input
            className="usda-note-input"
            type="text"
            placeholder={chainMeta.placeholder}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
          />
        </div>

        <div className="usda-wallet-hint">
          💡 In futuro potrai collegare il wallet automaticamente tramite ThirdWeb Connect.
        </div>

        {error && <div className="usda-error">{error}</div>}

        <div className="usda-sheet-actions">
          <button className="usda-btn-secondary" onClick={onClose}>Annulla</button>
          <button className="usda-btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? "Salvataggio…" : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
}
