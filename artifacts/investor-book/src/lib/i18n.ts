/**
 * i18n — Investor Portal translations (EN + IT)
 */
export type Lang = 'en' | 'it';

// ─── NAV / LAYOUT ─────────────────────────────────────────────────────────────
export const nav = {
  en: {
    subtitle:        'Confidential Investor Portal',
    home:            'Home',
    book:            'Investor Book',
    tech:            'Technology',
    security:        'Security',
    roadmap:         'Roadmap',
    market:          'Market',
    team:            'Team',
    contact:         'Contact',
    secureSession:   'Secure Session',
    authorizedUntil: 'Authorized until',
    noExpiry:        'No expiry',
    secureLogout:    'Secure Logout',
    confidential:    '🔒 Encrypted · Monitored · Confidential',
    dataRoom:        'AlphaChat · Confidential Investor Data Room',
    dark:            'Dark',
    light:           'Light',
  },
  it: {
    subtitle:        'Portale Investitori Riservato',
    home:            'Home',
    book:            'Investor Book',
    tech:            'Tecnologia',
    security:        'Sicurezza',
    roadmap:         'Roadmap',
    market:          'Mercato',
    team:            'Team',
    contact:         'Contatti',
    secureSession:   'Sessione Sicura',
    authorizedUntil: 'Autorizzato fino al',
    noExpiry:        'Nessuna scadenza',
    secureLogout:    'Logout Sicuro',
    confidential:    '🔒 Cifrato · Monitorato · Riservato',
    dataRoom:        'AlphaChat · Data Room Investitori Riservata',
    dark:            'Scuro',
    light:           'Chiaro',
  },
};

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
export const home = {
  en: {
    eyebrow:         'INVESTOR PORTAL · RESTRICTED ACCESS',
    welcome:         'Welcome',
    sub:             "You have secure access to AlphaChat's confidential investor materials. All access is logged and monitored.",
    sessionActive:   'Secure Session Active',
    lastLogin:       'Last login',
    sessionExpires:  'Session expires',
    noExpiry:        'No expiry',
    availableDocs:   'Documents Available',
    languages:       'Languages',
    lastUpdated:     'Last Updated',
    ndaProtected:    'Restricted Access',
    docsSection:     'Available Documents',
    noticeText:      'These documents are strictly confidential and for authorized investors only. By accessing this portal you agree not to disclose, reproduce or distribute any information contained herein without prior written consent from AlphaChat.',
    sections: [
      { title: 'Investor Book',       body: 'Complete overview of AlphaChat — vision, product, financials, market and team. Available in EN and IT.', tag: 'Core Document', updated: 'Jul 2025', pages: '48 pages' },
      { title: 'Technology',          body: 'E2E encryption (Signal Protocol), USDA payment layer, WebRTC calls, React Native mobile — a full deep-dive.', tag: 'Technical', updated: 'Jul 2025' },
      { title: 'Security Architecture', body: 'Zero-knowledge design, Phoenix Protocol, biometric lock, multi-device key management and audit trail.', tag: 'Confidential', updated: 'Jul 2025' },
      { title: 'Product Roadmap',     body: 'Phased execution plan from MVP to global expansion. 12-month milestones, delivery targets and KPIs.', tag: 'Strategic', updated: 'Jul 2025' },
      { title: 'Market Opportunity',  body: 'TAM, SAM, SOM analysis. Competitive landscape. Why privacy-first messaging is a $50B+ opportunity.', tag: 'Market Data', updated: 'Jul 2025' },
      { title: 'Team & Vision',       body: 'The founder story, the team, the thesis. Built by engineers who experienced firsthand why privacy matters.', tag: 'Leadership', updated: 'Jul 2025' },
      { title: 'Contact & Next Steps',body: 'Schedule a call, request financial models, or initiate due diligence. Direct line to the founding team.', tag: 'Action', updated: 'Always open' },
    ],
  },
  it: {
    eyebrow:         'PORTALE INVESTITORI · ACCESSO RISERVATO',
    welcome:         'Benvenuto',
    sub:             'Hai accesso sicuro ai materiali riservati di AlphaChat per investitori. Ogni accesso è registrato e monitorato.',
    sessionActive:   'Sessione Sicura Attiva',
    lastLogin:       'Ultimo accesso',
    sessionExpires:  'Sessione scade il',
    noExpiry:        'Nessuna scadenza',
    availableDocs:   'Documenti Disponibili',
    languages:       'Lingue',
    lastUpdated:     'Ultimo Aggiornamento',
    ndaProtected:    'Accesso Riservato',
    docsSection:     'Documenti Disponibili',
    noticeText:      'Questi documenti sono strettamente riservati e destinati esclusivamente a investitori autorizzati. Accedendo a questo portale accetti di non divulgare, riprodurre o distribuire alcuna informazione in essi contenuta senza il previo consenso scritto di AlphaChat.',
    sections: [
      { title: 'Investor Book',         body: 'Panoramica completa di AlphaChat — visione, prodotto, finanza, mercato e team. Disponibile in EN e IT.', tag: 'Documento Core', updated: 'Lug 2025', pages: '48 pagine' },
      { title: 'Tecnologia',            body: 'Crittografia E2E (Signal Protocol), layer di pagamento USDA, chiamate WebRTC, app React Native — un approfondimento completo.', tag: 'Tecnico', updated: 'Lug 2025' },
      { title: 'Architettura Sicurezza',body: 'Design zero-knowledge, Phoenix Protocol, biometria, gestione chiavi multi-device e audit trail.', tag: 'Riservato', updated: 'Lug 2025' },
      { title: 'Roadmap di Prodotto',   body: 'Piano di esecuzione per fasi da MVP all\'espansione globale. Milestone a 12 mesi, target di consegna e KPI.', tag: 'Strategico', updated: 'Lug 2025' },
      { title: 'Opportunità di Mercato',body: 'Analisi TAM, SAM, SOM. Landscape competitivo. Perché la messaggistica privacy-first è un\'opportunità da $50B+.', tag: 'Dati di Mercato', updated: 'Lug 2025' },
      { title: 'Team & Visione',        body: 'La storia del fondatore, il team, la tesi. Costruito da ingegneri che hanno vissuto in prima persona perché la privacy conta.', tag: 'Leadership', updated: 'Lug 2025' },
      { title: 'Contatti & Prossimi Passi', body: 'Prenota una call, richiedi i modelli finanziari o avvia la due diligence. Contatto diretto con il team fondatore.', tag: 'Azione', updated: 'Sempre aperto' },
    ],
  },
};

