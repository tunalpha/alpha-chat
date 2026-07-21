/**
 * WalletSetupSheet — guida l'utente a configurare il wallet USDA.
 * Mostrato quando l'utente tenta di inviare USDA senza wallet configurato.
 */

import { useState } from "react";
import { apiUsdaSetWalletAddress } from "../../lib/usda-api";
import type { WalletInfo } from "../../lib/usda-types";

interface Props {
  onClose: () => void;
  onSetup: (wallet: WalletInfo) => void;
}

export function WalletSetupSheet({ onClose, onSetup }: Props) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!address.trim()) {
      setError("Inserisci un indirizzo wallet valido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const wallet = await apiUsdaSetWalletAddress(address.trim());
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
          <span className="usda-sheet-title">🔗 Configura Wallet USDA</span>
          <button className="usda-sheet-close" onClick={onClose}>✕</button>
        </div>

        <p className="usda-wallet-desc">
          Per inviare e ricevere USDA collega il tuo indirizzo wallet (Polygon).
        </p>

        <div className="usda-sheet-field">
          <label>Indirizzo wallet</label>
          <input
            className="usda-note-input"
            type="text"
            placeholder="0x…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
          />
        </div>

        <div className="usda-wallet-hint">
          💡 In futuro potrai collegare il wallet con un clic tramite ThirdWeb Connect.
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
