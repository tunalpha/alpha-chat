/**
 * UsdaWalletCard — card "👛 Wallet USDA" nel profilo utente.
 */

import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { useWs } from "../../contexts/WebSocketContext";
import { client, polygon, wallets, appMetadata } from "../../lib/thirdweb";

export interface UsdaWalletCardProps {
  onSend:    () => void;
  onRequest: () => void;
  onManage:  () => void;
}

export function UsdaWalletCard({ onManage }: UsdaWalletCardProps) {
  useWs();
  const account = useActiveAccount();
  const address = account?.address;

  return (
    <div className="uwc-card" aria-label="Wallet USDA">
      <div className="uwc-header">
        <div className="uwc-title-row">
          <span className="uwc-title-icon" aria-hidden="true">👛</span>
          <span className="uwc-title">Wallet USDA</span>
        </div>
      </div>

      {address ? (
        <div className="uwc-connected">
          <div className="uwc-status-badge uwc-status-badge--ok">
            <span className="uwc-status-dot" aria-hidden="true" />
            Wallet collegato
          </div>
          <p className="uwc-addr">{address.slice(0, 6)}…{address.slice(-4)}</p>
          <div className="uwc-connect-wrap">
            <ConnectButton
              client={client}
              chain={polygon}
              wallets={wallets}
              appMetadata={appMetadata}
            />
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
      ) : (
        <div className="uwc-disconnected">
          <div className="uwc-status-badge uwc-status-badge--warn">
            <span className="uwc-status-dot" aria-hidden="true" />
            Wallet non collegato
          </div>
          <p className="uwc-disconnect-msg">
            Per utilizzare USDA collega il tuo Wallet Polygon.
          </p>
          <div className="uwc-connect-wrap">
            <ConnectButton
              client={client}
              chain={polygon}
              wallets={wallets}
              appMetadata={appMetadata}
            />
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
      )}
    </div>
  );
}
