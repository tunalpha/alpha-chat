/**
 * SecurityCenterPage — "Perché Alpha Chat è diversa"
 *
 * Modal fullscreen con hero, accordion animati e banner finale.
 * Solo UI informativa — zero modifiche alla logica E2E.
 */

import { useState } from "react";

interface Props {
  onClose: () => void;
}

interface Section {
  id: string;
  emoji: string;
  title: string;
  content: React.ReactNode;
  highlight?: boolean;
}

const SECTIONS: Section[] = [
  {
    id: "e2e",
    emoji: "🔒",
    title: "Crittografia End-to-End",
    content: (
      <>
        <p>Ogni messaggio viene cifrato sul tuo dispositivo <strong>prima</strong> di essere inviato. Il server non riceve mai il testo in chiaro — riceve solo dati cifrati che non può leggere.</p>
        <p>Solo tu e il destinatario possedete le chiavi per decifrare i messaggi. Nessun intermediario, nessuna intercettazione possibile.</p>
        <div className="sc-badge-row">
          <span className="sc-badge sc-badge--green">✅ Signal Protocol</span>
          <span className="sc-badge sc-badge--green">✅ Zero-knowledge server</span>
        </div>
      </>
    ),
  },
  {
    id: "x3dh",
    emoji: "🔑",
    title: "X3DH — Prima stretta di mano",
    content: (
      <>
        <p><strong>Extended Triple Diffie-Hellman</strong> è il protocollo usato da Alpha Chat per stabilire una sessione sicura tra due utenti che non si sono mai parlati prima.</p>
        <p>Le chiavi crittografiche vengono scambiate in modo che nessuna chiave viaggi mai in chiaro sulla rete. Anche se un attaccante intercettasse tutti i pacchetti, non potrebbe ricavare nulla di utile.</p>
        <p>Il risultato è un segreto condiviso, noto solo ai due partecipanti, usato come base per il Double Ratchet.</p>
      </>
    ),
  },
  {
    id: "ratchet",
    emoji: "🔄",
    title: "Double Ratchet — Una chiave per ogni messaggio",
    content: (
      <>
        <p>Il <strong>Double Ratchet Algorithm</strong> genera una chiave crittografica unica per ogni singolo messaggio. La chiave viene usata una volta sola e poi eliminata.</p>
        <div className="sc-feature-list">
          <div className="sc-feature-item">
            <span className="sc-feature-icon">⏩</span>
            <div>
              <strong>Forward Secrecy</strong>
              <p>Anche se una chiave futura venisse compromessa, i messaggi precedenti restano al sicuro.</p>
            </div>
          </div>
          <div className="sc-feature-item">
            <span className="sc-feature-icon">🛡️</span>
            <div>
              <strong>Post-Compromise Security</strong>
              <p>Dopo una compromissione, il sistema si "guarisce" automaticamente ai messaggi successivi.</p>
            </div>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "media",
    emoji: "📷",
    title: "Media cifrati — AES-256-GCM",
    content: (
      <>
        <p>Foto, video, audio e documenti vengono cifrati con <strong>AES-256-GCM</strong> direttamente sul tuo dispositivo prima dell'upload.</p>
        <p>Il server vede solo blob cifrati opachi. Anche con accesso fisico al database, non è possibile vedere, ascoltare o leggere nessun file.</p>
        <div className="sc-badge-row">
          <span className="sc-badge">📸 Foto</span>
          <span className="sc-badge">🎥 Video</span>
          <span className="sc-badge">🎵 Audio</span>
          <span className="sc-badge">📄 Documenti</span>
        </div>
      </>
    ),
  },
  {
    id: "zk",
    emoji: "🧩",
    title: "Zero Knowledge",
    content: (
      <>
        <p>Il server conosce solo il minimo indispensabile per consegnare i messaggi.</p>
        <div className="sc-knows-grid">
          <div className="sc-knows-col">
            <div className="sc-knows-header sc-knows-header--yes">Il server conosce</div>
            <div className="sc-knows-item">Mittente (ID)</div>
            <div className="sc-knows-item">Destinatario (ID)</div>
            <div className="sc-knows-item">Timestamp</div>
            <div className="sc-knows-item">Dimensione blob</div>
          </div>
          <div className="sc-knows-col">
            <div className="sc-knows-header sc-knows-header--no">Il server NON conosce</div>
            <div className="sc-knows-item sc-knows-item--no">Testo dei messaggi</div>
            <div className="sc-knows-item sc-knows-item--no">Foto e video</div>
            <div className="sc-knows-item sc-knows-item--no">Audio e documenti</div>
            <div className="sc-knows-item sc-knows-item--no">Chiavi crittografiche</div>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "ghost",
    emoji: "👻",
    title: "Ghost Mode",
    content: (
      <>
        <p>Sei invisibile quanto vuoi. Puoi scegliere di nascondere ogni traccia della tua presenza.</p>
        <div className="sc-feature-list">
          <div className="sc-feature-item"><span className="sc-feature-icon">🕐</span><div><strong>Ultimo accesso nascosto</strong><p>Nessuno vede quando hai usato l'app l'ultima volta.</p></div></div>
          <div className="sc-feature-item"><span className="sc-feature-icon">⚫</span><div><strong>Stato online nascosto</strong><p>Non appari mai come "online" nella lista contatti.</p></div></div>
          <div className="sc-feature-item"><span className="sc-feature-icon">✓</span><div><strong>Conferme di lettura disattivate</strong><p>Le spunte non mostrano se hai letto il messaggio.</p></div></div>
        </div>
      </>
    ),
  },
  {
    id: "burn",
    emoji: "🔥",
    title: "Burn After Read",
    content: (
      <>
        <p>Alcuni messaggi devono sparire dopo essere stati letti. Con <strong>Burn After Read</strong> il messaggio si autodistrugge non appena il destinatario lo apre.</p>
        <p>Non rimane nulla — né sul dispositivo del destinatario, né sul server. Come se non fosse mai esistito.</p>
      </>
    ),
  },
  {
    id: "disappearing",
    emoji: "⏳",
    title: "Messaggi a scomparsa",
    content: (
      <>
        <p>Ogni conversazione può avere un timer di scomparsa. Dopo il tempo impostato (da 5 secondi a 7 giorni), i messaggi vengono eliminati automaticamente da entrambi i dispositivi.</p>
        <p>Ideale per conversazioni sensibili che non devono lasciare tracce nel tempo.</p>
      </>
    ),
  },
  {
    id: "destroy",
    emoji: "🗑️",
    title: "Secure Destroy",
    content: (
      <>
        <p><strong>Secure Destroy</strong> elimina definitivamente un messaggio da tutti i dispositivi e dal server.</p>
        <p>A differenza dell'eliminazione normale — che può lasciare tracce — Secure Destroy rimuove il messaggio in modo permanente e irreversibile, senza lasciare alcun segno della sua esistenza nella conversazione.</p>
      </>
    ),
  },
  {
    id: "safety",
    emoji: "👤",
    title: "Safety Number — Verifica identità",
    content: (
      <>
        <p>Il <strong>Safety Number</strong> è un'impronta crittografica unica della tua sessione Signal con un contatto. Confrontandolo con il tuo contatto puoi verificare che nessuno si sia interposto nella comunicazione.</p>
        <div className="sc-feature-list">
          <div className="sc-feature-item"><span className="sc-feature-icon">🔍</span><div><strong>Protezione MITM</strong><p>Rileva attacchi Man-in-the-Middle prima che possano compromettere la conversazione.</p></div></div>
          <div className="sc-feature-item"><span className="sc-feature-icon">📱</span><div><strong>QR Code</strong><p>Scansiona il QR del contatto per una verifica istantanea.</p></div></div>
          <div className="sc-feature-item"><span className="sc-feature-icon">🔢</span><div><strong>Fingerprint numerico</strong><p>Confronta i 12 gruppi di 5 cifre anche di persona o via telefono.</p></div></div>
        </div>
      </>
    ),
  },
  {
    id: "device-security",
    emoji: "📱",
    title: "Sicurezza del dispositivo",
    content: (
      <>
        <p>Alpha Chat protegge i tuoi dati anche dal punto di vista fisico. Se qualcuno ha il tuo telefono in mano, non può aprire l'app senza autenticazione.</p>
        <div className="sc-badge-row sc-badge-row--wrap">
          <span className="sc-badge">👁️ Face ID</span>
          <span className="sc-badge">👆 Touch ID</span>
          <span className="sc-badge">🔢 PIN</span>
          <span className="sc-badge">🕶️ Privacy Screen</span>
          <span className="sc-badge">⏱️ Auto Lock</span>
        </div>
      </>
    ),
  },
  {
    id: "emergency-lock",
    emoji: "🚨",
    title: "Emergency Lock",
    content: (
      <>
        <p><strong>Emergency Lock</strong> disconnette immediatamente tutti i tuoi dispositivi e revoca tutte le sessioni attive. L'account rimane integro e recuperabile.</p>
        <div className="sc-scenario-list">
          <div className="sc-scenario">📱 <span>Il telefono viene rubato</span></div>
          <div className="sc-scenario">👤 <span>Perdi il dispositivo</span></div>
          <div className="sc-scenario">⚠️ <span>Sospetti un accesso non autorizzato</span></div>
        </div>
        <p className="sc-hint">Accessibile da qualsiasi browser tramite il Portale Emergenze — anche senza avere il telefono con te.</p>
      </>
    ),
  },
  {
    id: "phoenix",
    emoji: "🔥",
    title: "Phoenix Protocol",
    highlight: true,
    content: (
      <>
        <div className="sc-phoenix-hero">
          <div className="sc-phoenix-icon">🦅</div>
          <p className="sc-phoenix-tagline">La difesa estrema. Irreversibile per definizione.</p>
        </div>
        <p>Il Phoenix Protocol ordina la distruzione definitiva del tuo account quando non hai alternative. Richiede una triplice verifica:</p>
        <div className="sc-auth-steps">
          <div className="sc-auth-step"><span>1</span> Recovery ID — dalla tua Recovery Card fisica</div>
          <div className="sc-auth-step"><span>2</span> Phoenix Code — la tua passphrase di emergenza</div>
          <div className="sc-auth-step"><span>3</span> Token via email — link monouso con TTL 15 minuti</div>
        </div>
        <p className="sc-section-label">Scenari reali in cui è stato pensato</p>
        <div className="sc-scenario-grid">
          <div className="sc-scenario-card">📱<br/><strong>Telefono rubato</strong></div>
          <div className="sc-scenario-card">🚔<br/><strong>Dispositivo sequestrato</strong></div>
          <div className="sc-scenario-card">⚠️<br/><strong>Costrizione fisica</strong></div>
          <div className="sc-scenario-card">🛂<br/><strong>Frontiera</strong></div>
          <div className="sc-scenario-card">📰<br/><strong>Giornalista</strong></div>
          <div className="sc-scenario-card">⚖️<br/><strong>Avvocato</strong></div>
          <div className="sc-scenario-card">👩‍⚕️<br/><strong>Medico</strong></div>
          <div className="sc-scenario-card">🛡️<br/><strong>Attivista</strong></div>
        </div>
        <p className="sc-section-label">Cosa viene eliminato</p>
        <div className="sc-destroy-list">
          {["Messaggi","Media e allegati","Sessioni e token","Chiavi Signal","Dispositivi autorizzati","Cache","Cronologia"].map(item => (
            <div key={item} className="sc-destroy-item">✅ {item}</div>
          ))}
        </div>
        <div className="sc-phoenix-warning">
          ⚠️ L'operazione è <strong>irreversibile</strong>. Una volta confermata, l'account non può essere recuperato.
        </div>
      </>
    ),
  },
  {
    id: "multidevice",
    emoji: "📲",
    title: "Multi-Device",
    content: (
      <>
        <p>Puoi usare Alpha Chat su più dispositivi contemporaneamente. Ogni dispositivo stabilisce una sessione Signal indipendente — non condivide le chiavi con gli altri.</p>
        <p>Puoi revocare singolarmente qualsiasi dispositivo in qualsiasi momento dalla pagina Dispositivi, senza dover cambiare password o invalidare gli altri.</p>
      </>
    ),
  },
  {
    id: "block",
    emoji: "🚫",
    title: "Blocco utenti",
    content: (
      <>
        <p>Puoi bloccare qualsiasi utente in qualsiasi momento. Una volta bloccato, non potrà più inviarti messaggi, vedere il tuo profilo o sapere che esisti su Alpha Chat.</p>
        <p>Il blocco è silenzioso: l'utente bloccato non riceve alcuna notifica.</p>
      </>
    ),
  },
];

function AccordionItem({ section, isOpen, onToggle }: {
  section: Section;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`sc-accordion${isOpen ? " sc-accordion--open" : ""}${section.highlight ? " sc-accordion--highlight" : ""}`}>
      <button
        className="sc-accordion-header"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="sc-accordion-emoji">{section.emoji}</span>
        <span className="sc-accordion-title">{section.title}</span>
        <span className="sc-accordion-chevron">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="sc-accordion-body">
          {section.content}
        </div>
      )}
    </div>
  );
}

