/**
 * SPARK ARCH DEMO — Architettura Pre-API-Key
 *
 * Dimostra l'intera architettura Breez Spark isolata:
 * - BreezSparkContext + MockAdapter (senza API key)
 * - Connect / Disconnect / Sync state machine
 * - Send flow (prepare → fee → confirm)
 * - Receive (BOLT11 / Spark address)
 * - Portfolio (btc / btc_lightning / spark separati)
 * - Transaction history (nuovi tipi)
 * - Security checklist
 * - Test checklist (PASS / PENDING API KEY / ...)
 *
 * NESSUNA MODIFICA AD ALPHA WALLET.
 * NESSUNA TRANSAZIONE REALE.
 */

import { useState } from 'react';
import { BreezSparkProvider } from '../contexts/BreezSparkContext';
import { ConnectPanel } from '../components/spark/ConnectPanel';
import { SendSheet } from '../components/spark/SendSheet';
import { ReceiveSheet } from '../components/spark/ReceiveSheet';
import { SparkBalance } from '../components/spark/SparkBalance';
import { SparkTransactionHistory } from '../components/spark/SparkTransactionHistory';
import { SecurityChecklist } from '../components/spark/SecurityChecklist';
import { TestChecklist } from '../components/spark/TestChecklist';
import { isApiKeyConfigured } from '../lib/breez-spark/constants';

type Tab = 'connect' | 'send' | 'receive' | 'portfolio' | 'history' | 'security' | 'tests';

const TABS: { id: Tab; label: string }[] = [
  { id: 'connect',   label: '⚡ Connect' },
  { id: 'send',      label: '⬆️ Send' },
  { id: 'receive',   label: '⬇️ Receive' },
  { id: 'portfolio', label: '₿ Portfolio' },
  { id: 'history',   label: '📋 History' },
  { id: 'security',  label: '🔒 Security' },
  { id: 'tests',     label: '✅ Tests' },
];