// ─── TECHNOLOGY PAGE ──────────────────────────────────────────────────────────
export const technology = {
  en: {
    eyebrow: 'Technology',
    title:   'Built for the Paranoid',
    sub:     'Every component of AlphaChat is designed with adversarial thinking. Military-grade cryptography, zero server knowledge, and open protocols.',
    stackTitle: 'Tech Stack',
    deepDive: '💡 For a complete technical deep-dive including sequence diagrams, key derivation details and protocol specifics, see the',
    deepDiveLink: 'Investor Book → Architecture section',
    pillars: [
      { icon: '🔐', title: 'Signal Protocol E2E', body: 'Double Ratchet + X3DH key exchange — every message encrypted with ephemeral keys. Zero server knowledge.', tag: 'Cryptography' },
      { icon: '🗝️', title: 'Alpha Wallet — Self-Custodial', body: 'HD wallet (BIP-39/44/84) built from scratch. Seed phrase generated locally, never transmitted. Private keys sign offline and are zeroed in memory immediately after. 4 chains: Polygon, Ethereum, BSC, Bitcoin.', tag: 'Self-Custody' },
      { icon: '💳', title: 'USDA Payment Layer', body: 'Native stablecoin payments embedded in conversations. Escrow-based P2P transfers with on-chain verification on Polygon.', tag: 'Blockchain' },
      { icon: '📞', title: 'WebRTC Secure Calls', body: 'E2E encrypted audio/video calls. TURN/STUN with ICE restart, quality monitoring (RTT, jitter, packet loss), call log and history.', tag: 'Real-time' },
      { icon: '📱', title: 'React Native Mobile', body: 'Single codebase for iOS and Android via Expo. Biometric lock (Face ID / Fingerprint), push notifications, PWA support.', tag: 'Cross-platform' },
      { icon: '☁️', title: 'Cloudflare R2 Storage', body: 'E2E encrypted media files stored in R2. Signed URLs, multipart upload, automatic cleanup. Zero egress costs.', tag: 'Infrastructure' },
      { icon: '🛡️', title: 'Phoenix Protocol', body: 'Emergency account protection: argon2id-protected destruction trigger, Dead Man Switch, Recovery Card, multi-device key sync.', tag: 'Security' },
    ],
    stack: [
      { layer: 'Frontend',   tech: 'React Native (Expo) · React (Vite) · TypeScript' },
      { layer: 'Backend',    tech: 'Node.js · Express · TypeScript · MongoDB (Mongoose)' },
      { layer: 'Crypto',     tech: 'Signal Protocol · AES-256-GCM · Argon2id · X25519' },
      { layer: 'Wallet',     tech: 'BIP-39/44/84 · secp256k1 · P2WPKH SegWit · PSBT · WebCrypto API' },
      { layer: 'Blockchain', tech: 'Polygon · Ethereum · BSC · Bitcoin · Viem · ERC-20 (USDA)' },
      { layer: 'Infra',      tech: 'Cloudflare R2 · Nodemailer SMTP · WebRTC · VAPID Push' },
      { layer: 'Auth',       tech: 'JWT ES256 · Session tokens · WebAuthn Face ID · PKCE' },
    ],
  },
  it: {
    eyebrow: 'Tecnologia',
    title:   'Costruito per i Paranoici',
    sub:     'Ogni componente di AlphaChat è progettato con un approccio adversariale. Crittografia di livello militare, zero conoscenza server, protocolli aperti.',
    stackTitle: 'Stack Tecnologico',
    deepDive: '💡 Per un approfondimento tecnico completo con diagrammi di sequenza, derivazione delle chiavi e specifiche di protocollo, vedi l\'',
    deepDiveLink: 'Investor Book → sezione Architettura',
    pillars: [
      { icon: '🔐', title: 'Signal Protocol E2E', body: 'Double Ratchet + X3DH key exchange — ogni messaggio cifrato con chiavi effimere. Zero conoscenza server.', tag: 'Crittografia' },
      { icon: '🗝️', title: 'Alpha Wallet — Self-Custodial', body: 'Wallet HD (BIP-39/44/84) costruito da zero. Frase seme generata localmente, mai trasmessa. Le chiavi private firmano offline e vengono azzerate in memoria subito dopo. 4 chain: Polygon, Ethereum, BSC, Bitcoin.', tag: 'Self-Custody' },
      { icon: '💳', title: 'Layer Pagamenti USDA', body: 'Pagamenti in stablecoin nativi nelle conversazioni. Trasferimenti P2P con escrow e verifica on-chain su Polygon.', tag: 'Blockchain' },
      { icon: '📞', title: 'Chiamate Sicure WebRTC', body: 'Chiamate audio/video E2E cifrate. TURN/STUN con ICE restart, monitoraggio qualità (RTT, jitter, packet loss), cronologia chiamate.', tag: 'Real-time' },
      { icon: '📱', title: 'React Native Mobile', body: 'Codebase unico per iOS e Android via Expo. Blocco biometrico (Face ID / Impronta), notifiche push, supporto PWA.', tag: 'Cross-platform' },
      { icon: '☁️', title: 'Cloudflare R2 Storage', body: 'File media cifrati E2E su R2. URL firmati, upload multipart, pulizia automatica. Zero costi di egress.', tag: 'Infrastruttura' },
      { icon: '🛡️', title: 'Phoenix Protocol', body: 'Protezione d\'emergenza: trigger di distruzione protetto da argon2id, Dead Man Switch, Recovery Card, sincronizzazione chiavi multi-device.', tag: 'Sicurezza' },
    ],
    stack: [
      { layer: 'Frontend',       tech: 'React Native (Expo) · React (Vite) · TypeScript' },
      { layer: 'Backend',        tech: 'Node.js · Express · TypeScript · MongoDB (Mongoose)' },
      { layer: 'Crittografia',   tech: 'Signal Protocol · AES-256-GCM · Argon2id · X25519' },
      { layer: 'Wallet',         tech: 'BIP-39/44/84 · secp256k1 · P2WPKH SegWit · PSBT · WebCrypto API' },
      { layer: 'Blockchain',     tech: 'Polygon · Ethereum · BSC · Bitcoin · Viem · ERC-20 (USDA)' },
      { layer: 'Infrastruttura', tech: 'Cloudflare R2 · Nodemailer SMTP · WebRTC · VAPID Push' },
      { layer: 'Autenticazione', tech: 'JWT ES256 · Token di sessione · WebAuthn Face ID · PKCE' },
    ],
  },
};

