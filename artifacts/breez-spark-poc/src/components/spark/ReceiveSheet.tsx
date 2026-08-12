/**
 * SPARK — RECEIVE SHEET
 * BOLT11 invoice + Spark address + QR + copia
 * BOLT12 receive: NON supportato in SDK v0.15.1 — esplicitamente disabilitato.
 */

import { useState } from 'react';
import { useBreezSpark } from '../../contexts/BreezSparkContext';
import type { ReceiveMethod, ReceiveResponse } from '../../lib/breez-spark/types';

const METHOD_INFO: Record<ReceiveMethod, { label: string; desc: string }> = {
  bolt11Invoice: { label: 'BOLT11 Invoice', desc: 'Compatibile con qualsiasi wallet Lightning' },
  sparkAddress:  { label: 'Spark Address',  desc: 'Zero fee tra wallet Spark (più economico)' },
};

export function ReceiveSheet() {
  const { receive, isMockMode, isConnected } = useBreezSpark();
  const [method, setMethod] = useState<ReceiveMethod>('bolt11Invoice');
  const [amountSats, setAmountSats] = useState('1000');
  const [description, setDescription] = useState('Alpha Chat payment');
  const [result, setResult] = useState<ReceiveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReceive = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await receive({
        method,
        amountSats: method === 'bolt11Invoice' ? parseInt(amountSats) : undefined,
        description: method === 'bolt11Invoice' ? description : undefined,
        expirySecs: 3600,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* ignora */ }
  };

  if (!isConnected) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>⬇️ Ricevi Lightning / Spark</h2>
        <div style={{ color: 'hsl(215 16% 45%)', fontSize: 12 }}>Connetti prima il wallet Spark.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>⬇️ Ricevi Lightning / Spark</h2>
        {isMockMode && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'hsl(250 70% 15%)', color: 'hsl(250 70% 75%)' }}>MOCK</span>}
      </div>

      {/* BOLT12 notice */}
      <div style={{ background: 'hsl(33 80% 8%)', border: '1px solid hsl(33 80% 25%)', borderRadius: 6, padding: '6px 10px', marginBottom: 12, fontSize: 10, color: 'hsl(33 80% 65%)' }}>
        ⚠️ BOLT12 receive: <strong>non supportato</strong> in SDK v0.15.1 — ReceivePaymentMethod non include bolt12.
        Solo BOLT11 e Spark address disponibili per ricevere.
      </div>

      {/* Method selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(Object.entries(METHOD_INFO) as [ReceiveMethod, typeof METHOD_INFO[ReceiveMethod]][]).map(([m, info]) => (
          <button
            key={m}
            onClick={() => { setMethod(m); setResult(null); }}
            style={{
              flex: 1, padding: '8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              border: `1px solid ${method === m ? 'hsl(33 100% 55%)' : 'hsl(215 20% 22%)'}`,
              background: method === m ? 'hsl(33 100% 8%)' : 'transparent',
              color: method === m ? 'hsl(33 100% 65%)' : 'hsl(215 16% 55%)',
            }}
          >
            <div style={{ fontWeight: 700 }}>{info.label}</div>
            <div style={{ fontSize: 9, marginTop: 2 }}>{info.desc}</div>
          </button>
        ))}
      </div>

      {/* Amount (bolt11 only) */}
      {method === 'bolt11Invoice' && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: 'hsl(215 16% 55%)', display: 'block', marginBottom: 4 }}>Importo (satoshi)</label>
          <input type="number" value={amountSats} onChange={e => setAmountSats(e.target.value)} min={1}
            style={{ width: '100%', background: 'hsl(215 28% 10%)', border: '1px solid hsl(215 20% 22%)', borderRadius: 6, color: 'hsl(215 16% 80%)', fontSize: 12, padding: 8, boxSizing: 'border-box' }} />
          <label style={{ fontSize: 11, color: 'hsl(215 16% 55%)', display: 'block', margin: '8px 0 4px' }}>Descrizione</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            style={{ width: '100%', background: 'hsl(215 28% 10%)', border: '1px solid hsl(215 20% 22%)', borderRadius: 6, color: 'hsl(215 16% 80%)', fontSize: 12, padding: 8, boxSizing: 'border-box' }} />
        </div>
      )}

      {error && <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 10 }}>{error}</div>}

      {!result && (
        <button className="btn-primary" style={{ width: '100%' }} onClick={handleReceive} disabled={loading}>
          {loading ? <><span className="spinner" /> Generazione...</> : 'Genera →'}
        </button>
      )}

      {/* Result */}
      {result && (
        <div>
          {/* QR placeholder (text-based) */}
          <div style={{
            background: '#fff', color: '#000', borderRadius: 8, padding: 16,
            textAlign: 'center', marginBottom: 12, fontSize: 9, fontFamily: 'monospace',
            wordBreak: 'break-all', lineHeight: 1.3,
          }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>📱 QR</div>
            {result.paymentRequest.slice(0, 40)}...
            <div style={{ fontSize: 8, color: '#666', marginTop: 4 }}>(In produzione: QR renderizzato con react-qr-code)</div>
          </div>

          {/* Invoice text */}
          <div className="code-block" style={{ fontSize: 10, wordBreak: 'break-all', marginBottom: 10, maxHeight: 80, overflow: 'hidden' }}>
            {result.paymentRequest}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => copyToClipboard(result.paymentRequest)}
              style={{ flex: 1, padding: '8px', borderRadius: 6, cursor: 'pointer', border: '1px solid hsl(142 70% 35%)', background: 'hsl(142 70% 8%)', color: 'hsl(142 70% 60%)', fontSize: 12 }}
            >
              {copied ? '✅ Copiato' : '📋 Copia'}
            </button>
            <button onClick={() => setResult(null)} style={{ flex: 1, padding: '8px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid hsl(215 20% 25%)', color: 'hsl(215 16% 55%)', fontSize: 12 }}>
              Nuovo
            </button>
          </div>

          <div style={{ fontSize: 10, color: 'hsl(215 16% 40%)', marginTop: 8 }}>
            Fee ricezione: {result.feeSats.toString()} sat · Metodo: {result.method}
            {isMockMode && ' · 🎭 Invoice mock — nessun pagamento reale'}
          </div>
        </div>
      )}
    </div>
  );
}