export default function SecurityCenterPage({ onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  function toggle(id: string) {
    setOpenId(prev => prev === id ? null : id);
  }

  return (
    <div className="sc-root">
      {/* Header bar */}
      <div className="sc-topbar">
        <button className="sc-close-btn" onClick={onClose} aria-label="Chiudi">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span className="sc-topbar-title">Perché Alpha Chat è diversa</span>
      </div>

      <div className="sc-scroll">
        {/* Hero */}
        <div className="sc-hero">
          <div className="sc-hero-logo">α</div>
          <div className="sc-hero-brand">Alpha Chat</div>
          <h1 className="sc-hero-title">IL TUO BUNKER DIGITALE</h1>
          <p className="sc-hero-subtitle">La privacy è la tua prima linea di difesa.</p>
          <p className="sc-hero-desc">
            Alpha Chat non è una chat con la crittografia aggiunta. È un'architettura di sicurezza
            con un'app di messaggistica sopra. Ogni funzione nasce per proteggere te, non per
            raccogliere i tuoi dati.
          </p>
        </div>

        {/* Accordion */}
        <div className="sc-accordion-list">
          {SECTIONS.map(section => (
            <AccordionItem
              key={section.id}
              section={section}
              isOpen={openId === section.id}
              onToggle={() => toggle(section.id)}
            />
          ))}
        </div>

        {/* Sezione emozionale finale */}
        <div className="sc-why-section">
          <div className="sc-why-icon">💜</div>
          <h2 className="sc-why-title">Perché Alpha Chat</h2>
          <p className="sc-why-text">
            Alpha Chat non nasce per essere "un'altra chat".
          </p>
          <p className="sc-why-text">
            Nasce per proteggere la <strong>libertà digitale</strong>.
          </p>
          <p className="sc-why-text">
            La sicurezza non è una funzione.
            <br />
            <strong>È l'architettura dell'app.</strong>
          </p>
        </div>

        {/* Banner finale */}
        <div className="sc-final-banner">
          <div className="sc-final-icon">🛡️</div>
          <h2 className="sc-final-title">Il tuo bunker digitale</h2>
          <p className="sc-final-text">
            La privacy non dovrebbe essere un privilegio.
            <br />
            Dovrebbe essere la normalità.
          </p>
          <div className="sc-final-divider" />
          <p className="sc-final-motto">IL TUO BUNKER DIGITALE</p>
          <p className="sc-final-submotto">La privacy è la tua prima linea di difesa.</p>
          <button className="sc-final-btn" onClick={onClose}>
            Ho capito
          </button>
        </div>
      </div>
    </div>
  );
}