// ─── SECURITY PAGE ────────────────────────────────────────────────────────────
export const security = {
  en: {
    eyebrow: 'Security Architecture',
    title:   'Zero Trust. Zero Knowledge.',
    sub:     'AlphaChat operates on the principle that the server should never be trusted. All sensitive data is encrypted client-side before it ever leaves the device.',
    note:    "🔒 AlphaChat's security model has been designed to withstand nation-state level adversaries. The founding team includes engineers with backgrounds in cryptography, infosec, and privacy compliance.",
    stats: [
      { v: 'AES-256',  l: 'Encryption standard' },
      { v: 'Argon2id', l: 'Password hashing' },
      { v: 'X25519',   l: 'Key exchange' },
      { v: 'ES256',    l: 'JWT signing' },
      { v: '0',        l: 'Plaintext on server' },
      { v: '100%',     l: 'Open protocols' },
    ],
    layers: [
      {
        icon: '🔑', title: 'Signal Protocol',
        points: [
          'Double Ratchet algorithm — forward secrecy on every message',
          'X3DH key agreement — asynchronous session init without server mediation',
          'OTPK one-time prekeys — exhaustion auto-replenishment',
          'Identity key verification with Safety Numbers and QR scan',
        ],
      },
      {
        icon: '🗝️', title: 'Alpha Wallet — Self-Custodial Vault',
        points: [
          'BIP-39 mnemonic (12–24 words) generated locally with crypto.getRandomValues — never transmitted',
          'Private key derived on-device (BIP-44/84), used to sign, then zeroed in try/finally block',
          'Wallet encrypted with AES-256-GCM in IndexedDB; sealed with Face ID via WebAuthn',
          'Server receives only the signed transaction — never the seed phrase or private key',
          '4 chains: Polygon, Ethereum, BSC, Bitcoin Native SegWit (PSBT)',
        ],
      },
      {
        icon: '🛡️', title: 'Phoenix Protocol',
        points: [
          'Emergency account lock/destroy triggered by argon2id-protected code',
          'Requires email confirmation token (15-min expiry)',
          'Dead Man Switch — automated destruction if no check-in within set interval',
          'Recovery Card — offline backup generated at registration',
        ],
      },
      {
        icon: '📱', title: 'Device & Session',
        points: [
          'Multi-device key fan-out — messages encrypted per device',
          'Biometric-only mode (Face ID / Fingerprint) — no PIN fallback',
          'Session revocation propagated via WebSocket to all devices',
          'JTI blocklist on Redis for instant token invalidation',
        ],
      },
      {
        icon: '🌐', title: 'Infrastructure',
        points: [
          'E2E encrypted media on Cloudflare R2 — server never sees plaintext',
          'AES-256-GCM for blob encryption, key wrapped via Signal',
          'VAPID web push — payload encrypted per RFC 8291',
          'All access logged with IP, userAgent and outcome',
        ],
      },
    ],
  },
  it: {
    eyebrow: 'Architettura di Sicurezza',
    title:   'Zero Trust. Zero Conoscenza.',
    sub:     'AlphaChat opera sul principio che il server non deve mai essere fidato. Tutti i dati sensibili vengono cifrati lato client prima di lasciare il dispositivo.',
    note:    '🔒 Il modello di sicurezza di AlphaChat è stato progettato per resistere ad avversari a livello di stato nazione. Il team fondatore include ingegneri con background in crittografia, infosec e conformità alla privacy.',
    stats: [
      { v: 'AES-256',  l: 'Standard di cifratura' },
      { v: 'Argon2id', l: 'Hashing password' },
      { v: 'X25519',   l: 'Scambio chiavi' },
      { v: 'ES256',    l: 'Firma JWT' },
      { v: '0',        l: 'Testo in chiaro su server' },
      { v: '100%',     l: 'Protocolli aperti' },
    ],
    layers: [
      {
        icon: '🔑', title: 'Signal Protocol',
        points: [
          'Algoritmo Double Ratchet — forward secrecy su ogni messaggio',
          'X3DH key agreement — inizializzazione sessione asincrona senza mediazione server',
          'OTPK one-time prekeys — reintegro automatico alla scadenza',
          'Verifica della chiave d\'identità con Safety Numbers e scansione QR',
        ],
      },
      {
        icon: '🗝️', title: 'Alpha Wallet — Vault Self-Custodial',
        points: [
          'Frase seme BIP-39 (12–24 parole) generata localmente con crypto.getRandomValues — mai trasmessa',
          'Chiave privata derivata on-device (BIP-44/84), usata per firmare, poi azzerata nel blocco try/finally',
          'Wallet cifrato con AES-256-GCM in IndexedDB; sigillato con Face ID via WebAuthn',
          'Il server riceve solo la transazione firmata — mai la frase seme o la chiave privata',
          '4 chain: Polygon, Ethereum, BSC, Bitcoin Native SegWit (PSBT)',
        ],
      },
      {
        icon: '🛡️', title: 'Phoenix Protocol',
        points: [
          'Blocco/distruzione d\'emergenza attivato da codice protetto con argon2id',
          'Richiede token di conferma email (scadenza 15 min)',
          'Dead Man Switch — distruzione automatica se non si effettua il check-in entro l\'intervallo impostato',
          'Recovery Card — backup offline generato alla registrazione',
        ],
      },
      {
        icon: '📱', title: 'Dispositivo & Sessione',
        points: [
          'Fan-out delle chiavi multi-device — messaggi cifrati per dispositivo',
          'Modalità solo biometrica (Face ID / Impronta) — nessun fallback PIN',
          'Revoca della sessione propagata via WebSocket a tutti i dispositivi',
          'Blocklist JTI su Redis per invalidazione istantanea dei token',
        ],
      },
      {
        icon: '🌐', title: 'Infrastruttura',
        points: [
          'Media E2E cifrati su Cloudflare R2 — il server non vede mai il testo in chiaro',
          'AES-256-GCM per cifratura blob, chiave avvolta via Signal',
          'VAPID web push — payload cifrato secondo RFC 8291',
          'Tutti gli accessi registrati con IP, userAgent e risultato',
        ],
      },
    ],
  },
};

