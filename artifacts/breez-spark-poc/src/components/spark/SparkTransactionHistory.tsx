/**
 * SPARK — TRANSACTION HISTORY
 *
 * Tipi transazione separati da BTC on-chain:
 *   btc_lightning_sent / btc_lightning_received  — Lightning BOLT11/BOLT12
 *   spark_sent / spark_received                  — Spark-to-Spark
 *
 * NON modifica lo storico production BTC esistente (btc_sent / btc_received).
 */

import { useState, useEffect } from 'react';
import { useBreezSpark } from '../../contexts/BreezSparkContext';
import type { SparkPayment, SparkTxType } from '../../lib/breez-spark/types';

const TX_DISPLAY: Record<SparkTxType, { icon: string; label: string; color: string }> = {
  btc_lightning_sent:     { icon: '⬆️⚡', label: 'Lightning inviato',    color: '#ef4444' },
  btc_lightning_received: { icon: '⬇️⚡', label: 'Lightning ricevuto',   color: '#22c55e' },
  spark_sent:             { icon: '⬆️✨', label: 'Spark inviato',        color: '#f97316' },
  spark_received:         { icon: '⬇️✨', label: 'Spark ricevuto',       color: '#60a5fa' },
};

function satsToDisplay(sats: bigint): string {
  if (sats < 1000n) return `${sats} sat`;
  return `${(Number(sats) / 1000).toFixed(1)} ksat`;
}

export function SparkTransactionHistory() {
  const { listPayments, isConnected, isMockMode } = useBreezSpark();
  const [payments, setPayments] = useState<SparkPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  useEffect(() => {
    if (!isConnected) return;
    void loadPayments();
  }, [isConnected]);

  const loadPayments = async () => {
    setLoading(true);
    try {
      const req = filter === 'all' ? {} :
                  filter === 'sent' ? { typeFilter: ['sent' as const] } :
                  { typeFilter: ['received' as const] };
      const result = await listPayments(req);
      setPayments(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isConnected) void loadPayments(); }, [filter, isConnected]);

  if (!isConnected) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>📋 Storico Lightning / Spark</h2>
        <div style={{ color: 'hsl(215 16% 45%)', fontSize: 12 }}>Connetti prima il wallet Spark.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📋 Storico Lightning / Spark</h2>
        {isMockMode && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'hsl(250 70% 15%)', color: 'hsl(250 70% 75%)' }}>MOCK</span>}
      </div>

      {/* Tipo separazione nota */}
      <div style={{ fontSize: 10, color: 'hsl(215 16% 35%)', marginBottom: 10, lineHeight: 1.6 }}>
        Tipi distinti da BTC on-chain (btc_sent/btc_received) — non modificano lo storico production esistente.
        <br />⚡ = Lightning (BOLT11) · ✨ = Spark-to-Spark
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['all', 'sent', 'received'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
            border: `1px solid ${filter === f ? 'hsl(33 100% 55%)' : 'hsl(215 20% 22%)'}`,
            background: filter === f ? 'hsl(33 100% 8%)' : 'transparent',
            color: filter === f ? 'hsl(33 100% 65%)' : 'hsl(215 16% 55%)',
          }}>
            {f === 'all' ? 'Tutti' : f === 'sent' ? '⬆️ Inviati' : '⬇️ Ricevuti'}
          </button>
        ))}
        <button onClick={loadPayments} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, background: 'transparent', border: '1px solid hsl(215 20% 22%)', color: 'hsl(215 16% 55%)' }}>
          🔄
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: 'hsl(215 16% 45%)', fontSize: 12 }}>
          <span className="spinner" /> Caricamento...
        </div>
      ) : payments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'hsl(215 16% 35%)', fontSize: 12 }}>
          Nessun pagamento Lightning/Spark.
          {isMockMode && <div style={{ marginTop: 6, fontSize: 10 }}>Eseguire un pagamento mock per vedere la cronologia.</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {payments.map(p => {
            const display = TX_DISPLAY[p.type];
            const isSent = p.type.endsWith('_sent');
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'hsl(215 28% 8%)', borderRadius: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{display.icon}</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: display.color }}>{display.label}</div>
                    <div style={{ fontSize: 9, color: 'hsl(215 16% 40%)', fontFamily: 'monospace' }}>
                      {p.id.slice(0, 20)}... · {new Date(p.timestamp * 1000).toLocaleString()}
                    </div>
                    {p.description && (
                      <div style={{ fontSize: 10, color: 'hsl(215 16% 50%)' }}>{p.description}</div>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isSent ? '#ef4444' : '#22c55e' }}>
                    {isSent ? '-' : '+'}{satsToDisplay(p.amountSats)}
                  </div>
                  {p.feeSats > 0n && (
                    <div style={{ fontSize: 9, color: 'hsl(215 16% 40%)' }}>fee: {p.feeSats.toString()} sat</div>
                  )}
                  <div style={{ fontSize: 9, color: p.status === 'complete' ? '#22c55e' : p.status === 'failed' ? '#ef4444' : '#f59e0b' }}>
                    {p.status}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
