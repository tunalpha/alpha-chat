export const it = {
  nav: {
    readEn: "EN",
    readIt: "IT",
    contact: "Contatti",
    download: "Scarica PDF",
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
      "USDA non è solo un token di pagamento — è la prova che il denaro può muoversi alla velocità della conversazione. Con getusda.xyz, chiunque nel mondo può richiedere o ricevere dollari digitali istantaneamente, senza banche, senza confini, senza intermediari.",
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
    subtitle: "Dollari digitali alla velocità della conversazione.",
    desc: "USDA non è una stablecoin qualsiasi — è il ponte mancante tra comunicazione privata e finanza globale. Un dollaro digitale ERC-20 costruito su Polygon, progettato come asset di regolamento nativo all'interno di AlphaChat. Mentre le app di messaggistica del mondo trattano i pagamenti come un ripensamento, noi li abbiamo integrati nel DNA di ogni conversazione.",
    features: [
      {
        title: "Motore di Escrow in Chat",
        desc: "Invia e richiedi fondi direttamente nella conversazione. Un flusso di deposito → reclamo/rilascio crittograficamente sicuro con verifica on-chain, protezione anti-replay e blocco atomico. Nessuna banca. Nessun ritardo. Nessun intermediario."
      },
      {
        title: "Wallet Non Custodial",
        desc: "Gli utenti mantengono il controllo completo e sovrano sui propri fondi. Integrazione profonda con WalletConnect/Reown — MetaMask, Rainbow, Coinbase, Trust e Phantom — così il tuo denaro è sempre tuo, non nostro."
      },
      {
        title: "Gas Station Automatizzata",
        desc: "Zero frizione blockchain. La nostra Gas Station ricarica automaticamente MATIC quando necessario, rendendo le transazioni on-chain semplici quanto inviare un messaggio. Gli utenti non toccano mai le commissioni di rete."
      },
      {
        title: "getusda.xyz — Link di Pagamento Globali",
        desc: "Richieste di pagamento che funzionano per chiunque, ovunque, senza un account AlphaChat. Condividi un link. Ricevi pagamenti in stablecoin. Nessun confine. Nessun conto bancario richiesto. Il gateway verso l'adozione di massa."
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
  market: {
    title: "Opportunità di Mercato",
    subtitle: "Tre mercati enormi. Una sola piattaforma unificata.",
    intro: "AlphaChat si trova all'intersezione di tre dei settori in più rapida crescita nell'economia digitale globale. La tempistica non è casuale — è architettonica.",
    segments: [
      {
        icon: "💬",
        label: "Messaggistica",
        stat: "3,1 mld",
        unit: "utenti attivi giornalieri",
        color: "purple",
        points: [
          "WhatsApp conta oltre 2 miliardi di utenti mensili attivi",
          "Telegram ha superato 900 milioni di utenti nel 2024",
          "Mercato globale OTT messaging proiettato a 340 miliardi di dollari entro il 2030",
          "L'85% degli utenti internet vuole maggiore privacy sui propri dati (Pew Research)",
          "Signal è cresciuto del 1.200% in una settimana durante i picchi di preoccupazione sulla privacy"
        ]
      },
      {
        icon: "💵",
        label: "Stablecoin",
        stat: "$180 mld+",
        unit: "capitalizzazione totale",
        color: "green",
        points: [
          "Il volume di transazioni stablecoin ha superato 10,8 trilioni di dollari nel 2023 — più di Visa",
          "USDT: ~115 miliardi di dollari. USDC: ~35 miliardi. Il mercato è in rapida espansione",
          "L'adozione di stablecoin cresce 3x anno su anno nei mercati emergenti (Chainalysis)",
          "Le rimesse transfrontaliere in stablecoin costano l'80-90% in meno dei bonifici tradizionali",
          "Quadri normativi (MiCA in Europa, leggi USA) stanno legittimando il commercio in stablecoin"
        ]
      },
      {
        icon: "🌐",
        label: "Pagamenti Digitali",
        stat: "$14T+",
        unit: "volume globale transazioni",
        color: "blue",
        points: [
          "Il mercato globale dei pagamenti digitali raggiungerà 29 trilioni di dollari entro il 2030 (CAGR 11,5%)",
          "Oltre 420 milioni di utenti crypto nel mondo (Triple-A, 2024), +15% all'anno",
          "Il mercato P2P dei pagamenti digitali supererà 9 trilioni di dollari entro il 2030",
          "Il mercato gateway crypto cresce a un CAGR del 16,5% (2023–2030)",
          "Il 60% di Gen Z e Millennial preferisce pagamenti digitali istantanei al sistema bancario tradizionale"
        ]
      }
    ],
    conclusion: "Nessuna piattaforma oggi cattura simultaneamente tutti e tre i livelli — comunicazione privata, regolamento in stablecoin e infrastruttura di pagamento per merchant. AlphaChat è progettato per possedere questa intersezione."
  },
  swot: {
    title: "Analisi SWOT",
    s: {
      title: "Punti di Forza",
      items: [
        "Stack tecnologico profondamente integrato — comunicazione + pagamenti in un unico ambiente sovrano",
        "Crittografia E2E di livello militare (protocollo Signal) — lo stesso standard usato dai governi",
        "USDA: stablecoin proprietaria progettata per il regolamento in-chat su Polygon",
        "Onboarding guidato — UX crypto-native che funziona per utenti comuni, non solo per esperti",
        "Chiara visione guidata dal fondatore con oltre 15 anni di profondità architetturale"
      ]
    },
    w: {
      title: "Punti di Debolezza",
      items: [
        "Adozione in fase iniziale — effetti di rete ancora in costruzione",
        "Mancanza di effetti di rete su larga scala già esistenti",
        "Dipendenza dall'ecosistema WalletConnect per le integrazioni wallet esterne"
      ]
    },
    o: {
      title: "Opportunità",
      items: [
        "Crescente domanda globale di piattaforme di comunicazione orientate alla privacy",
        "Adozione di massa delle stablecoin nei mercati emergenti e sviluppati",
        "Rischi di de-platforming che spingono utenti verso reti sovrane e indipendenti",
        "Chiarezza normativa (MiCA, quadri USA) che legittima il commercio in stablecoin",
        "Espansione di USDA via getusda.xyz nei flussi di merchant e rimesse globali"
      ]
    },
    t: {
      title: "Minacce",
      items: [
        "Clonazione delle funzionalità da parte degli incumbent (WhatsApp, Telegram, big tech)",
        "Quadri normativi frammentati e in evoluzione tra le giurisdizioni",
        "Frizione legata alla dipendenza dai wallet per utenti non-crypto"
      ]
    }
  },
  roadmap: {
    title: "Roadmap Strategica",
    subtitle: "Dove siamo stati. Dove stiamo andando.",
    phases: [
      {
        name: "Fase 1 — Fondazione ✅",
        status: "complete",
        desc: "Protocollo E2E core (Signal X3DH + Double Ratchet), distribuzione PWA, sincronizzazione multi-dispositivo, notifiche push VAPID e integrazione iniziale del wallet USDA. Le fondamenta sono live."
      },
      {
        name: "Fase 2 — Fortezza della Sicurezza ✅",
        status: "complete",
        desc: "Protocollo Phoenix (blocco/distruzione emergenza account), autenticazione biometrica (Face ID), Recovery Cards, Dead Man Switch, verifica identità multi-dispositivo, Safety Numbers e audit completo della timeline di sicurezza."
      },
      {
        name: "Fase 3 — Infrastruttura di Pagamento ✅",
        status: "complete",
        desc: "Motore escrow in-chat completo (deposito → reclamo/rilascio con verifica on-chain), Gas Station automatizzata con ricariche MATIC dinamiche, link di pagamento globali getusda.xyz, rail merchant AlphaBit Pay e protezione anti-replay."
      },
      {
        name: "Fase 4 — Espansione USDA 🔄",
        status: "active",
        desc: "Integrazioni off-ramp e on-ramp USDA per la conversione in valuta fiat, ecosistema di link di pagamento esteso tramite getusda.xyz, routing multi-stablecoin e API pubblica USDA per integrazioni di terze parti. Trasformare USDA in una primitiva finanziaria aperta."
      },
      {
        name: "Fase 5 — Crescita della Rete",
        status: "upcoming",
        desc: "Campagne strutturate di acquisizione utenti per i segmenti privacy-first, onboarding commerciale merchant AlphaBit Pay, partnership con operatori fintech e corridoi di rimesse transfrontaliere, traguardo di 100K utenti attivi."
      },
      {
        name: "Fase 6 — Piattaforma Aperta",
        status: "upcoming",
        desc: "SDK per sviluppatori e API aperte, federazione di identità decentralizzata, livelli di regolamento cross-chain oltre Polygon e framework di governance dell'ecosistema AlphaBit. La piena infrastruttura sovrana di comunicazione e pagamento per l'internet aperto."
      }
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