// ─── ROADMAP PAGE ─────────────────────────────────────────────────────────────
export const roadmap = {
  en: {
    eyebrow: 'Product Roadmap',
    title:   'Execution, Not Promises',
    sub:     'A phased approach from core encryption to a global financial messaging platform. Each phase is self-funded by the previous one.',
    note:    '📋 Full roadmap with delivery dates, KPIs and resource allocation available in the',
    noteLink:'Investor Book → Roadmap section',
    noteEnd: '. A detailed 12-month execution plan is available upon NDA signing.',
    statusLabels: {
      complete:      '✓ Completed',
      completed:     '✓ Completed',
      active:        '⟳ In progress',
      'in-progress': '⟳ In progress',
      upcoming:      '◯ Planned',
      planned:       '◯ Planned',
    },
    phases: [
      { name: 'Phase 1 — Foundation', status: 'complete',  desc: 'Signal E2E encryption, multi-device sync, Phoenix Protocol, React Native app.' },
      { name: 'Phase 2 — Payments',   status: 'complete',  desc: 'USDA P2P transfers, escrow system, Gas Station automation, wallet integration.' },
      { name: 'Phase 3 — Scale',      status: 'active',    desc: 'Group E2E encryption, WebRTC secure calls, Cloudflare R2 migration, i18n (10 languages).' },
      { name: 'Phase 4 — Growth',     status: 'upcoming',  desc: 'Enterprise tier, SDK for developers, GDPR/SOC2 compliance, Marketplace launch.' },
      { name: 'Phase 5 — Global',     status: 'upcoming',  desc: 'Series A fundraise, US & EU regulatory approval, white-label offering, global expansion.' },
    ],
  },
  it: {
    eyebrow: 'Roadmap di Prodotto',
    title:   'Esecuzione, Non Promesse',
    sub:     'Un approccio per fasi dalla crittografia di base alla piattaforma di messaggistica finanziaria globale. Ogni fase si autofinanzia con quella precedente.',
    note:    '📋 Roadmap completa con date di consegna, KPI e allocazione risorse disponibile nell\'',
    noteLink:'Investor Book → sezione Roadmap',
    noteEnd: '. Un piano di esecuzione dettagliato su 12 mesi è disponibile previa firma NDA.',
    statusLabels: {
      complete:      '✓ Completato',
      completed:     '✓ Completato',
      active:        '⟳ In corso',
      'in-progress': '⟳ In corso',
      upcoming:      '◯ Pianificato',
      planned:       '◯ Pianificato',
    },
    phases: [
      { name: 'Fase 1 — Fondamenta',  status: 'complete',  desc: 'Crittografia E2E Signal, sincronizzazione multi-device, Phoenix Protocol, app React Native.' },
      { name: 'Fase 2 — Pagamenti',   status: 'complete',  desc: 'Trasferimenti P2P USDA, sistema di escrow, automazione Gas Station, integrazione wallet.' },
      { name: 'Fase 3 — Scalabilità', status: 'active',    desc: 'Crittografia E2E di gruppo, chiamate sicure WebRTC, migrazione a Cloudflare R2, i18n (10 lingue).' },
      { name: 'Fase 4 — Crescita',    status: 'upcoming',  desc: 'Tier enterprise, SDK per sviluppatori, conformità GDPR/SOC2, lancio Marketplace.' },
      { name: 'Fase 5 — Globale',     status: 'upcoming',  desc: 'Raccolta Series A, approvazione normativa US & EU, offerta white-label, espansione globale.' },
    ],
  },
};

