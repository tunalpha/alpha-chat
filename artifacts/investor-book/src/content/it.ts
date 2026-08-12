export const it = {
  nav: {
    readEn: "EN",
    readIt: "IT",
    contact: "Contatti",
    download: "Scarica PDF",
  },
  cover: {
    title: "AlphaChat",
    badge: "Investor Book 2026",
    subtitle: "Comunicazione privata zero-knowledge. Wallet self-custodial multi-chain. Pagamenti on-chain nativi. Un unico ecosistema sovrano.",
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
      { title: "Semplicità", desc: "La tecnologia deve eliminare la complessità, non crearla." },
      { title: "Sicurezza", desc: "Protezione dei dati e privacy integrate fin dalle fondamenta dell'architettura." },
      { title: "Visione di lungo periodo", desc: "Piattaforme progettate per evolversi senza mai perdere affidabilità." }
    ],
    quote: "La tecnologia non dovrebbe mai sostituire le relazioni umane. Dovrebbe renderle più sicure, più semplici e più libere."
  },
  founderLetter: {
    title: "Lettera del Fondatore",
    greeting: "Ai nostri futuri partner,",
    paragraphs: [
      "Ho iniziato a costruire AlphaChat perché il modo in cui comunichiamo digitalmente è fondamentalmente rotto. Abbiamo accettato una realtà in cui le nostre conversazioni più intime vengono analizzate per estrarre dati, in cui l'identità digitale viene affittata anziché posseduta, e in cui inviare valore a un amico richiede di uscire dalla conversazione per utilizzare un sistema finanziario disconnesso e spesso arcaico.",
      "Oggi, AlphaChat non è più solo una promessa architettonica — è una piattaforma completa, operativa e in produzione. Abbiamo ingegnerizzato e distribuito: crittografia end-to-end Signal con sessioni per-dispositivo, un wallet HD self-custodial multi-chain (Polygon, Ethereum, BSC, Bitcoin), un motore di pagamento escrow su quattro blockchain con gas abstraction dinamica, e un'architettura zero-knowledge in cui il server non ha mai accesso né ai messaggi né alle chiavi crittografiche degli utenti.",
      "Il livello di comunicazione e il livello transazionale sono finalmente lo stesso spazio. Ogni messaggio è crittografato con X3DH + Double Ratchet. Ogni frase seme è generata localmente con BIP-39 e non lascia mai il dispositivo dell'utente. Ogni transazione è firmata client-side con la chiave privata dell'utente, mai esposta ai nostri server.",
      "USDA è il punto di partenza — ma abbiamo costruito il motore per qualsiasi asset, su qualsiasi chain. Polygon, Ethereum, BSC, Bitcoin: quattro reti, un'unica interfaccia di conversazione. Con getusda.xyz, chiunque nel mondo può richiedere o ricevere valore digitale istantaneamente, senza banche, senza confini, senza intermediari.",
      "L'ecosistema AlphaBit è progettato per il lungo termine. Si fonda sulla convinzione che la privacy sia un diritto, non una funzionalità, e che i pagamenti appartengano al luogo in cui nascono le relazioni: all'interno della conversazione.",
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
        title: "L'Identità Self-Sovereign",
        desc: "L'identità si sta spostando dai database centralizzati all'auto-sovranità crittografica. Gli utenti richiedono il controllo su chi sono online, su chi può accedere ai loro dati, e su dove risiedono le loro chiavi."
      },
      {
        title: "I Pagamenti Appartengono alla Conversazione",
        desc: "Il trasferimento di valore è essenzialmente una forma di comunicazione. Spostare denaro dovrebbe essere istantaneo, sicuro e nativo in un'interfaccia di chat quanto l'invio di un messaggio di testo — e su qualsiasi blockchain."
      }
    ]
  },
  product: {
    title: "Il Prodotto: AlphaChat",
    subtitle: "Un'applicazione unificata progettata per una privacy senza compromessi, trasferimento di valore integrato e wallet self-custodial su quattro blockchain.",
    facts: [
      {
        title: "Crittografia End-to-End",
        desc: "Signal Protocol: X3DH per l'accordo di sessione asincrono, Double Ratchet per il forward secrecy per-messaggio, prekeys monouso (OTPK) per sessioni offline. Sessioni rigorosamente per-dispositivo con fan-out crittografico."
      },
      {
        title: "Media e Storage Crittografati",
        desc: "Media E2E: AES-256-GCM per blob, chiavi wrapped in sessione Signal. Storage su Cloudflare R2 con upload multipart e signed URL. Cache locale crittografata con thumbnail E2E. Il server vede solo blob cifrati opachi."
      },
      {
        title: "Identità e Fiducia",
        desc: "TOFU (Trust On First Use) con Safety Numbers a 60 cifre. Verifica tramite codice QR, avvisi automatici di key-change, gestione multi-dispositivo con revoca granulare."
      },
      {
        title: "Chiamate Vocali Sicure",
        desc: "WebRTC con segnalazione crittografata, ICE restart su cambio rete, verifica della chiamata rispetto al key bundle crittografico (CallVerifyModal), call log crittografato, busy detection in-memory."
      },
      {
        title: "Chat di Gruppo E2E",
        desc: "Crittografia end-to-end completa via architettura fan-out Signal per-membro. Ogni messaggio di gruppo è crittografato individualmente per ogni device di ogni partecipante."
      },
      {
        title: "Resilienza dell'Account",
        desc: "Recovery Card auto-generata (argon2id), Phoenix Protocol (codice emergenza argon2id, modalità lock/destroy), Dead Man Switch, Emergency Portal /emergency, audit timeline sicurezza completo."
      },
      {
        title: "Progressive Web App",
        desc: "Installabile, offline-tolerant, notifiche push VAPID, localizzata in 10 lingue, session persistence biometrica, mutex anti-race condition sul refresh token."
      },
      {
        title: "Posizione Zero-Knowledge",
        desc: "Il server agisce come relè cieco. Non ha mai accesso al testo in chiaro dei messaggi, alle frasi seme degli utenti, né alle chiavi private. Anche sotto coercizione legale, non esistono dati decifrabili da consegnare."
      }
    ]
  },
  kpi: {
    title: "Specifiche Tecniche",
    subtitle: "Costruito per durare.",
    items: [
      { label: "Protocollo E2E", value: "Signal" },
      { label: "Accordo Chiavi", value: "X3DH" },
      { label: "Forward Secrecy", value: "Double Ratchet" },
      { label: "Cifratura Media", value: "AES-256-GCM" },
      { label: "Blockchain", value: "4 reti" },
      { label: "HD Wallet Standard", value: "BIP-39/44" },
      { label: "Curve EVM", value: "secp256k1" },
      { label: "Bitcoin", value: "Native SegWit" },
      { label: "Lingue", value: "10" },
      { label: "Storage Media", value: "R2 (Cloudflare)" },
      { label: "PWA", value: "Offline-first" },
      { label: "Identità", value: "argon2id" },
    ]
  },
  security: {
    title: "Architettura Zero-Knowledge",
    subtitle: "Il server non può leggere i tuoi messaggi. Fisicamente impossibile by design.",
    guarantee: "AlphaChat è progettato in modo che nessun dipendente, nessun amministratore, e nessuna autorità governativa possa mai accedere al contenuto delle conversazioni o alle chiavi crittografiche degli utenti — non per scelta politica, ma per impossibilità matematica.",
    pillars: [
      {
        title: "Signal Protocol — Crittografia a Doppio Strato",
        badge: "X3DH + Double Ratchet",
        desc: "Ogni messaggio è cifrato due volte: una volta con la chiave di sessione Signal derivata tramite X3DH (Extended Triple Diffie-Hellman), e poi con la chiave di ratchet aggiornata ad ogni messaggio tramite Double Ratchet Algorithm. Il server riceve e trasmette solo il ciphertext finale — mai in grado di invertire la cifratura senza le chiavi private del destinatario.",
        specs: ["X3DH: accordo di sessione asincrono con 4 coppie di chiavi DH","Double Ratchet: forward secrecy + break-in recovery per ogni messaggio","Prekeys monouso (OTPK): ogni sessione usa una chiave usa-e-getta","Sessioni per-dispositivo: fan-out crittografico indipendente su ogni device"]
      },
      {
        title: "Seed Phrase — Mai Fuori dal Dispositivo",
        badge: "BIP-39 · Client-Side Only",
        desc: "La frase mnemonica BIP-39 (12 o 24 parole) viene generata interamente nel browser dell'utente tramite entropia crittograficamente sicura (crypto.getRandomValues). Non viene mai trasmessa, mai inviata al server, mai registrata in log. Viene immediatamente cifrata con AES-256-GCM usando una chiave derivata dal PIN utente e salvata in IndexedDB locale.",
        specs: ["BIP-39 mnemonic: 128/256 bit di entropia CSPRNG","Cifratura locale: AES-256-GCM con IV casuale per ogni scrittura","PIN seal: chiave AES esportata, cifrata con PIN via PBKDF2","Biometric seal: chiave AES sigillata con WebAuthn/Face ID, sbloccata solo dopo verifica biometrica","Zero trasmissione: la rete non vede mai la mnemonica né la chiave privata derivata"]
      },
      {
        title: "Chiavi Private — Zeroing Immediato in Memoria",
        badge: "Memory-Safe Signing",
        desc: "Quando l'utente autorizza una transazione, la chiave privata viene derivata dalla mnemonica, usata per firmare la transazione, e immediatamente azzerata in memoria (operazione in blocco try/finally). La firma avviene interamente client-side. Il server riceve solo la transazione già firmata, mai la chiave.",
        specs: ["Derivazione in-place: secp256k1 per EVM, P2WPKH per Bitcoin","Signing offline: la chiave privata non tocca mai la rete","try/finally zeroing: override della variabile con zeri subito dopo la firma","Nessun log, nessun trace: il processo di firma è air-gapped dalla telemetria"]
      },
      {
        title: "Server — Relè Cieco",
        badge: "Zero Plaintext",
        desc: "Il backend API gestisce solo envelope cifrati. MongoDB archivia documenti con ciphertext opachi (non ha schema per il plaintext dei messaggi). Cloudflare R2 archivia blob cifrati AES-256-GCM senza chiavi. Il WebSocket server instrada i pacchetti Signal senza capacità di ispezione. Anche un accesso non autorizzato ai database non produce plaintext leggibile.",
        specs: ["MongoDB: archivia solo `{ ciphertext: base64, iv: ... }` per ogni messaggio","R2: blob cifrati con AES-GCM; la chiave di blob è wrapped nel payload Signal","WebSocket: routing cieco su userId — nessun contenuto ispezionato","Nessun plaintext in RAM del server in alcun code path"]
      },
      {
        title: "Phoenix Protocol — Autodifesa dell'Account",
        badge: "argon2id · Emergency Destroy",
        desc: "In caso di coercizione o sequestro del dispositivo, il Phoenix Protocol permette all'utente di attivare la distruzione immediata e irreversibile di tutte le chiavi e i dati locali tramite un codice di emergenza derivato con argon2id (parametri di sicurezza massima: memoria 64MB, iterazioni 4, parallelismo 2). Una volta attivato, nessuna tecnica forense può recuperare i dati.",
        specs: ["Codice Phoenix: argon2id con salt casuale da 32 byte","Lock mode: blocco immediato di tutte le sessioni attive","Destroy mode: sovrascrittura e cancellazione di IndexedDB + localStorage","Emergency Portal: accessibile via URL dedicato anche con app in lock mode","Dead Man Switch: attivazione automatica su assenza prolungata"]
      },
      {
        title: "Safety Numbers — Verifica dell'Identità",
        badge: "60-digit Fingerprint",
        desc: "La Safety Number è un fingerprint crittografico a 60 cifre calcolato dalla composizione delle identity key pubbliche dei due interlocutori. Permette la verifica out-of-band dell'identità: se due utenti leggono lo stesso numero, la comunicazione è garantita point-to-point senza man-in-the-middle. Identico allo standard Signal.",
        specs: ["Derivazione: HKDF-SHA256 su identità pubblica composita","60 cifre decimali raggruppate in blocchi da 5","Verifica tramite QR code o lettura vocale","Key-change alert automatico se l'identity key del contatto cambia"]
      }
    ]
  },
  alphaWallet: {
    title: "Alpha Wallet",
    subtitle: "Il tuo denaro, matematicamente tuo. Su quattro blockchain.",
    desc: "Alpha Wallet è un wallet HD (Hierarchical Deterministic) self-custodial integrato nativamente in AlphaChat. Non è un wrapper attorno a un wallet di terze parti — è un'implementazione crittografica completa, costruita da zero con gli standard BIP-39, BIP-44 e BIP-84, con supporto nativo per Polygon, Ethereum, BSC e Bitcoin. Le chiavi private non lasciano mai il dispositivo.",
    securityTitle: "Sicurezza Crittografica",
    security: [
      {
        title: "BIP-39 Mnemonic Generation",
        spec: "128–256 bit · CSPRNG",
        desc: "La frase seme viene generata con entropia crittograficamente sicura tramite Web Crypto API (crypto.getRandomValues). L'entropia viene mappata sulle 2048 parole del wordlist BIP-39 standard. Non viene mai trasmessa al server."
      },
      {
        title: "BIP-44 Hierarchical Derivation",
        spec: "m/44'/coin_type'/0'/0/index",
        desc: "I percorsi di derivazione seguono lo standard BIP-44 con coin_type specifico per rete (60' per EVM, 0' per Bitcoin). Dalla singola mnemonica si derivano indirizzi per tutte le reti supportate senza mai trasmettere la root key."
      },
      {
        title: "secp256k1 — Curve EVM",
        spec: "Polygon · Ethereum · BSC",
        desc: "Le chiavi private EVM sono scalari secp256k1. Gli indirizzi pubblici sono derivati con keccak256 della chiave pubblica compressa. La firma delle transazioni avviene interamente client-side con @scure/bip39 + viem prima dell'invio al nodo RPC."
      },
      {
        title: "P2WPKH — Bitcoin Native SegWit",
        spec: "bech32 · BIP-84",
        desc: "Gli indirizzi Bitcoin sono Native SegWit (bech32, bc1...) derivati con BIP-84. Le transazioni Bitcoin usano PSBT (Partially Signed Bitcoin Transaction) con bigint nativo per la gestione dei satoshi, con dustlimit enforcement a 546 sat."
      },
      {
        title: "AES-256-GCM Local Encryption",
        spec: "IndexedDB · try/finally zeroing",
        desc: "La mnemonica è cifrata con AES-256-GCM prima di essere salvata in IndexedDB. La chiave AES è derivata dal PIN utente. Ogni scrittura usa un IV casuale da 12 byte. La chiave privata derivata è azzerata in memoria immediatamente dopo la firma."
      },
      {
        title: "Biometric Seal (Face ID)",
        spec: "WebAuthn · AES-GCM Sealed",
        desc: "Il PIN può essere sigillato con Face ID via WebAuthn. La chiave AES è cifrata con la credenziale biometrica e salvata in localStorage. Solo una verifica biometrica positiva sblocca il PIN — mai esposto in chiaro."
      }
    ],
    chainsTitle: "Blockchain Supportate",
    chains: [
      { name: "Polygon PoS", symbol: "MATIC / USDT / USDC", icon: "🔵", desc: "Chain principale. Settlement in <2s, gas bassissimo, ERC-20 nativo per USDA/USDT/USDC." },
      { name: "Ethereum L1", symbol: "ETH / USDT / USDC", icon: "⬡", desc: "Layer 1. ERC-20 e native ETH, gas dinamico con previsione EIP-1559." },
      { name: "Binance Smart Chain", symbol: "BNB / USDT / USDC", icon: "🟡", desc: "BSC con USDT a 18 decimali. Fee bassissima, alta adozione Asia." },
      { name: "Bitcoin", symbol: "BTC", icon: "🟠", desc: "UTXO nativo con PSBT, Native SegWit, selezione coin ottimizzata, fee dinamica on-chain." }
    ],
    platformFeeTitle: "Modello di Fee",
    platformFeeDesc: "Alpha Wallet genera ricavo attraverso una piattaform fee applicata sulle transazioni self-custodial. La fee è calcolata come percentuale dell'importo inviato, con floor minimo per Bitcoin (546 sat dust limit). Il flusso è completamente trasparente: l'utente vede fee, importo netto e quote prima della firma."
  },
  multiChain: {
    title: "Multi-Chain Payment Engine",
    subtitle: "Escrow on-chain su quattro blockchain con gas abstraction dinamica.",
    desc: "Il Multi-Chain Payment Engine è il cuore transazionale di AlphaChat. Un motore di stato puro che gestisce il ciclo di vita completo di ogni trasferimento — dalla generazione del deposito address alla liquidazione finale — su Polygon, Ethereum, BSC e Bitcoin. Ogni stato è persistito atomicamente su MongoDB. Ogni transazione è verificata on-chain prima del rilascio.",
    stateMachine: [
      { state: "awaiting_deposit", desc: "Indirizzo di deposito generato. In attesa del bonifico on-chain dal mittente." },
      { state: "deposit_detected", desc: "Deposito confermato on-chain tramite verifica receipt/getLogs. Anti-replay attivo." },
      { state: "releasing", desc: "Transazione di rilascio firmata e inviata. Gas Station ha garantito i fondi MATIC." },
      { state: "released", desc: "Fondi accreditati al destinatario. TX hash e block number registrati per audit." },
      { state: "refunded", desc: "Rimborso al mittente in caso di scadenza o anomalia. Sweep automatico schedulato." },
      { state: "waiting_for_gas", desc: "Gas Reserve Protection: riserva MATIC insufficiente. Scheduler attende il ripristino." }
    ],
    featuresTitle: "Caratteristiche Tecniche",
    features: [
      {
        title: "Gas Station Dinamica",
        desc: "La Gas Station monitora la riserva MATIC in tempo reale. Il top-up è calcolato dinamicamente: gas_stimato × gasPrice × safety_buffer, con cap a 0.5 MATIC per operazione. Nessun importo fisso — la formula si adatta alla volatilità del gas."
      },
      {
        title: "Quote Mode & Recipient-Exact",
        desc: "Il mittente può scegliere la modalità: sender_exact (lui paga l'importo specificato, il destinatario riceve meno fee) oppure recipient_exact (il destinatario riceve esattamente l'importo, le fee sono a carico del mittente). La fee è calcolata con BigInt ceiling per zero-loss."
      },
      {
        title: "Bitcoin UTXO + PSBT",
        desc: "Per Bitcoin, il motore costruisce PSBT (Partially Signed Bitcoin Transaction) usando bitcoinjs-lib v7 con bigint nativo. Selezione UTXO ottimizzata con coin-selection algorithm. Fee floor a 546 sat (dust limit). Fee dinamica dal mempool."
      },
      {
        title: "Dynamic Network Fee EVM",
        desc: "Le network fee EVM sono calcolate server-side in tempo reale: gasPrice × gasStimato × nativeAssetPrice in USD (CoinGecko), con safety margin configurabile per admin. Ogni quote è frozen per 60 secondi per protezione volatilità."
      },
      {
        title: "Anti-Replay & Atomic Lock",
        desc: "Ogni trasferimento ha un nonce univoco. Il lock atomico su MongoDB (findOneAndUpdate con condition) previene double-spend e race condition anche in ambienti multi-processo. Il recover scheduler riprende automaticamente i trasferimenti in stato anomalo."
      },
      {
        title: "Cancel-Stale & Recovery",
        desc: "Trasferimenti senza deposito dopo 30 minuti vengono cancellati automaticamente. Fondi in pending vengono recuperati tramite sweep al fee wallet. Il recovery scheduler gestisce anche transazioni bloccate con hash di rilascio già registrato (no-rollback policy)."
      }
    ]
  },
  paymentLayer: {
    title: "USDA — Il Livello di Pagamento",
    subtitle: "Dollari digitali alla velocità della conversazione.",
    desc: "USDA è il token di regolamento nativo dell'ecosistema AlphaBit su Polygon. Un ERC-20 ottimizzato per micro-transazioni in-chat, con un pipeline completo: escrow on-chain, verifica tramite Alchemy getLogs, release automatico via Gas Station, e link di pagamento globali via getusda.xyz. Reown AppKit (ex WalletConnect v3) integra MetaMask, Rainbow, Coinbase, Trust e Phantom in un click.",
    features: [
      {
        title: "Motore di Escrow in Chat",
        desc: "Flusso: deposito → verifica on-chain (Alchemy alchemy_getAssetTransfers) → rilascio atomico → liquidazione. Anti-replay con nonce on-chain. Lock atomico MongoDB. Verifica block number + tx hash per ogni stato."
      },
      {
        title: "Reown AppKit — Wallet Non-Custodial",
        desc: "Integrazione nativa con Reown AppKit (ex WalletConnect v3) + wagmi v3 + viem. L'utente connette MetaMask, Rainbow, Coinbase Wallet, Trust o Phantom in un click. I fondi non passano mai per i nostri wallet custodial — firmano direttamente dal wallet dell'utente."
      },
      {
        title: "Gas Station Automatizzata",
        desc: "Zero frizione blockchain per l'utente. La Gas Station calcola e ricarica MATIC dinamicamente prima di ogni operazione di rilascio. L'algoritmo considera gasPrice in tempo reale, stima del gas per la transazione e safety buffer configurabile."
      },
      {
        title: "getusda.xyz — Link di Pagamento Globali",
        desc: "Richieste di pagamento via requesterWallet Polygon. Risposta con shareLink condivisibile ovunque. Chiunque nel mondo può pagare senza account AlphaChat. Claim via POST /api/pay/claim/{code} con verifica on-chain della transazione."
      }
    ]
  },
  ecosystem: {
    title: "L'Ecosistema: AlphaBit",
    subtitle: "Un unico stack coerente.",
    desc: "AlphaBit è l'ecosistema. AlphaChat è l'interfaccia consumer di punta. USDA è il livello di pagamento nativo. Alpha Wallet è il layer self-custodial multi-chain. AlphaBit Pay è l'infrastruttura per i commercianti. Non competono; si integrano.",
    labels: {
      user: "Utente",
      alphaChat: "AlphaChat",
      usda: "USDA · Alpha Wallet",
      alphaBitPay: "AlphaBit Pay",
      merchants: "Commercianti"
    }
  },
  architecture: {
    title: "Architettura di Sistema",
    subtitle: "Crittografia edge. Relè ciechi. Regolamento multi-chain decentralizzato.",
    labels: {
      clients: "Client (PWA Multi-dispositivo)",
      e2e: "Signal Protocol Layer (X3DH · Double Ratchet · AES-256-GCM)",
      backend: "Backend API + WebSocket (Blind Relay)",
      db: "MongoDB (ciphertext) + Cloudflare R2 (blob cifrati)",
      blockchain: "Multi-Chain: Polygon · Ethereum · BSC · Bitcoin"
    },
    layers: [
      { name: "Client Layer", detail: "React PWA · BIP-39/44 wallet · IndexedDB cifrata · WebCrypto API" },
      { name: "Signal E2E Layer", detail: "X3DH · Double Ratchet · OTPK · per-device sessions · sealed sender" },
      { name: "Relay Layer", detail: "Node.js API + WS · blind routing · nessun plaintext in RAM" },
      { name: "Storage Layer", detail: "MongoDB (ciphertext docs) · Cloudflare R2 (AES-GCM blobs) · signed URL" },
      { name: "Blockchain Layer", detail: "Polygon PoS · Ethereum L1 · BSC · Bitcoin UTXO · Gas Station" },
    ]
  },
  competitive: {
    title: "Panorama Competitivo",
    subtitle: "Posizionamento attraverso scelte architettoniche oggettive.",
    messaging: {
      title: "Piattaforme di Messaggistica",
      columns: ["Piattaforma", "E2E Default", "Server Zero-KW", "Pagamenti Nativi", "Wallet Self-Custodial", "Recovery Self-Sovereign"],
      rows: [
        { name: "AlphaChat", e2e: "✓ Signal", zk: "✓ Sì", pay: "✓ 4 chain", wallet: "✓ BIP-39/44", rec: "✓ Phoenix/Card" },
        { name: "Signal", e2e: "✓ Signal", zk: "✓ Sì", pay: "Limitato", wallet: "✗ No", rec: "PIN-based" },
        { name: "WhatsApp", e2e: "✓ Signal", zk: "✗ Meta", pay: "Fiat regionale", wallet: "✗ No", rec: "✗ Cloud backup" },
        { name: "Telegram", e2e: "✗ Opt-in", zk: "✗ No", pay: "TON integr.", wallet: "✗ No", rec: "✗ Centralizzato" },
        { name: "iMessage", e2e: "✓ Sì", zk: "✗ Apple", pay: "Apple Pay fiat", wallet: "✗ No", rec: "✗ iCloud" }
      ]
    },
    payments: {
      title: "Elaboratori di Pagamento",
      desc: "I processori tradizionali operano su rail centralizzati e checkout page separati dalla comunicazione. AlphaChat porta il trasferimento di valore nativamente dentro la conversazione, su quattro blockchain, con escrow crittografico.",
      columns: ["Operatore", "Blockchain", "Escrow On-chain", "Integrazione Chat", "Self-Custodial"],
      rows: [
        { name: "AlphaChat / AlphaBit Pay", chain: "Polygon·ETH·BSC·BTC", escrow: "✓ On-chain", chat: "✓ Nativo", custody: "✓ Sì" },
        { name: "Stripe", chain: "✗ Fiat only", escrow: "✗ No", chat: "✗ Esterno", custody: "✗ No" },
        { name: "PayPal", chain: "✗ Fiat + crypto", escrow: "✗ No", chat: "✗ Adiacente", custody: "✗ Custodial" },
        { name: "Coinbase Commerce", chain: "Multi-chain", escrow: "✗ No", chat: "✗ No", custody: "✗ Custodial" },
        { name: "Lightning (BTC)", chain: "Bitcoin L2", escrow: "✓ HTLC", chat: "✗ Esterno", custody: "✓ Sì" }
      ]
    },
    stablecoins: {
      title: "Settlement in Stablecoin",
      desc: "USDA è ottimizzato come token di regolamento nativo dell'ecosistema, ma il motore multi-chain supporta qualsiasi ERC-20 su Polygon, Ethereum e BSC, inclusi USDT e USDC natively.",
      columns: ["Asset", "Chain", "Ruolo", "Supporto AlphaChat"],
      rows: [
        { name: "USDA", chain: "Polygon", role: "Regolamento nativo eco.", pos: "✓ Nativo — escrow in-chat" },
        { name: "USDT", chain: "Polygon·ETH·BSC", role: "Liquidità mercato", pos: "✓ Multi-chain supportato" },
        { name: "USDC", chain: "Polygon·ETH·BSC", role: "Liquidità mercato", pos: "✓ Multi-chain supportato" },
        { name: "BTC", chain: "Bitcoin mainnet", role: "Store of value", pos: "✓ Native UTXO · SegWit" }
      ]
    }
  },
  businessModel: {
    title: "Business Plan & Modello di Revenue",
    subtitle: "Cinque fonti di ricavo strutturate su un'unica piattaforma integrata.",
    points: [
      {
        title: "Platform Fee — Alpha Wallet",
        desc: "Fee percentuale su ogni transazione self-custodial inviata tramite Alpha Wallet. Applicata come percentuale dell'importo con floor minimo per BTC (546 sat). Revenue ricorrente proporzionale al volume di transazioni sulla piattaforma."
      },
      {
        title: "Merchant Infrastructure — AlphaBit Pay",
        desc: "AlphaBit Pay addebita commissioni di routing e settlement prevedibili per i flussi di transazioni commerciali. Merchant onboarding con dashboard dedicata, API di integrazione e reportistica in tempo reale."
      },
      {
        title: "Escrow Service Fee — USDA Engine",
        desc: "Il motore USDA applica una micro-fee sui flussi di escrow in-chat. Gas abstraction automatizzata (la Gas Station ricarica MATIC a spese della piattaforma) valorizza il servizio come premium rispetto ai trasferimenti diretti."
      },
      {
        title: "Gas Abstraction Premium",
        desc: "L'astrazione totale del gas (l'utente non tocca mai MATIC/ETH/BNB per le fee) è un valore premium. La piattaforma gestisce il top-up automatico e recupera il costo con margine nelle fee di transazione."
      },
      {
        title: "Open API & SDK (Fase 6)",
        desc: "Nella fase di Open Platform, l'accesso all'infrastruttura AlphaBit tramite API e SDK genererà revenue da developer/enterprise su modello SaaS a livelli di utilizzo."
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
        label: "Messaggistica Sicura",
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
        icon: "₿",
        label: "Crypto & Stablecoin",
        stat: "$180 mld+",
        unit: "capitalizzazione stablecoin",
        color: "green",
        points: [
          "Il volume di transazioni stablecoin ha superato 10,8 trilioni di dollari nel 2023 — più di Visa",
          "Oltre 420 milioni di utenti crypto nel mondo (+15% YoY)",
          "Bitcoin: 1,3 trilioni market cap, asset digitale più liquido al mondo",
          "Le rimesse transfrontaliere in stablecoin costano l'80-90% meno dei bonifici tradizionali",
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
          "Il mercato P2P dei pagamenti digitali supererà 9 trilioni di dollari entro il 2030",
          "Il mercato gateway crypto cresce a un CAGR del 16,5% (2023–2030)",
          "Il 60% di Gen Z e Millennial preferisce pagamenti digitali istantanei al sistema bancario tradizionale",
          "Self-custodial wallets: crescita 3x YoY per la quota di utenti non-exchange"
        ]
      }
    ],
    conclusion: "Nessuna piattaforma oggi cattura simultaneamente comunicazione privata zero-knowledge, wallet self-custodial multi-chain e infrastruttura di pagamento escrow per merchant. AlphaChat è progettato per possedere questa intersezione."
  },
  swot: {
    title: "Analisi SWOT",
    s: {
      title: "Punti di Forza",
      items: [
        "Stack tecnico completamente integrato: Signal E2E + HD wallet BIP-39/44 + escrow multi-chain in un'unica app",
        "Zero-knowledge by design: server fisicamente impossibilitato a leggere messaggi o accedere a chiavi",
        "Multi-chain nativo: Polygon, Ethereum, BSC, Bitcoin in un'unica interfaccia",
        "Platform fee model auto-scalante: revenue proporzionale al volume senza dipendenza da abbonamenti",
        "Resilienza estrema dell'account: Phoenix Protocol, Recovery Card, Dead Man Switch, Safety Numbers",
        "UX progressiva: da utente non-crypto a wallet self-custodial senza frizione tecnica"
      ]
    },
    w: {
      title: "Punti di Debolezza",
      items: [
        "Adozione in fase iniziale — effetti di rete ancora in costruzione",
        "Complessità tecnica che richiede educazione utente sul concetto di self-custody",
        "Dipendenza dai nodi RPC pubblici/Alchemy per le query on-chain"
      ]
    },
    o: {
      title: "Opportunità",
      items: [
        "Crescente domanda globale di piattaforme di comunicazione privacy-first post-legislazione sorveglianza",
        "Adozione di massa delle stablecoin nei mercati emergenti (LATAM, Africa, SEA)",
        "Bitcoin mainstream: 1 miliardo di utenti potenziali con bisogno di wallet semplice e sicuro",
        "Chiarezza normativa (MiCA, SAB 121) che legittima il commercio in crypto embedded in app",
        "Espansione SDK/API: l'infrastruttura AlphaBit come B2B platform per fintech"
      ]
    },
    t: {
      title: "Minacce",
      items: [
        "Clonazione delle funzionalità da parte degli incumbent (WhatsApp, Telegram, iMessage)",
        "Volatilità normativa su crypto in alcune giurisdizioni",
        "Frizione della self-custody per utenti non-tech (perdita seed phrase)"
      ]
    }
  },
  roadmap: {
    title: "Roadmap Strategica",
    subtitle: "Sette sprint completati. Due fasi in corso.",
    phases: [
      {
        name: "Fase 1 — Fondazione E2E ✅",
        status: "complete",
        desc: "Signal Protocol completo: X3DH, Double Ratchet, prekeys monouso, sessioni per-dispositivo, fan-out multi-device. PWA installabile, VAPID push, 10 lingue. Le fondamenta crittografiche sono live e in produzione."
      },
      {
        name: "Fase 2 — Fortezza della Sicurezza ✅",
        status: "complete",
        desc: "Phoenix Protocol (lock/destroy emergenza, argon2id), Recovery Card auto-generata, Dead Man Switch, autenticazione biometrica Face ID, Safety Numbers, verifica QR identità, Emergency Portal, audit timeline sicurezza completo."
      },
      {
        name: "Fase 3 — Infrastruttura USDA ✅",
        status: "complete",
        desc: "Motore escrow USDA completo: deposito → verifica on-chain → rilascio atomico. Gas Station con ricariche MATIC dinamiche. Link di pagamento globali getusda.xyz. Rail merchant AlphaBit Pay. Anti-replay, lock atomico MongoDB."
      },
      {
        name: "Fase 4 — Media, Chiamate & Storage ✅",
        status: "complete",
        desc: "Migrazione media su Cloudflare R2 (upload multipart, signed URL). WebRTC chiamate vocali sicure con ICE restart, call verification, call monitor admin. Sticker animati Lottie cifrati E2E. Cache media locale cifrata."
      },
      {
        name: "Fase 5 — Alpha Wallet Self-Custodial ✅",
        status: "complete",
        desc: "Wallet HD BIP-39/44 multi-chain (Polygon, ETH, BSC, Bitcoin Native SegWit). Balance on-chain in tempo reale, invio EVM + PSBT Bitcoin, storico transazioni, QR ricezione. Platform fee model. Chat Wallet Bridge per pagamenti in-chat self-custodial. Recipient discovery."
      },
      {
        name: "Fase 6 — Multi-Chain Payment Engine ✅",
        status: "complete",
        desc: "Motore escrow esteso a 4 chain: Polygon, Ethereum, BSC, Bitcoin UTXO. State machine pura con 6 stati. Dynamic network fee (CoinGecko real-time). Quote mode recipient-exact/sender-exact. Admin Multi-Chain Monitor. Gas Reserve Protection. Cancel-stale scheduler. 626+ test unitari."
      },
      {
        name: "Fase 7 — UX, Personalizzazione & Ottimizzazione ✅",
        status: "complete",
        desc: "i18n completo in 10 lingue (IT, EN, ES, FR, DE, PT, JA, ZH, AR, RU). Temi, accenti e personalizzazione UI. Emoji picker ottimizzato iOS. Sticker animati Google Noto. PWA session persistence e biometric-only lock. R2 Monitor admin con cost forecast."
      },
      {
        name: "Fase 8 — Network Growth 🔄",
        status: "active",
        desc: "Campagne strutturate di acquisizione utenti per i segmenti privacy-first. Onboarding commerciale merchant AlphaBit Pay. Partnership con operatori fintech. Corridoi di rimesse transfrontalieri. Obiettivo qualitativo: 100K utenti attivi."
      },
      {
        name: "Fase 9 — Open Platform",
        status: "upcoming",
        desc: "SDK per sviluppatori e API aperte per integrazioni B2B. Federazione di identità decentralizzata. Settlement cross-chain via bridge attestati. Framework di governance AlphaBit. La piena infrastruttura sovrana di comunicazione e pagamento per l'internet aperto."
      }
    ]
  },
  heroPrivate: {
    badge: "Signal Protocol · X3DH + Double Ratchet",
    headline: "Conversazioni private.",
    headline2: "Protette by design.",
    sub: "Ogni messaggio è crittografato con Signal Protocol. Il server è un relè cieco — non ha mai accesso al plaintext, per design matematico.",
    chat: [
      { side: "left",  text: "Hai revisionato il contratto?" },
      { side: "right", text: "Sì — tutto in ordine. Procediamo." },
      { side: "left",  text: "Ti mando il pagamento adesso." },
      { side: "right", text: "Ricevuto. Grazie!", usda: false },
    ],
    lock: "Crittografato end-to-end",
  },
  heroPayment: {
    badge: "USDA · Polygon · Multi-Chain",
    headline: "Il denaro si muove alla",
    headline2: "velocità di una conversazione.",
    tagline: ["Nessuna banca.", "Nessun confine.", "Nessuna attesa."],
    sub: "Invia stablecoin direttamente in chat. Escrow crittografico on-chain. Verifica Alchemy. Firma self-custodial.",
    amount: "+$250 USDA",
    status: "Pagamento completato",
    escrow: "Escrow On-chain",
  },
  heroTransfer: {
    badge: "Polygon · Ethereum · BSC · Bitcoin",
    headline: "Invia. Ricevi.",
    headline2: "Su quattro blockchain.",
    sub: "Escrow crittograficamente sicuro. Anti-replay. Lock atomico. State machine pura. Verificato on-chain prima del rilascio.",
    fromLabel: "Mittente",
    toLabel: "Destinatario",
    steps: ["Deposito", "Escrow", "Verifica", "Rilascio"],
    network: "Multi-Chain",
  },
  heroWallet: {
    badge: "Alpha Wallet · BIP-39/44 · 4 Chain",
    headline: "Il tuo denaro,",
    headline2: "matematicamente tuo.",
    sub: "Wallet HD self-custodial. BIP-39/44. secp256k1 EVM + Native SegWit BTC. Chiavi mai trasmesse. Mai.",
    balance: "3.840,00",
    currency: "USD equiv.",
    actions: ["Invia", "Ricevi", "Storico", "QR"],
    history: [
      { label: "ETH ricevuto — Ethereum", amount: "+0.42 ETH", date: "Oggi, 14:32" },
      { label: "USDT inviato — Polygon",  amount: "-250 USDT", date: "Oggi, 11:08" },
      { label: "BTC ricevuto — Mainnet",  amount: "+0.005 BTC", date: "Ieri" },
    ],
  },
  heroMerchant: {
    badge: "AlphaBit Pay · Merchant Rails",
    headline: "Pagamenti che vivono",
    headline2: "dentro la conversazione.",
    sub: "Dal cliente al merchant. In-chat. On-chain. Su quattro blockchain. Istantaneo.",
    steps: [
      { label: "Cliente",  icon: "👤" },
      { label: "Chat",     icon: "💬" },
      { label: "Pagamento",icon: "💸" },
      { label: "Escrow",   icon: "🔒" },
      { label: "Verifica", icon: "⛓️" },
      { label: "Merchant", icon: "🏪" },
    ],
    note: "La stessa affidabilità di Stripe — costruita nativamente dentro la conversazione, su blockchain.",
  },
  closing: {
    title: "La Visione Futura",
    takeaways: [
      "AlphaChat ha costruito l'unica piattaforma al mondo dove Signal E2E, wallet self-custodial multi-chain e pagamento on-chain coesistono in un'unica conversazione.",
      "L'architettura zero-knowledge garantisce matematicamente che il server non possa mai leggere messaggi né accedere a chiavi private — non per policy, per design.",
      "L'ecosistema AlphaBit è la base scalabile per il nuovo paradigma: comunicazione privata + trasferimento di valore come un'unica primitiva digitale."
    ],
    linksTitle: "Link Ufficiali",
    contactTitle: "Contatti Stampa"
  }
};
