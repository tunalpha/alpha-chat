/**
 * SPARK — SEND SHEET
 * Flusso: parse → prepare (fee) → conferma → send
 * MockAdapter: nessun pagamento reale.
 * Fee Alpha (0.10%) sempre mostrata separatamente dalla fee Spark (TBD).
 */

import { useState } from 'react';
import { useBreezSpark } from '../../contexts/BreezSparkContext';
import type { PrepareSendResponse } from '../../lib/breez-spark/types';
import { ALPHA_FEE_DISPLAY } from '../../lib/breez-spark/fee-model';

type SendStep = 'input' | 'preparing' | 'confirm' | 'sending' | 'done' | 'error';

export function SendSheet() {
  const { prepareSend, send, isMockMode, isConnected } = useBreezSpark();
  const [step, setStep] = useState<SendStep>('input');
  const [input, setInput] = useState('');
  const [amountSats, setAmountSats] = useState('1000');
  const [prepared, setPrepared] = useState<PrepareSendResponse | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePrepare = async () => {
    if (!input.trim()) { setError('Inserire un invoice, Lightning Address o Spark address'); return; }
    setError(null);
    setStep('preparing');
    try {
      const res = await prepareSend({
        paymentRequest: input.trim(),
        feePolicy: 'feesExcluded',
        amountSats: BigInt(amountSats || '1000'),
      });
      if (!res) throw new Error('prepareSend ha restituito null');
      setPrepared(res);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('input');
    }
  };

  const handleSend = async () => {
    if (!prepared) return;
    setStep('sending');
    try {
      const res = await send({ prepareResponse: prepared });
      if (!res) throw new Error('send ha restituito null');
      setResult(`✅ Pagamento completato — ID: ${res.paymentId}`);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  };

  const reset = () => { setStep('input'); setPrepared(null); setResult(null); setError(null); };

  if (!isConnected) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>⬆️ Invia Lightning / Spark</h2>
        <div style={{ color: 'hsl(215 16% 45%)', fontSize: 12 }}>Connetti prima il wallet Spark.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>⬆️ Invia Lightning / Spark</h2>
        {isMockMode && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'hsl(250 70% 15%)', color: 'hsl(250 70% 75%)' }}>MOCK</span>}
      </div>

      {/* Step: INPUT */}
      {step === 'input' && (
        <div>
          <div style={{ fontSize: 11, color: 'hsl(215 16% 55%)', marginBottom: 6 }}>
            Supportato: BOLT11 · BOLT12 (send) · Lightning Address · LNURL-Pay · BIP353 · Spark address
          </div>
          <div style={{ fontSize: 10, color: 'hsl(215 16% 35%)', marginBottom: 10 }}>
            ⚠️ BOLT12 receive non supportato nell'SDK v0.15.1 · Solo invio BOLT12 disponibile
          </div>

          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="lnbc... · lno... · user@domain.com · sprt1..."
            style={{
              width: '100%', background: 'hsl(215 28% 10%)', border: '1px solid hsl(215 20% 22%)',
              borderRadius: 6, color: 'hsl(215 16% 80%)', fontSize: 12, padding: 8,
              boxSizing: 'border-box', fontFamily: 'monospace',
            }}
          />

          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: 'hsl(215 16% 55%)', display: 'block', marginBottom: 4 }}>
              Importo (satoshi) — usato se non incluso nell'invoice
            </label>
            <input
              type="number"
              value={amountSats}
              onChange={e => setAmountSats(e.target.value)}
              min={1}
              style={{
                width: '100%', background: 'hsl(215 28% 10%)', border: '1px solid hsl(215 20% 22%)',
                borderRadius: 6, color: 'hsl(215 16% 80%)', fontSize: 12, padding: 8,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>{error}</div>}

          <button className="btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={handlePrepare}>
            Calcola fee →
          </button>
        </div>
      )}

      {/* Step: PREPARING */}
      {step === 'preparing' && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'hsl(215 16% 55%)', fontSize: 12 }}>
          <span className="spinner" /> Calcolo fee in corso...
        </div>
      )}

      {/* Step: CONFIRM */}
      {step === 'confirm' && prepared && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'hsl(33 100% 65%)' }}>
            Conferma pagamento
          </div>

          <div style={{ background: 'hsl(215 28% 8%)', borderRadius: 8, padding: 12, fontSize: 11, lineHeight: 2 }}>
            <FeeRow label="Destinatario riceve" value={`${prepared.recipientSats.toLocaleString()} sat`} highlight />
            <FeeRow label={`Alpha fee (${ALPHA_FEE_DISPLAY})`} value={`${prepared.alphaFeeSats.toLocaleString()} sat`} />
            <FeeRow
              label="Fee Spark/Lightning"
              value={prepared.networkFeeSats === 0n ? 'TBD (in attesa Breez)' : `${prepared.networkFeeSats.toLocaleString()} sat`}
              warn={prepared.networkFeeSats === 0n}
            />
            <div style={{ borderTop: '1px solid hsl(215 20% 20%)', marginTop: 6, paddingTop: 6 }}>
              <FeeRow label="Totale mittente paga" value={`${prepared.totalSenderSats.toLocaleString()} sat`} highlight />
            </div>
          </div>

          <div style={{ fontSize: 10, color: 'hsl(215 16% 40%)', marginTop: 8 }}>
            Modalità: feesExcluded (recipient_exact) · Tipo: {prepared.sendMethod}
            {isMockMode && ' · 🎭 MockAdapter — nessun pagamento reale'}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={reset} style={{ flex: 1, padding: '8px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid hsl(215 20% 25%)', color: 'hsl(215 16% 55%)', fontSize: 12 }}>
              Annulla
            </button>
            <button className="btn-primary" style={{ flex: 2 }} onClick={handleSend}>
              {isMockMode ? '🎭 Invia (Mock)' : '⚡ Invia'}
            </button>
          </div>
        </div>
      )}

      {/* Step: SENDING */}
      {step === 'sending' && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'hsl(215 16% 55%)', fontSize: 12 }}>
          <span className="spinner" /> Invio in corso...
        </div>
      )}

      {/* Step: DONE */}
      {step === 'done' && (
        <div>
          <div style={{ color: '#22c55e', fontSize: 12, marginBottom: 10 }}>{result}</div>
          <button className="btn-primary" style={{ width: '100%' }} onClick={reset}>Nuovo pagamento</button>
        </div>
      )}

      {/* Step: ERROR */}
      {step === 'error' && (
        <div>
          <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>❌ {error}</div>
          <button className="btn-primary" style={{ width: '100%' }} onClick={reset}>Riprova</button>
        </div>
      )}
    </div>
  );
}

function FeeRow({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'hsl(215 16% 55%)' }}>{label}</span>
      <span style={{ color: warn ? 'hsl(33 100% 65%)' : highlight ? 'hsl(142 70% 60%)' : 'hsl(215 16% 80%)', fontWeight: highlight ? 700 : 400 }}>
        {value}
      </span>
    </div>
  );
}