// ─── MARKET PAGE ──────────────────────────────────────────────────────────────
export const market = {
  en: {
    eyebrow:           'Market Opportunity',
    title:             'A $120B Market Waiting to be Won',
    sub:               'Privacy-first messaging at the intersection of encrypted communications and embedded finance. The regulatory environment has never been more favourable.',
    driversTitle:      'Market Drivers',
    competitorsTitle:  'Competitive Landscape',
    note:              '📈 Full market analysis with sources, SWOT matrix and financial projections is in the',
    noteLink:          'Investor Book',
    tableHeaders:      ['Competitor', 'Strength', 'Weakness', 'Threat'],
    segments: [
      { label: 'TAM — Global Messaging',  value: '$120B+', sub: 'Total addressable market by 2028' },
      { label: 'SAM — Privacy-first niche', value: '$18B', sub: 'Serviceable addressable market' },
      { label: 'SOM — Target Year 3',     value: '$240M',  sub: 'Realistic capture at scale' },
    ],
    drivers: [
      { icon: '📜', title: 'Regulatory tailwinds',  body: 'GDPR, DSA, EU AI Act. Enterprises need provably private comms or face heavy fines.' },
      { icon: '🏛️', title: 'Institutional demand', body: 'Law firms, banks, government agencies actively seeking Signal-class security with enterprise controls.' },
      { icon: '💰', title: 'Embedded finance',      body: '$4.6T in annual stablecoin volume. Messaging + payments is the next super-app layer.' },
      { icon: '🌍', title: 'Global south growth',  body: 'LATAM, SEA, MEA: mobile-first populations with high crypto adoption and low trust in traditional banking.' },
    ],
    competitors: [
      { name: 'Signal',   strength: 'E2E encryption',  weakness: 'No payments, no monetisation model', threat: 'Low' },
      { name: 'WhatsApp', strength: '2B+ users',        weakness: 'Meta ownership, no real privacy',     threat: 'Medium' },
      { name: 'Telegram', strength: 'Crypto community', weakness: 'Not truly E2E by default',             threat: 'Medium' },
      { name: 'Wire',     strength: 'Enterprise focus', weakness: 'Poor UX, no payments',                 threat: 'Low' },
    ],
    threatLow:    'Low',
    threatMedium: 'Medium',
  },
  it: {
    eyebrow:           'Opportunità di Mercato',
    title:             'Un Mercato da $120B in Attesa di Essere Conquistato',
    sub:               'Messaggistica privacy-first all\'intersezione di comunicazioni cifrate e finanza integrata. Il contesto normativo non è mai stato così favorevole.',
    driversTitle:      'Driver di Mercato',
    competitorsTitle:  'Landscape Competitivo',
    note:              '📈 Analisi di mercato completa con fonti, matrice SWOT e proiezioni finanziarie nell\'',
    noteLink:          'Investor Book',
    tableHeaders:      ['Competitor', 'Punto di Forza', 'Debolezza', 'Minaccia'],
    segments: [
      { label: 'TAM — Messaggistica Globale',    value: '$120B+', sub: 'Mercato totale indirizzabile entro il 2028' },
      { label: 'SAM — Nicchia privacy-first',    value: '$18B',   sub: 'Mercato servibile indirizzabile' },
      { label: 'SOM — Target Anno 3',             value: '$240M',  sub: 'Acquisizione realistica a regime' },
    ],
    drivers: [
      { icon: '📜', title: 'Vento normativo favorevole', body: 'GDPR, DSA, EU AI Act. Le aziende hanno bisogno di comunicazioni provabilmente private o rischiano pesanti sanzioni.' },
      { icon: '🏛️', title: 'Domanda istituzionale',    body: 'Studi legali, banche, agenzie governative cercano attivamente sicurezza di livello Signal con controlli enterprise.' },
      { icon: '💰', title: 'Finanza integrata',         body: '$4.6T di volume annuo in stablecoin. Messaggistica + pagamenti è il prossimo layer super-app.' },
      { icon: '🌍', title: 'Crescita Global South',    body: 'LATAM, SEA, MEA: popolazioni mobile-first con alta adozione crypto e bassa fiducia nel sistema bancario tradizionale.' },
    ],
    competitors: [
      { name: 'Signal',   strength: 'Crittografia E2E',    weakness: 'No pagamenti, nessun modello di monetizzazione', threat: 'Bassa' },
      { name: 'WhatsApp', strength: '2B+ utenti',           weakness: 'Proprietà Meta, nessuna vera privacy',           threat: 'Media' },
      { name: 'Telegram', strength: 'Community crypto',     weakness: 'Non veramente E2E di default',                   threat: 'Media' },
      { name: 'Wire',     strength: 'Focus enterprise',     weakness: 'UX scadente, no pagamenti',                      threat: 'Bassa' },
    ],
    threatLow:    'Bassa',
    threatMedium: 'Media',
  },
};

