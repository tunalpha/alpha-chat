import { useState } from 'react';
import './index.css';
import SparkPoC from './pages/SparkPoC';
import SparkArchDemo from './pages/SparkArchDemo';

// ─── PoC Isolato — Breez SDK Spark WASM ────────────────────────────────────
// NON collegato ad Alpha Wallet. Solo test tecnico e architettura pre-API-key.
// ───────────────────────────────────────────────────────────────────────────

type View = 'poc' | 'arch';

export default function App() {
  const [view, setView] = useState<View>('arch');

  return (
    <div>
      {/* Nav */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'hsl(215 28% 7%)',
        borderBottom: '1px solid hsl(215 20% 16%)',
        padding: '6px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13, color: 'hsl(33 100% 55%)', fontWeight: 700, marginRight: 8 }}>⚡ Breez Spark PoC</span>
        {([
          { id: 'arch', label: '🏗️ Architettura' },
          { id: 'poc',  label: '🧪 Test Runner' },
        ] as { id: View; label: string }[]).map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            style={{
              padding: '4px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: view === v.id ? 700 : 400,
              border: `1px solid ${view === v.id ? 'hsl(33 100% 55%)' : 'hsl(215 20% 22%)'}`,
              background: view === v.id ? 'hsl(33 100% 10%)' : 'transparent',
              color: view === v.id ? 'hsl(33 100% 65%)' : 'hsl(215 16% 55%)',
            }}
          >
            {v.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'hsl(215 16% 35%)' }}>
          ISOLATO DA ALPHA WALLET · @breeztech/breez-sdk-spark@0.15.1
        </span>
      </div>

      {view === 'arch' ? <SparkArchDemo /> : <SparkPoC />}
    </div>
  );
}
