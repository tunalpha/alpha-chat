/**
 * SPARK — CONNECT PANEL
 * Gestisce la UI della connessione Spark.
 * MockAdapter attivo quando API key assente.
 */

import { useState } from 'react';
import { useBreezSpark } from '../../contexts/BreezSparkContext';
import { isApiKeyConfigured, SPARK_DERIVATION } from '../../lib/breez-spark/constants';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const STATE_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  disconnected: { icon: '⚫', label: 'Disconnesso', color: '#6b7280' },
  connecting:   { icon: '🔄', label: 'Connessione...', color: '#f59e0b' },
  connected:    { icon: '🟢', label: 'Connesso', color: '#22c55e' },
  syncing:      { icon: '🔄', label: 'Sincronizzazione...', color: '#60a5fa' },
  unavailable:  { icon: '🔑', label: 'API Key richiesta', color: '#f97316' },
  error:        { icon: '❌', label: 'Errore', color: '#ef4444' },
};

export function ConnectPanel() {
  const { state, connect, disconnect, sync } = useBreezSpark();
  const [mnemonic, setMnemonic] = useState(TEST_MNEMONIC);
  const [network, setNetwork] = useState<'mainnet' | 'regtest'>('mainnet');
  const apiKeyOk = isApiKeyConfigured();
  const cs = state.connectionState;
  const stateInfo = STATE_LABELS[cs] ?? STATE_LABELS['disconnected'];

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>⚡ Connessione Spark</h2>
        <span style={{ color: stateInfo.color, fontWeight: 700, fontSize: 12 }}>
          {stateInfo.icon} {stateInfo.label}
        </span>
      </div>

      {/* API Key status */}
      <div style={{
        background: apiKeyOk ? 'hsl(142 70% 6%)' : 'hsl(25 80% 8%)',
        border: `1px solid ${apiKeyOk ? 'hsl(142 70% 25%)' : 'hsl(25 80% 30%)'}`,
        borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 11,
      }}>
        {apiKeyOk
          ? <span style={{ color: 'hsl(142 70% 60%)' }}>🔑 VITE_BREEZ_API_KEY configurata — LiveBreezAdapter attivo</span>
          : <span style={{ color: 'hsl(25 80% 65%)' }}>
              🟡 VITE_BREEZ_API_KEY assente — <strong>MockBreezAdapter attivo</strong> (nessun pagamento reale)
              <br /><span style={{ color: 'hsl(215 16% 55%)' }}>Richiedere API key: breez.technology/request-api-key</span>
            </span>
        }
      </div>

      {/* Adapter indicator */}
      {state.adapterType && (
        <div style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
          background: state.adapterType === 'mock' ? 'hsl(250 70% 15%)' : 'hsl(142 70% 8%)',
          color: state.adapterType === 'mock' ? 'hsl(250 70% 75%)' : 'hsl(142 70% 60%)',
          fontSize: 10, fontWeight: 700, marginBottom: 12,
        }}>
          {state.adapterType === 'mock' ? '🎭 MockBreezAdapter' : '⚡ LiveBreezAdapter'}
        </div>
      )}

      {/* Mnemonic input */}
      {cs === 'disconnected' || cs === 'error' ? (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'hsl(215 16% 55%)', display: 'block', marginBottom: 4 }}>
            Mnemonic BIP39 (test vector — nessun fondo reale)
          </label>
          <textarea
            value={mnemonic}
            onChange={e => setMnemonic(e.target.value)}
            rows={2}
            style={{
              width: '100%', background: 'hsl(215 28% 10%)',
              border: '1px solid hsl(215 20% 22%)', borderRadius: 6,
              color: 'hsl(215 16% 80%)', fontSize: 11, padding: 8, boxSizing: 'border-box',
              fontFamily: 'monospace', resize: 'vertical',
            }}
          />
          <div style={{ fontSize: 10, color: 'hsl(215 16% 40%)', marginTop: 4 }}>
            Seed path Spark (mainnet): {SPARK_DERIVATION.FULL_PATHS.identity} — diverso da BTC on-chain m/84'/0'/0'/0/n
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: 'hsl(215 16% 55%)' }}>Network:</label>
            {(['mainnet', 'regtest'] as const).map(n => (
              <button
                key={n}
                onClick={() => setNetwork(n)}
                style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  border: `1px solid ${network === n ? 'hsl(33 100% 55%)' : 'hsl(215 20% 22%)'}`,
                  background: network === n ? 'hsl(33 100% 10%)' : 'transparent',
                  color: network === n ? 'hsl(33 100% 65%)' : 'hsl(215 16% 55%)',
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            className="btn-primary"
            style={{ marginTop: 12, width: '100%' }}
            onClick={() => connect(mnemonic.trim(), network)}
          >
            Connetti {apiKeyOk ? '(Live)' : '(Mock)'}
          </button>
        </div>
      ) : null}

      {/* Error */}
      {cs === 'error' && state.error && (
        <div style={{
          background: 'hsl(0 60% 8%)', border: '1px solid hsl(0 60% 25%)',
          borderRadius: 6, padding: 10, fontSize: 11, marginBottom: 12,
        }}>
          <div style={{ color: '#ef4444', fontWeight: 700 }}>❌ {state.error.code}</div>
          <div style={{ color: 'hsl(215 16% 65%)', marginTop: 4 }}>{state.error.message}</div>
          {state.error.code === 'API_KEY_MISSING' && (
            <div style={{ color: 'hsl(33 100% 65%)', marginTop: 6, fontSize: 10 }}>
              → Aggiungere VITE_BREEZ_API_KEY come secret Replit e ricaricare
            </div>
          )}
        </div>
      )}

      {/* Connected info */}
      {(cs === 'connected' || cs === 'syncing') && state.info && (
        <div style={{ fontSize: 11, lineHeight: 1.8 }}>
          <div style={{ color: 'hsl(215 16% 55%)' }}>Identity pubkey (Spark):</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', color: 'hsl(215 16% 80%)' }}>
            {state.info.identityPubkey}
          </div>
          <div style={{ marginTop: 8, color: 'hsl(215 16% 55%)' }}>Spark address:</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', color: 'hsl(215 16% 80%)' }}>
            {state.info.sparkAddress}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={sync} disabled={cs === 'syncing'}>
              {cs === 'syncing' ? '⏳ Syncing...' : '🔄 Sync'}
            </button>
            <button
              onClick={disconnect}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: '1px solid hsl(0 60% 35%)',
                color: 'hsl(0 60% 65%)', fontSize: 12,
              }}
            >
              Disconnetti
            </button>
          </div>
          {state.lastSynced && (
            <div style={{ fontSize: 10, color: 'hsl(215 16% 40%)', marginTop: 6 }}>
              Ultimo sync: {new Date(state.lastSynced).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