// ─── TEAM PAGE ────────────────────────────────────────────────────────────────
export const team = {
  en: {
    eyebrow:        'Team & Vision',
    title:          'Built by Practitioners',
    sub:            "Not academics building privacy theory — engineers who experienced first-hand why it matters.",
    letterTitle:    'Letter from the Founder',
    journeyTitle:   'The Journey',
  },
  it: {
    eyebrow:        'Team & Visione',
    title:          'Costruito da Professionisti',
    sub:            'Non accademici che teorizzano la privacy — ingegneri che hanno vissuto in prima persona perché è importante.',
    letterTitle:    'Lettera del Fondatore',
    journeyTitle:   'Il Percorso',
  },
};

// ─── CONTACT PAGE ─────────────────────────────────────────────────────────────
export const contact = {
  en: {
    eyebrow:     'Contact & Next Steps',
    title:       "Let's Talk",
    sub:         'The founding team is available for calls, questions and due diligence. All communications are handled in strict confidence.',
    sendTitle:   'Send a Message',
    namePH:      'Full name',
    nameLabel:   'Your Name',
    subjectLabel:'Subject',
    subjectPH:   'Select a topic…',
    msgLabel:    'Message',
    msgPH:       'Your message…',
    sendBtn:     'Send Message →',
    sending:     'Sending…',
    sentTitle:   'Message Sent',
    sentSub:     "We'll be in touch within 24 hours. Check your email for confirmation.",
    subjects:    [
      { value: 'call',  label: 'Schedule a call' },
      { value: 'model', label: 'Request financial model' },
      { value: 'dd',    label: 'Start due diligence' },
      { value: 'question', label: 'General question' },
      { value: 'other', label: 'Other' },
    ],
    options: [
      { icon: '📅', title: 'Schedule a Call',         body: 'Book a 30-minute intro call with the founding team. Availability on request.' },
      { icon: '📊', title: 'Request Financial Model', body: 'Access the full financial model with projections and KPIs. Available under NDA.' },
      { icon: '🔍', title: 'Due Diligence',           body: 'Initiate formal due diligence. We provide full access to supporting data.' },
      { icon: '💬', title: 'Direct Question',         body: 'Use the form below to send any question to the team. Response within 24 hours.' },
    ],
  },
  it: {
    eyebrow:     'Contatti & Prossimi Passi',
    title:       'Parliamo',
    sub:         'Il team fondatore è disponibile per chiamate, domande e attività di due diligence. Tutte le comunicazioni avvengono in modo riservato.',
    sendTitle:   'Invia un messaggio',
    namePH:      'Nome completo',
    nameLabel:   'Il tuo nome',
    subjectLabel:'Oggetto',
    subjectPH:   'Seleziona un argomento…',
    msgLabel:    'Messaggio',
    msgPH:       'Il tuo messaggio…',
    sendBtn:     'Invia Messaggio →',
    sending:     'Invio in corso…',
    sentTitle:   'Messaggio inviato',
    sentSub:     'Ti risponderemo entro 24 ore. Controlla la tua email.',
    subjects:    [
      { value: 'call',     label: 'Prenota una call' },
      { value: 'model',    label: 'Richiedi il financial model' },
      { value: 'dd',       label: 'Avvia due diligence' },
      { value: 'question', label: 'Domanda generale' },
      { value: 'other',    label: 'Altro' },
    ],
    options: [
      { icon: '📅', title: 'Prenota una call',             body: 'Prenota una call introduttiva di 30 minuti con il team fondatore. Disponibilità su richiesta.' },
      { icon: '📊', title: 'Richiedi il Financial Model',  body: 'Accedi al modello finanziario completo con proiezioni e KPI. Disponibile sotto NDA.' },
      { icon: '🔍', title: 'Due Diligence',                body: 'Avvia una due diligence formale. Forniamo accesso completo ai dati di supporto.' },
      { icon: '💬', title: 'Domanda diretta',              body: 'Usa il modulo qui sotto per inviare qualsiasi domanda al team. Risposta entro 24 ore.' },
    ],
  },
};
