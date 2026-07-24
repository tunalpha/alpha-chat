export const it = {
  nav: {
    readEn: "EN",
    readIt: "IT",
    contact: "Contatti",
  },
  cover: {
    title: "AlphaChat",
    badge: "Investor Book",
    subtitle: "Comunicazione privata. Pagamenti integrati. Un unico ecosistema.",
  },
  founder: {
    title: "Il Fondatore",
    name: "Enrico Maria Giaquinta",
    alias: 'alias "Alpha"',
    role: "Founder & Chief Architect",
    paragraphs: [
      "Enrico Maria Giaquinta, conosciuto con lo pseudonimo \"Alpha\", è un imprenditore italiano, software architect e innovatore tecnologico. Con oltre 15 anni di esperienza in tecnologie blockchain, sistemi di pagamento digitali e comunicazioni sicure, ha progettato e ingegnerizzato numerose piattaforme web e infrastrutture digitali.",
      "In qualità di fondatore di AlphaBit e ideatore di AlphaChat, guida la visione strategica, l'architettura e l'evoluzione dei prodotti. Il suo lavoro è caratterizzato da un profilo pubblico riservato, preferendo lasciare che siano l'ingegneria e la solidità dei suoi sistemi a parlare.",
      "Oltre alla tecnologia, è il fondatore di Felinia, un'iniziativa indipendente dedicata alla cura e alla protezione dei gatti randagi, riflettendo un impegno personale verso l'impatto sociale."
    ],
    philosophyTitle: "Filosofia Ingegneristica",
    philosophy: [
      {
        title: "Semplicità",
        desc: "La tecnologia deve eliminare la complessità, non crearla."
      },
      {
        title: "Sicurezza",
        desc: "Protezione dei dati e privacy integrate fin dalle fondamenta dell'architettura."
      },
      {
        title: "Visione di lungo periodo",
        desc: "Piattaforme progettate per evolversi senza mai perdere affidabilità."
      }
    ],
    quote: "La tecnologia non dovrebbe mai sostituire le relazioni umane. Dovrebbe renderle più sicure, più semplici e più libere."
  },
  founderLetter: {
    title: "Lettera del Fondatore",
    greeting: "Ai nostri futuri partner,",
    paragraphs: [
      "Ho iniziato a costruire AlphaChat perché il modo in cui comunichiamo digitalmente è fondamentalmente rotto. Abbiamo accettato una realtà in cui le nostre conversazioni più intime vengono analizzate per estrarre dati, in cui l'identità digitale viene affittata anziché posseduta, e in cui inviare valore a un amico richiede di uscire dalla conversazione per utilizzare un sistema finanziario disconnesso e spesso arcaico.",
      "Il livello di comunicazione e il livello transazionale dovrebbero essere lo stesso spazio.",
      "Con AlphaChat, non stiamo solo costruendo un'altra app di messaggistica. Stiamo costruendo un ambiente digitale sicuro e sovrano. Integrando il protocollo Signal per la crittografia end-to-end e Polygon per transazioni istantanee basate su stablecoin, abbiamo creato un'esperienza fluida. I tuoi messaggi sono matematicamente tuoi. Il tuo denaro è crittograficamente tuo.",
      "L'ecosistema AlphaBit è progettato per il lungo termine. Si fonda sulla convinzione che la privacy sia un diritto, non una funzionalità, e che i pagamenti appartengano al luogo in cui nascono le relazioni: all'interno della conversazione.",
      "Questo documento descrive in dettaglio l'architettura, il posizionamento di mercato e la visione. Vi invitiamo a osservare da vicino le fondamenta che abbiamo costruito.",
      "— Alpha"
    ]
  },
  story: {
    title: "Perché esiste AlphaChat",
    subtitle: "La narrazione prima del prodotto.",
    sections: [
      {
        title: "La Frammentazione della Comunicazione",
        desc: "Le interazioni moderne sono disperse su decine di piattaforme. Inviamo messaggi su un'app, paghiamo su un'altra e verifichiamo l'identità su una terza. Questa frizione degrada l'esperienza utente e rallenta il commercio."
      },
      {
        title: "La Privacy come Diritto Fondamentale",
        desc: "L'economia della sorveglianza ha mercificato l'interazione umana. Crediamo che la privacy non sia un lusso o un'opzione; è lo stato di default delle società digitali libere."
      },
      {
        title: "L'Evoluzione dell'Identità Digitale",
        desc: "L'identità si sta spostando dai database centralizzati all'auto-sovranità crittografica. Gli utenti richiedono il controllo su chi sono online e su chi può accedere ai loro dati."
      },
      {
        title: "I Pagamenti Appartengono alla Conversazione",
        desc: "Il trasferimento di valore è essenzialmente una forma di comunicazione. Spostare denaro dovrebbe essere istantaneo, sicuro e nativo in un'interfaccia di chat quanto l'invio di un messaggio di testo."
      }
    ]
  },
  product: {
    title: "Il Prodotto: AlphaChat",
    subtitle: "Un'applicazione unificata progettata per una privacy senza compromessi e per il trasferimento di valore integrato.",
    facts: [
      {
        title: "Crittografia End-to-End",
        desc: "Basata sul protocollo Signal (X3DH, Double Ratchet, prekeys monouso). Supporto multi-dispositivo con sessioni rigorosamente per dispositivo."
      },
      {
        title: "Media e Archiviazione Crittografati",
        desc: "Media crittografati E2E (AES-256-GCM per blob, chiavi avvolte in Signal). Cache locale crittografata con miniature E2E."
      },
      {
        title: "Identità e Fiducia",
        desc: "Modello TOFU (Trust On First Use). Verificata tramite Safety Numbers, verifica con codice QR e avvisi di cambio chiave."
      },
      {
        title: "Chiamate Sicure",
        desc: "WebRTC con segnalazione crittografata, resilienza al riavvio ICE e verifica della chiamata rispetto a bundle di chiavi crittografiche."
      },
      {
        title: "Chat di Gruppo",
        desc: "Completamente crittografate end-to-end tramite architettura fan-out Signal per membro."
      },
      {
        title: "Resilienza dell'Account",
        desc: "Recovery Card, Protocollo Phoenix (blocco/distruzione di emergenza con codice protetto da argon2id), Dead Man Switch, contatti di recupero e audit temporale di sicurezza completo."
      },
      {
        title: "Progressive Web App",
        desc: "Installabile, tollerante offline, notifiche push tramite VAPID, localizzata in 10 lingue."
      },
      {
        title: "Posizione Zero-Knowledge",
        desc: "Il server agisce come un relè cieco e non vede mai il testo in chiaro. I metadati sono rigorosamente ridotti al minimo."
      }
    ]
  },
  paymentLayer: {
    title: "Il Livello di Pagamento: USDA",
    subtitle: "Dollari digitali, integrati nativamente.",
    desc: "USDA è una stablecoin ERC-20 ancorata al dollaro digitale che opera sulla blockchain Polygon, fungendo da asset di regolamento nativo all'interno di AlphaChat.",
    features: [
      {
        title: "Motore di Escrow in Chat",
        desc: "Invia e richiedi fondi direttamente nella conversazione. Presenta un flusso di deposito → reclamo/rilascio con verifica on-chain, protezione anti-replay e blocco atomico."
      },
      {
        title: "Wallet Non Custodial",
        desc: "Gli utenti mantengono il controllo completo sui propri fondi. Profonda integrazione tramite WalletConnect/Reown che supporta MetaMask, Rainbow, Coinbase, Trust e Phantom."
      },
      {
        title: "Gas Station Automatizzata",
        desc: "UX senza attriti con ricariche automatizzate di MATIC, astraendo le complessità delle commissioni di rete blockchain."
      },
      {
        title: "Link di Pagamento Esterni",
        desc: "Richieste di pagamento basate su link alimentate da getusda.xyz, collegando gli utenti esterni al livello di pagamento di AlphaChat."
      }
    ]
  },
  ecosystem: {
    title: "L'Ecosistema: AlphaBit",
    subtitle: "Un unico stack coerente.",
    desc: "AlphaBit è l'ecosistema. AlphaChat è l'interfaccia consumer di punta. USDA è il livello di pagamento nativo. AlphaBit Pay è l'infrastruttura per i commercianti. Non competono; si integrano.",
    labels: {
      user: "Utente",
      alphaChat: "AlphaChat",
      usda: "Infrastruttura USDA",
      alphaBitPay: "AlphaBit Pay",
      merchants: "Commercianti"
    }
  },
  architecture: {
    title: "Architettura di Sistema",
    subtitle: "Crittografia edge. Relè ciechi. Regolamento decentralizzato.",
    labels: {
      clients: "Client (PWA Multi-dispositivo)",
      e2e: "Livello E2E (Protocollo Signal)",
      backend: "Backend API + WebSocket",
      db: "MongoDB + Object Storage R2",
      blockchain: "Blockchain Polygon"
    }
  },
  competitive: {
    title: "Panorama Competitivo",
    subtitle: "Posizionamento attraverso scelte architettoniche oggettive.",
    messaging: {
      title: "Piattaforme di Messaggistica",
      columns: ["Piattaforma", "E2E Default", "Indipendenza", "Pagamenti Integrati", "Recupero Self-Sovereign"],
      rows: [
        { name: "AlphaChat", e2e: "Sì", ind: "Sì", pay: "Nativo (USDA)", rec: "Sì (Phoenix/Cards)" },
        { name: "Signal", e2e: "Sì", ind: "Sì", pay: "Limitato (MobileCoin)", rec: "Basato su PIN" },
        { name: "WhatsApp", e2e: "Sì", ind: "No (Meta)", pay: "Fiat/Regionale", rec: "Backup Cloud" },
        { name: "Telegram", e2e: "No (Opt-in)", ind: "Sì", pay: "Integrazione TON", rec: "Centralizzato" },
        { name: "iMessage", e2e: "Sì", ind: "No (Apple)", pay: "Apple Pay (Fiat)", rec: "Legato al Cloud" }
      ]
    },
    payments: {
      title: "Elaboratori di Pagamento",
      desc: "I processori tradizionali (Stripe, PayPal, Adyen, Square) si concentrano sulle pagine di checkout dei commercianti. AlphaChat sposta il trasferimento di valore in flussi nativi della conversazione, bypassando le frizioni tradizionali.",
      columns: ["Operatore", "Superficie Primaria", "Binario di Regolamento", "Rapporto con la Conversazione"],
      rows: [
        { name: "AlphaBit Pay + USDA", surface: "In-chat e rail merchant", rail: "Stablecoin su Polygon", rel: "Nativo — il pagamento vive dentro la conversazione" },
        { name: "Stripe", surface: "Checkout merchant e API", rail: "Circuiti carte / rail bancari", rel: "Esterno — invocato da app e siti web" },
        { name: "PayPal", surface: "Wallet e pulsanti checkout", rail: "Wallet proprietario + banche", rel: "Adiacente — P2P presente, separato dalla messaggistica" },
        { name: "Adyen", surface: "Acquiring enterprise", rail: "Circuiti carte / rail locali", rel: "Esterno — processore back-end per merchant" },
        { name: "Square", surface: "POS e commercio SMB", rail: "Circuiti carte", rel: "Esterno — focus su retail fisico e online" }
      ]
    },
    stablecoins: {
      title: "Regolamento in Stablecoin",
      desc: "Mentre USDC, USDT ed EURC sono asset di liquidità di mercato per uso generale, USDA è ottimizzato come token di regolamento nativo dell'ecosistema su Polygon, progettato specificamente per escrow basati su chat e micro-transazioni.",
      columns: ["Asset", "Ancoraggio", "Ruolo Primario", "Posizionamento nell'Ecosistema"],
      rows: [
        { name: "USDA", peg: "Dollaro USA", role: "Regolamento nativo dell'ecosistema", pos: "Progettato per escrow in-chat e flussi AlphaBit Pay su Polygon" },
        { name: "USDC", peg: "Dollaro USA", role: "Liquidità di mercato generale", pos: "Ampio uso su exchange e DeFi, emittente regolamentato (Circle)" },
        { name: "USDT", peg: "Dollaro USA", role: "Liquidità di mercato generale", pos: "Maggiore liquidità nelle coppie di trading sugli exchange" },
        { name: "EURC", peg: "Euro", role: "Liquidità denominata in euro", pos: "Regolamento in euro per i flussi del mercato europeo" }
      ]
    }
  },
  businessModel: {
    title: "Modello di Business",
    subtitle: "Economia sostenibile per alimentare la privacy gratuita.",
    points: [
      {
        title: "Consumer Freemium",
        desc: "AlphaChat rimane gratuito per la comunicazione principale. La privacy non viene mai messa dietro un paywall."
      },
      {
        title: "Infrastruttura per Commercianti",
        desc: "AlphaBit Pay funge da motore di entrate, addebitando commissioni di routing e regolamento prevedibili per i flussi di transazioni commerciali (alphabitpay.com)."
      },
      {
        title: "Economia del Flusso di Pagamento",
        desc: "Valore catturato attraverso servizi di escrow, astrazioni automatizzate del gas ed efficienze nel regolamento transfrontaliero."
      }
    ]
  },
  swot: {
    title: "Analisi SWOT",
    s: { title: "Punti di Forza", items: ["Stack tecnologico profondamente integrato", "Profondità E2E e rigore crittografico", "Chiara visione guidata dal fondatore"] },
    w: { title: "Punti di Debolezza", items: ["Adozione in fase iniziale", "Mancanza di effetti di rete esistenti", "Onboarding complesso per i non esperti di criptovalute"] },
    o: { title: "Opportunità", items: ["Crescente domanda globale di privacy", "Adozione di massa delle stablecoin", "Rischi di de-platforming sulle reti principali"] },
    t: { title: "Minacce", items: ["Clonazione delle funzionalità da parte degli incumbent", "Quadri normativi in evoluzione", "Frizione legata alla dipendenza dai wallet"] }
  },
  roadmap: {
    title: "Roadmap Strategica",
    phases: [
      { name: "Fase 1: Fondazione", desc: "Protocollo E2E core, distribuzione PWA, sincronizzazione multi-dispositivo e integrazione USDA di base." },
      { name: "Fase 2: Crescita dell'Ecosistema", desc: "Funzionalità avanzate del Protocollo Phoenix, integrazioni più profonde di WalletConnect e acquisizione utenti." },
      { name: "Fase 3: Rete di Commercianti", desc: "Lancio degli strumenti AlphaBit Pay, link di pagamento esterni e API di escrow commerciale." },
      { name: "Fase 4: Piattaforma Aperta", desc: "SDK per sviluppatori, federazione di identità decentralizzata e livelli di regolamento cross-chain." }
    ]
  },
  closing: {
    title: "La Visione Futura",
    takeaways: [
      "Alpha aveva una visione chiara e senza compromessi per la sovranità digitale.",
      "AlphaChat risolve la frammentazione tra conversazione privata e trasferimento di valore.",
      "L'ecosistema AlphaBit fornisce la base scalabile per questo nuovo paradigma."
    ],
    linksTitle: "Link Ufficiali",
    contactTitle: "Contatti Stampa"
  }
};