/**
 * UsdaWalletCard — card "👛 Wallet USDA" nel profilo utente.
 *
 * Wallet non ancora integrato: mostra lo stato "non collegato"
 * fino a quando la nuova integrazione wallet sarà disponibile.
 */

import { useWs } from "../../contexts/WebSocketContext";
import { walletModal } from "../../lib/wallet-stub";

export interface UsdaWalletCardProps {
  onSend:    () => void;
  onRequest: () => void;
  onManage:  () => void;
}

export function UsdaWalletCard({ onManage }: UsdaWalletCardProps) {
  // Ignoriamo on() — nessun wallet collegato, nessun aggiornamento saldo
  useWs();

  return (
    <div className="uwc-card" aria-label="Wallet USDA">
      <div className="uwc-header">
        <div className="uwc-title-row">
          <span className="uwc-title-icon" aria-hidden="true">👛</span>
          <span className="uwc-title">Wallet USDA</span>
        </div>
      </div>

      <div className="uwc-disconnected">
        <div className="uwc-status-badge uwc-status-badge--warn">
          <span className="uwc-status-dot" aria-hidden="true" />
          Wallet non collegato
        </div>
        <p className="uwc-disconnect-msg">
          Per utilizzare USDA collega il tuo Wallet Polygon.
        </p>
        <div className="uwc-connect-wrap">
          <button
            type="button"
            className="uwc-connect-btn"
            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            onClick={() => walletModal.open()}
          >
            🔗 Collega Wallet
          </button>
          <button
            type="button"
            className="uwc-connect-btn"
            style={{ marginTop: 8, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            onClick={onManage}
          >
            ⚙️ Gestisci USDA
          </button>
        </div>
      </div>
    </div>
  );
}
