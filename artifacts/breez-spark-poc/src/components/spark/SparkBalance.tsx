/**
 * SPARK — BALANCE + PORTFOLIO STRUCTURE
 *
 * Struttura portfolio separata da BTC on-chain:
 *
 *   Bitcoin
 *    ├── On-chain  (btc)              — esistente, NON modificato
 *    └── ⚡ Lightning / Spark         — nuovo layer
 *         ├── btc_lightning (BOLT11)
 *         └── spark (Spark-to-Spark)
 *
 * NON sommare automaticamente btc + btc_lightning senza distinzione visiva.
 */

import { useBreezSpark } from '../../contexts/BreezSparkContext';
import { SPARK_PORTFOLIO_TYPES } from '../../lib/breez-spark/constants';

function satsToDisplay(sats: bigint): string {
  if (sats === 0n) return '0 sat';
  if (sats < 1000n) return `${sats} sat`;
  if (sats < 1_000_000n) return `${(Number(sats) / 1000).toFixed(3)} ksat`;
  return `${(Number(sats) / 100_000_000).toFixed(8)} BTC`;
}

function satsToBtc(sats: bigint): string {
  return `${(Number(sats) / 100_000_000).toFixed(8)} BTC`;
}

export function SparkBalance() {
  const { state, isConnected } = useBreezSpark();

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>₿ Portfolio</h2>

      {/* BTC on-chain — placeholder solo documentativo */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'hsl(215 16% 40%)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Bitcoin
        </div>

        <div style={{ background: 'hsl(215 28% 8%)', borderRadius: 8, overflow: 'hidden' }}>
          {/* On-chain row */}
          <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>On-chain</div>
              <div style={{ fontSize: 10, color: 'hsl(215 16% 45%)' }}>
                {SPARK_PORTFOLIO_TYPES.BTC_ONCHAIN} · BIP84 m/84'/0'/0'/0/n
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'hsl(215 16% 55%)' }}>
                (dal WalletContext esistente)
              </div>
              <div style={{ fontSize: 10, color: 'hsl(215 16% 35%)' }}>NON modificato</div>
            </div>
          </div>

          <div style={{ height: 1, background: 'hsl(215 20% 14%)' }} />

          {/* Lightning row */}
          <div style={{
            padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: isConnected ? 'hsl(215 28% 9%)' : 'transparent',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                ⚡ Lightning / Spark
              </div>
              <div style={{ fontSize: 10, color: 'hsl(215 16% 45%)' }}>
                {SPARK_PORTFOLIO_TYPES.BTC_LIGHTNING} + {SPARK_PORTFOLIO_TYPES.SPARK}
              </div>
              <div style={{ fontSize: 9, color: 'hsl(215 16% 35%)', marginTop: 2 }}>
                m/8797555'/1'/0' (identity) · separato da on-chain
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {isConnected && state.balance ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'hsl(33 100% 65%)' }}>
                    {satsToDisplay(state.balance.totalSats)}
                  </div>
                  <div style={{ fontSize: 10, color: 'hsl(215 16% 45%)' }}>
                    {satsToBtc(state.balance.totalSats)}
                  </div>
                  {state.balance.pendingSats > 0n && (
                    <div style={{ fontSize: 9, color: 'hsl(33 80% 55%)' }}>
                      + {satsToDisplay(state.balance.pendingSats)} pending
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'hsl(215 16% 35%)' }}>
                  {isConnected ? '⏳ Caricamento...' : 'Non connesso'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Note: non sommare */}
        <div style={{ fontSize: 10, color: 'hsl(215 16% 35%)', marginTop: 6, fontStyle: 'italic' }}>
          ⚠️ I saldi on-chain e Lightning NON vengono sommati automaticamente.
          Visualizzazione separata per chiarezza e sicurezza.
        </div>
      </div>

      {/* Connection required */}
      {!isConnected && (
        <div style={{ fontSize: 11, color: 'hsl(215 16% 40%)', textAlign: 'center', padding: '8px 0' }}>
          Connetti il wallet Spark per vedere il saldo Lightning
        </div>
      )}

      {/* Spark info if connected */}
      {isConnected && state.info && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'hsl(215 28% 7%)', borderRadius: 6, fontSize: 10 }}>
          <div style={{ color: 'hsl(215 16% 40%)', marginBottom: 4 }}>Spark Address:</div>
          <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'hsl(215 16% 70%)' }}>
            {state.info.sparkAddress}
          </div>
          <div style={{ color: 'hsl(215 16% 40%)', marginTop: 6, marginBottom: 4 }}>Network:</div>
          <div style={{ color: 'hsl(142 70% 60%)' }}>{state.info.network}</div>
        </div>
      )}

      {/* Mock mode disclaimer */}
      {state.adapterType === 'mock' && (
        <div style={{ marginTop: 12, padding: '6px 10px', background: 'hsl(250 70% 8%)', border: '1px solid hsl(250 70% 25%)', borderRadius: 6, fontSize: 10, color: 'hsl(250 70% 65%)' }}>
          🎭 MockAdapter — saldi simulati · nessun fondo reale · PENDING API KEY per saldi reali
        </div>
      )}
    </div>
  );
}