function SparkArchDemoInner() {
  const [tab, setTab] = useState<Tab>('connect');
  const apiKeyOk = isApiKeyConfigured();

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22 }}>⚡</span>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'hsl(33 100% 55%)' }}>
            Breez SDK Spark — Architettura Pre-API-Key
          </h1>
          <span style={{ background: 'hsl(250 70% 20%)', color: 'hsl(250 70% 75%)', border: '1px solid hsl(250 70% 40%)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
            ISOLATO DA ALPHA WALLET
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: 'hsl(215 16% 55%)', lineHeight: 1.6 }}>
          Architettura completa con {apiKeyOk ? <span style={{ color: 'hsl(142 70% 60%)' }}>LiveBreezAdapter (API key configurata)</span> : <span style={{ color: 'hsl(33 100% 65%)' }}>MockBreezAdapter attivo</span>}.
          {' '}Nessuna transazione reale. Nessuna modifica ad Alpha Wallet, BTC on-chain, EVM, USDA.
        </p>
      </div>

      {/* API Key status bar */}
      <div style={{
        padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 11,
        background: apiKeyOk ? 'hsl(142 70% 6%)' : 'hsl(33 80% 6%)',
        border: `1px solid ${apiKeyOk ? 'hsl(142 70% 20%)' : 'hsl(33 80% 25%)'}`,
        color: apiKeyOk ? 'hsl(142 70% 60%)' : 'hsl(33 80% 65%)',
      }}>
        {apiKeyOk
          ? '🔑 VITE_BREEZ_API_KEY configurata → LiveBreezAdapter disponibile → connect() su mainnet possibile'
          : <>🟡 VITE_BREEZ_API_KEY assente → <strong>MockBreezAdapter</strong> · connect() Mainnet: <strong>PENDING API KEY</strong> · Richiesta inviata a Breez</>
        }
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: tab === t.id ? 700 : 400,
              border: `1px solid ${tab === t.id ? 'hsl(33 100% 55%)' : 'hsl(215 20% 22%)'}`,
              background: tab === t.id ? 'hsl(33 100% 10%)' : 'transparent',
              color: tab === t.id ? 'hsl(33 100% 65%)' : 'hsl(215 16% 55%)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'connect'   && <ConnectPanel />}
      {tab === 'send'      && <SendSheet />}
      {tab === 'receive'   && <ReceiveSheet />}
      {tab === 'portfolio' && <SparkBalance />}
      {tab === 'history'   && <SparkTransactionHistory />}
      {tab === 'security'  && <SecurityChecklist />}
      {tab === 'tests'     && <TestChecklist />}

      {/* Architecture overview */}
      {tab === 'connect' && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'hsl(33 100% 55%)' }}>
            🏗️ Architettura
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <ArchCard title="A — Adapter Layer" items={[
              'BreezSparkAdapter (interface)',
              'MockBreezAdapter (no API key)',
              'LiveBreezAdapter (API key)',
              'createBreezAdapter() factory',
            ]} />
            <ArchCard title="B — Seed / Derivation" items={[
              'm/8797555\'/1\'/0\' (identity, mainnet)',
              'Purpose: SHA256("spark") last 3B',
              'BIP84 ≠ Spark → no collision',
              'Formalmente documentato ✅',
            ]} />
            <ArchCard title="C — IDB Storage" items={[
              'Namespace: breez-spark-alpha-v1',
              'Separato da BTC/Signal stores',
              'SparkStorage.verifyIsolation()',
              'Recovery tramite seed',
            ]} />
            <ArchCard title="D — Send Flow" items={[
              'parse() → tipo rilevato',
              'prepareSend() → fee mostrata',
              'Conferma utente obbligatoria',
              'send() → feesExcluded',
            ]} />
            <ArchCard title="E — Receive" items={[
              'BOLT11 invoice + QR',
              'Spark address',
              'BOLT12 receive: ❌ non supportato',
              'Scadenza 3600s default',
            ]} />
            <ArchCard title="F — Fee Model" items={[
              'Alpha fee: 0.10% (feesExcluded)',
              'Spark fee: TBD (PENDING BREEZ)',
              'recipient_exact compatibile*',
              '*Non garantito prima di risposta Breez',
            ]} />
            <ArchCard title="H — Portfolio Types" items={[
              'btc → on-chain (esistente)',
              'btc_lightning → Lightning',
              'spark → Spark-to-Spark',
              'NON sommati automaticamente',
            ]} />
            <ArchCard title="I — Tx Types" items={[
              'btc_lightning_sent/received',
              'spark_sent/received',
              'Separati da btc_sent/received',
              'Storico produzione invariato',
            ]} />
            <ArchCard title="J — iOS Architecture" items={[
              'Foreground: visibilitychange → sync()',
              'Background: platform limitation',
              'registerWebhook() → VAPID',
              'Re-init al foreground',
            ]} />
            <ArchCard title="M — API Key" items={[
              'VITE_BREEZ_API_KEY (env/secret)',
              'Mai hardcoded, mai nei log',
              'Assente → MockAdapter',
              'Presente → LiveAdapter',
            ]} />
          </div>

          <div style={{ marginTop: 14, padding: '8px 12px', background: 'hsl(215 28% 7%)', borderRadius: 6, fontSize: 10, color: 'hsl(215 16% 45%)', lineHeight: 1.7 }}>
            <strong style={{ color: 'hsl(215 16% 65%)' }}>Prossimi step dopo ricezione API key:</strong><br />
            1. Aggiungere VITE_BREEZ_API_KEY come secret Replit nel PoC<br />
            2. Premere "Connetti (Live)" nel pannello Connect<br />
            3. Verificare connect(), getInfo(), balance, receive, send con importo minimo<br />
            4. Produrre report finale GO/NO-GO<br />
            5. Solo dopo approvazione esplicita → "Breez Spark — Architecture Design for Alpha Wallet"<br />
            6. Solo dopo approvazione architettura → implementazione production
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid hsl(var(--border))', fontSize: 10, color: 'hsl(215 16% 35%)', textAlign: 'center' }}>
        PoC Isolato — NON modifica Alpha Wallet · Network: mainnet · Test mnemonic senza fondi · @breeztech/breez-sdk-spark@0.15.1
      </div>
    </div>
  );
}

function ArchCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ background: 'hsl(215 28% 8%)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'hsl(33 100% 60%)', marginBottom: 8 }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ fontSize: 10, color: 'hsl(215 16% 55%)', padding: '2px 0', borderBottom: i < items.length - 1 ? '1px solid hsl(215 20% 14%)' : 'none' }}>
          {item}
        </div>
      ))}
    </div>
  );
}

export default function SparkArchDemo() {
  return (
    <BreezSparkProvider>
      <SparkArchDemoInner />
    </BreezSparkProvider>
  );
}
