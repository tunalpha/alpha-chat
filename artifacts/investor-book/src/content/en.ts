export const en = {
  nav: {
    readEn: "EN",
    readIt: "IT",
    contact: "Contact",
    download: "Download PDF",
  },
  cover: {
    title: "AlphaChat",
    badge: "Investor Book 2026",
    subtitle: "Zero-knowledge private communication. Multi-chain self-custodial wallet. Native on-chain payments. One sovereign ecosystem.",
  },
  founder: {
    title: "The Founder",
    name: "Enrico Maria Giaquinta",
    alias: 'alias "Alpha"',
    role: "Founder & Chief Architect",
    paragraphs: [
      "Enrico Maria Giaquinta, known by the pseudonym \"Alpha\", is an Italian entrepreneur, software architect, and technology innovator. With over 15 years of experience in blockchain technologies, digital payment systems, and secure communications, he has designed and engineered numerous web platforms and digital infrastructures.",
      "As founder of AlphaBit and creator of AlphaChat, he leads the strategic vision, architecture, and product evolution. His work is characterized by a reserved public profile, preferring to let the engineering and solidity of his systems speak for themselves.",
      "Beyond technology, he is the founder of Felinia, an independent initiative dedicated to the care and protection of stray cats, reflecting a personal commitment to social impact."
    ],
    philosophyTitle: "Engineering Philosophy",
    philosophy: [
      { title: "Simplicity", desc: "Technology must eliminate complexity, not create it." },
      { title: "Security", desc: "Data protection and privacy built into the foundation of the architecture." },
      { title: "Long-term vision", desc: "Platforms designed to evolve without ever losing reliability." }
    ],
    quote: "Technology should never replace human relationships. It should make them safer, simpler, and freer."
  },
  founderLetter: {
    title: "Founder's Letter",
    greeting: "To our future partners,",
    paragraphs: [
      "I started building AlphaChat because the way we communicate digitally is fundamentally broken. We have accepted a reality where our most intimate conversations are analyzed to extract data, where digital identity is leased rather than owned, and where sending value to a friend requires leaving the conversation to use a disconnected, often archaic financial system.",
      "Today, AlphaChat is no longer just an architectural promise — it is a complete, operational, production platform. We have engineered and deployed: Signal E2E encryption with per-device sessions, a multi-chain self-custodial HD wallet (Polygon, Ethereum, BSC, Bitcoin), an escrow payment engine across four blockchains with dynamic gas abstraction, and a zero-knowledge architecture where the server never has access to messages or users' cryptographic keys.",
      "The communication layer and the transactional layer are finally the same space. Every message is encrypted with X3DH + Double Ratchet. Every seed phrase is generated locally with BIP-39 and never leaves the user's device. Every transaction is signed client-side with the user's private key, never exposed to our servers.",
      "USDA is the starting point — but we have built the engine for any asset, on any chain. Polygon, Ethereum, BSC, Bitcoin: four networks, one conversational interface. With getusda.xyz, anyone in the world can request or receive digital value instantly, without banks, without borders, without intermediaries.",
      "The AlphaBit ecosystem is designed for the long term. It is founded on the conviction that privacy is a right, not a feature, and that payments belong where relationships are born: inside the conversation.",
      "— Alpha"
    ]
  },
  story: {
    title: "Why AlphaChat Exists",
    subtitle: "The narrative before the product.",
    sections: [
      {
        title: "The Fragmentation of Communication",
        desc: "Modern interactions are scattered across dozens of platforms. We message on one app, pay on another, and verify identity on a third. This friction degrades user experience and slows commerce."
      },
      {
        title: "Privacy as a Fundamental Right",
        desc: "The surveillance economy has commodified human interaction. We believe privacy is not a luxury or an option; it is the default state of free digital societies."
      },
      {
        title: "Self-Sovereign Digital Identity",
        desc: "Identity is shifting from centralized databases to cryptographic self-sovereignty. Users demand control over who they are online, who can access their data, and where their keys reside."
      },
      {
        title: "Payments Belong in the Conversation",
        desc: "Value transfer is essentially a form of communication. Moving money should be as instant, secure, and native to a chat interface as sending a text — and across any blockchain."
      }
    ]
  },
  product: {
    title: "The Product: AlphaChat",
    subtitle: "A unified application designed for uncompromising privacy, integrated value transfer, and self-custodial wallet across four blockchains.",
    facts: [
      {
        title: "End-to-End Encryption",
        desc: "Signal Protocol: X3DH for asynchronous session agreement, Double Ratchet for per-message forward secrecy, one-time prekeys (OTPK) for offline sessions. Strictly per-device sessions with cryptographic fan-out."
      },
      {
        title: "Encrypted Media & Storage",
        desc: "E2E media: AES-256-GCM for blobs, keys wrapped in Signal session. Storage on Cloudflare R2 with multipart upload and signed URL. Local encrypted cache with E2E thumbnails. The server sees only opaque encrypted blobs."
      },
      {
        title: "Identity & Trust",
        desc: "TOFU (Trust On First Use) with 60-digit Safety Numbers. Verification via QR code, automatic key-change alerts, multi-device management with granular revocation."
      },
      {
        title: "Secure Voice Calls",
        desc: "WebRTC with encrypted signaling, ICE restart on network change, call verification against cryptographic key bundles (CallVerifyModal), encrypted call log, in-memory busy detection."
      },
      {
        title: "E2E Group Chat",
        desc: "Full end-to-end encryption via per-member Signal fan-out architecture. Each group message is individually encrypted for every device of every participant."
      },
      {
        title: "Account Resilience",
        desc: "Auto-generated Recovery Card (argon2id), Phoenix Protocol (argon2id emergency code, lock/destroy mode), Dead Man Switch, Emergency Portal /emergency, full security timeline audit."
      },
      {
        title: "Progressive Web App",
        desc: "Installable, offline-tolerant, VAPID push notifications, localized in 10 languages, biometric session persistence, anti-race-condition mutex on token refresh."
      },
      {
        title: "Zero-Knowledge Stance",
        desc: "The server acts as a blind relay. It never has access to message plaintext, users' seed phrases, or private keys. Even under legal compulsion, there is no decryptable data to hand over."
      }
    ]
  },
  kpi: {
    title: "Technical Specifications",
    subtitle: "Built to last.",
    items: [
      { label: "E2E Protocol", value: "Signal" },
      { label: "Key Agreement", value: "X3DH" },
      { label: "Forward Secrecy", value: "Double Ratchet" },
      { label: "Media Encryption", value: "AES-256-GCM" },
      { label: "Blockchains", value: "4 networks" },
      { label: "HD Wallet Standard", value: "BIP-39/44" },
      { label: "EVM Curve", value: "secp256k1" },
      { label: "Bitcoin", value: "Native SegWit" },
      { label: "Languages", value: "10" },
      { label: "Media Storage", value: "R2 (Cloudflare)" },
      { label: "PWA", value: "Offline-first" },
      { label: "Identity KDF", value: "argon2id" },
    ]
  },
  security: {
    title: "Zero-Knowledge Architecture",
    subtitle: "The server cannot read your messages. Physically impossible by design.",
    guarantee: "AlphaChat is designed so that no employee, no administrator, and no government authority can ever access the content of conversations or users' cryptographic keys — not by policy choice, but by mathematical impossibility.",
    pillars: [
      {
        title: "Signal Protocol — Double-Layer Encryption",
        badge: "X3DH + Double Ratchet",
        desc: "Every message is encrypted twice: first with the Signal session key derived via X3DH (Extended Triple Diffie-Hellman), then with the ratchet key updated for each message via the Double Ratchet Algorithm. The server receives and transmits only the final ciphertext — never able to reverse the encryption without the recipient's private keys.",
        specs: ["X3DH: asynchronous session agreement with 4 DH key pairs","Double Ratchet: forward secrecy + break-in recovery per message","One-time prekeys (OTPK): each session uses a disposable key","Per-device sessions: independent cryptographic fan-out on each device"]
      },
      {
        title: "Seed Phrase — Never Leaves the Device",
        badge: "BIP-39 · Client-Side Only",
        desc: "The BIP-39 mnemonic phrase (12 or 24 words) is generated entirely in the user's browser using cryptographically secure entropy (crypto.getRandomValues). It is never transmitted, never sent to the server, never logged. It is immediately encrypted with AES-256-GCM using a key derived from the user's PIN and saved in local IndexedDB.",
        specs: ["BIP-39 mnemonic: 128/256 bits of CSPRNG entropy","Local encryption: AES-256-GCM with random IV on each write","PIN seal: AES key exported and encrypted via PBKDF2","Biometric seal: AES key sealed with WebAuthn/Face ID, unlocked only after biometric verification","Zero transmission: the network never sees the mnemonic or derived private key"]
      },
      {
        title: "Private Keys — Immediate Memory Zeroing",
        badge: "Memory-Safe Signing",
        desc: "When the user authorizes a transaction, the private key is derived from the mnemonic, used to sign the transaction, and immediately zeroed in memory (operation in try/finally block). Signing happens entirely client-side. The server receives only the already-signed transaction, never the key.",
        specs: ["In-place derivation: secp256k1 for EVM, P2WPKH for Bitcoin","Offline signing: the private key never touches the network","try/finally zeroing: variable overwritten with zeros immediately after signing","No logs, no trace: the signing process is air-gapped from telemetry"]
      },
      {
        title: "Server — Blind Relay",
        badge: "Zero Plaintext",
        desc: "The backend API handles only encrypted envelopes. MongoDB archives documents with opaque ciphertext (no schema for message plaintext). Cloudflare R2 archives AES-256-GCM encrypted blobs without keys. The WebSocket server routes Signal packets without inspection capability. Even unauthorized database access produces no readable plaintext.",
        specs: ["MongoDB: stores only `{ ciphertext: base64, iv: ... }` per message","R2: blobs encrypted with AES-GCM; the blob key is wrapped in the Signal payload","WebSocket: blind routing on userId — no content inspected","No plaintext in server RAM in any code path"]
      },
      {
        title: "Phoenix Protocol — Account Self-Defense",
        badge: "argon2id · Emergency Destroy",
        desc: "In case of coercion or device seizure, the Phoenix Protocol allows the user to activate immediate and irreversible destruction of all local keys and data via an emergency code derived with argon2id (maximum security parameters: 64MB memory, 4 iterations, parallelism 2). Once activated, no forensic technique can recover the data.",
        specs: ["Phoenix code: argon2id with 32-byte random salt","Lock mode: immediate lockout of all active sessions","Destroy mode: overwrite and deletion of IndexedDB + localStorage","Emergency Portal: accessible via dedicated URL even with app in lock mode","Dead Man Switch: automatic activation on prolonged absence"]
      },
      {
        title: "Safety Numbers — Identity Verification",
        badge: "60-digit Fingerprint",
        desc: "The Safety Number is a 60-digit cryptographic fingerprint calculated from the composition of the two parties' public identity keys. It enables out-of-band identity verification: if two users read the same number, communication is guaranteed point-to-point without man-in-the-middle. Identical to the Signal standard.",
        specs: ["Derivation: HKDF-SHA256 on composite public identity","60 decimal digits grouped in blocks of 5","Verification via QR code or voice reading","Automatic key-change alert if the contact's identity key changes"]
      }
    ]
  },
  alphaWallet: {
    title: "Alpha Wallet",
    subtitle: "Your money, mathematically yours. Across four blockchains.",
    desc: "Alpha Wallet is an HD (Hierarchical Deterministic) self-custodial wallet natively integrated into AlphaChat. It is not a wrapper around a third-party wallet — it is a complete cryptographic implementation, built from scratch with BIP-39, BIP-44, and BIP-84 standards, with native support for Polygon, Ethereum, BSC, and Bitcoin. Private keys never leave the device.",
    securityTitle: "Cryptographic Security",
    security: [
      {
        title: "BIP-39 Mnemonic Generation",
        spec: "128–256 bit · CSPRNG",
        desc: "The seed phrase is generated with cryptographically secure entropy via the Web Crypto API (crypto.getRandomValues). The entropy is mapped onto the 2048-word BIP-39 standard wordlist. It is never transmitted to the server."
      },
      {
        title: "BIP-44 Hierarchical Derivation",
        spec: "m/44'/coin_type'/0'/0/index",
        desc: "Derivation paths follow the BIP-44 standard with network-specific coin_type (60' for EVM, 0' for Bitcoin). From a single mnemonic, addresses for all supported networks are derived without ever transmitting the root key."
      },
      {
        title: "secp256k1 — EVM Curve",
        spec: "Polygon · Ethereum · BSC",
        desc: "EVM private keys are secp256k1 scalars. Public addresses are derived with keccak256 of the compressed public key. Transaction signing happens entirely client-side with @scure/bip39 + viem before sending to the RPC node."
      },
      {
        title: "P2WPKH — Bitcoin Native SegWit",
        spec: "bech32 · BIP-84",
        desc: "Bitcoin addresses are Native SegWit (bech32, bc1...) derived with BIP-84. Bitcoin transactions use PSBT (Partially Signed Bitcoin Transaction) with native bigint for satoshi management, with dustlimit enforcement at 546 sat."
      },
      {
        title: "AES-256-GCM Local Encryption",
        spec: "IndexedDB · try/finally zeroing",
        desc: "The mnemonic is encrypted with AES-256-GCM before being saved to IndexedDB. The AES key is derived from the user's PIN. Each write uses a random 12-byte IV. The derived private key is zeroed in memory immediately after signing."
      },
      {
        title: "Biometric Seal (Face ID)",
        spec: "WebAuthn · AES-GCM Sealed",
        desc: "The PIN can be sealed with Face ID via WebAuthn. The AES key is encrypted with the biometric credential and saved in localStorage. Only a positive biometric verification unlocks the PIN — never exposed in plaintext."
      }
    ],
    chainsTitle: "Supported Blockchains",
    chains: [
      { name: "Polygon PoS", symbol: "MATIC / USDT / USDC", icon: "🔵", desc: "Primary chain. Settlement in <2s, ultra-low gas, ERC-20 native for USDA/USDT/USDC." },
      { name: "Ethereum L1", symbol: "ETH / USDT / USDC", icon: "⬡", desc: "Layer 1. ERC-20 and native ETH, dynamic gas with EIP-1559 forecasting." },
      { name: "Binance Smart Chain", symbol: "BNB / USDT / USDC", icon: "🟡", desc: "BSC with USDT at 18 decimals. Ultra-low fees, high adoption in Asia." },
      { name: "Bitcoin", symbol: "BTC", icon: "🟠", desc: "Native UTXO with PSBT, Native SegWit, optimized coin selection, dynamic on-chain fee." }
    ],
    platformFeeTitle: "Fee Model",
    platformFeeDesc: "Alpha Wallet generates revenue through a platform fee applied on each self-custodial transaction sent. The fee is calculated as a percentage of the sent amount, with a minimum floor for Bitcoin (546 sat dust limit). The flow is fully transparent: the user sees fee, net amount, and quote before signing."
  },
  lightning: {
    title: "Bitcoin Lightning Network",
    subtitle: "Instant, sub-cent payments. Natively inside Alpha Wallet.",
    desc: "Bitcoin Lightning is the Layer 2 payment network built on top of Bitcoin mainnet. Where on-chain Bitcoin transactions can take 10+ minutes and cost dollars in fees, Lightning settles payments in milliseconds for fractions of a cent — with the same cryptographic security guarantees of the Bitcoin base layer. Alpha Wallet integrates Lightning natively via Breez SDK Spark: a WebAssembly engine that runs entirely client-side, giving users a non-custodial Lightning wallet without running a full node.",
    architectureTitle: "Network Architecture",
    architectureLayers: [
      {
        name: "Bitcoin L1 — Base Layer",
        detail: "Bitcoin mainnet · UTXO security model · final settlement anchor · 21M supply cap"
      },
      {
        name: "⚡ Lightning Network — L2",
        detail: "Payment channels · HTLC routing · millisecond settlement · sub-cent fees · BOLT11 invoices"
      },
      {
        name: "Breez SDK Spark — WASM Runtime",
        detail: "WebAssembly engine · crossOriginIsolated · COOP/COEP headers · SharedArrayBuffer · client-only"
      },
      {
        name: "Alpha Wallet — Integration Layer",
        detail: "SparkWalletProvider · BOLT11 generate/pay · IDB alpha-lightning-v1 · event subscription"
      }
    ],
    bolt11Title: "BOLT11 Invoice Flow",
    bolt11Steps: [
      {
        icon: "⚡",
        name: "Generate Invoice",
        desc: "Alpha Wallet calls Breez SDK to create a BOLT11 invoice with expirySecs: 3600 (1 hour). The SDK generates a payment hash and encodes amount, description, and expiry in the BOLT11 string."
      },
      {
        icon: "📱",
        name: "Share & Present",
        desc: "The invoice is rendered as a scannable QR code. The user shares via Web Share API (native iOS/Android sheet) or copies the raw BOLT11 string. QR payload is exclusively the BOLT11 — no added data."
      },
      {
        icon: "🔔",
        name: "Detect Payment",
        desc: "Breez SDK monitors the Lightning channel in real time via event subscription. When the HTLC is fulfilled, the SDK fires a payment_received event. Alpha Wallet also polls every 15 seconds as a fallback."
      },
      {
        icon: "✅",
        name: "Instant Settlement",
        desc: "Payment credited in milliseconds. The preimage is revealed, confirming cryptographic proof of payment. The transaction is saved to IDB alpha-lightning-v1 with status paid and paidAt timestamp."
      }
    ],
    sparkTitle: "Breez SDK Spark — Technical Architecture",
    sparkFeatures: [
      {
        title: "WebAssembly Engine",
        spec: "WASM · Threads",
        desc: "Breez SDK Spark runs as a WebAssembly module with multi-threading support. The WASM binary executes entirely in the browser sandbox — no native code, no server-side Lightning node required."
      },
      {
        title: "COOP / COEP Isolation",
        spec: "crossOriginIsolated",
        desc: "WASM threads require SharedArrayBuffer, which browsers permit only in crossOriginIsolated contexts. The app serves Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers via a custom Node.js server."
      },
      {
        title: "Non-Custodial Mnemonic",
        spec: "BIP-39 · Session-only",
        desc: "The Lightning wallet mnemonic is the same BIP-39 seed as Alpha Wallet, decrypted from IndexedDB using the user's PIN for the duration of the session. It is passed to the Breez SDK exclusively in RAM and never transmitted to any server."
      },
      {
        title: "Payment Event Subscription",
        spec: "addEventListener · 15s poll",
        desc: "SDK exposes addEventListener('paymentReceived') for real-time HTLC fulfillment detection. A 15-second polling fallback via listPayments() ensures robustness in environments where the WebSocket event is missed (PWA background, iOS suspension)."
      },
      {
        title: "IDB Lightning Store",
        spec: "alpha-lightning-v1",
        desc: "All Lightning transactions — invoices generated, payments sent, payment events — are persisted in a dedicated IndexedDB store (alpha-lightning-v1), separate from the on-chain wallet store. Records include bolt11, amountSat, status, expiresAt, paidAt, and feeSat."
      },
      {
        title: "BOLT11 Invoice Control",
        spec: "expirySecs: 3600",
        desc: "Invoice expiry is explicitly set to 3600 seconds (1 hour) on every createReceiveInvoice() call, overriding the SDK default of ~30 days. The expiry is decoded from the BOLT11 payload and displayed as a live countdown, turning red on expiry."
      }
    ],
    comparisonTitle: "Lightning vs On-Chain: When to Use Each",
    comparisonLightning: [
      "Instant settlement — milliseconds, not minutes",
      "Sub-cent fees — ideal for micro-payments and tips",
      "No on-chain escrow required — HTLC is the escrow",
      "Ideal for frequent, smaller Bitcoin transfers",
      "Works offline-to-online via asynchronous BOLT11 invoices"
    ],
    comparisonOnchainLabel: "⛓️ On-Chain (Bitcoin UTXO)",
    comparisonOnchain: [
      "Final, immutable settlement on Bitcoin mainnet",
      "Suitable for large amounts without channel capacity limits",
      "PSBT signing with Native SegWit (bech32) addresses",
      "Dynamic miner fee via mempool estimation",
      "No counterparty required — pure UTXO model"
    ],
    wasmCalloutTitle: "WASM Security Isolation",
    wasmCalloutDesc: "The Breez SDK WASM runtime executes in a strict browser sandbox with crossOriginIsolated = true. SharedArrayBuffer — required for WASM multi-threading — is only available in this isolated context. The mnemonic is passed to WASM exclusively in memory, zeroed after SDK initialization. The Lightning node state is maintained client-side only, in WASM memory and IDB — the server has zero visibility into Lightning channel state, payment history, or the user's mnemonic."
  },
  multiChain: {
    title: "Multi-Chain Payment Engine",
    subtitle: "On-chain escrow across four blockchains with dynamic gas abstraction.",
    desc: "The Multi-Chain Payment Engine is the transactional heart of AlphaChat. A pure state machine that manages the complete lifecycle of every transfer — from deposit address generation to final settlement — on Polygon, Ethereum, BSC, and Bitcoin. Every state is atomically persisted in MongoDB. Every transaction is verified on-chain before release.",
    stateMachine: [
      { state: "awaiting_deposit", desc: "Deposit address generated. Awaiting on-chain payment from sender." },
      { state: "deposit_detected", desc: "Deposit confirmed on-chain via receipt/getLogs verification. Anti-replay active." },
      { state: "releasing", desc: "Release transaction signed and broadcast. Gas Station has guaranteed MATIC funds." },
      { state: "released", desc: "Funds credited to recipient. TX hash and block number recorded for audit." },
      { state: "refunded", desc: "Refund to sender in case of expiry or anomaly. Automatic sweep scheduled." },
      { state: "waiting_for_gas", desc: "Gas Reserve Protection: insufficient MATIC reserve. Scheduler awaits replenishment." }
    ],
    featuresTitle: "Technical Features",
    features: [
      {
        title: "Dynamic Gas Station",
        desc: "The Gas Station monitors the MATIC reserve in real time. Top-up is dynamically calculated: estimated_gas × gasPrice × safety_buffer, capped at 0.5 MATIC per operation. No fixed amounts — the formula adapts to gas volatility."
      },
      {
        title: "Quote Mode & Recipient-Exact",
        desc: "The sender can choose the mode: sender_exact (they pay the specified amount, recipient receives minus fees) or recipient_exact (recipient receives exactly the amount, fees are borne by the sender). Fee calculated with BigInt ceiling for zero-loss."
      },
      {
        title: "Bitcoin UTXO + PSBT",
        desc: "For Bitcoin, the engine builds PSBT (Partially Signed Bitcoin Transaction) using bitcoinjs-lib v7 with native bigint. Optimized UTXO selection with coin-selection algorithm. Fee floor at 546 sat (dust limit). Dynamic fee from mempool."
      },
      {
        title: "Dynamic EVM Network Fee",
        desc: "EVM network fees are calculated server-side in real time: gasPrice × estimated_gas × nativeAssetPrice in USD (CoinGecko), with admin-configurable safety margin. Every quote is frozen for 60 seconds for volatility protection."
      },
      {
        title: "Anti-Replay & Atomic Lock",
        desc: "Each transfer has a unique nonce. The atomic lock on MongoDB (findOneAndUpdate with condition) prevents double-spend and race conditions even in multi-process environments. The recovery scheduler automatically resumes transfers in anomalous states."
      },
      {
        title: "Cancel-Stale & Recovery",
        desc: "Transfers without deposit after 30 minutes are automatically cancelled. Pending funds are recovered via sweep to the fee wallet. The recovery scheduler also handles transactions stuck with an already-registered release hash (no-rollback policy)."
      }
    ]
  },
  paymentLayer: {
    title: "USDA — The Payment Layer",
    subtitle: "Digital dollars at the speed of conversation.",
    desc: "USDA is the native settlement token of the AlphaBit ecosystem on Polygon. An ERC-20 optimized for in-chat micro-transactions, with a complete pipeline: on-chain escrow, Alchemy getLogs verification, automatic release via Gas Station, and global payment links via getusda.xyz. Reown AppKit (ex WalletConnect v3) integrates MetaMask, Rainbow, Coinbase, Trust, and Phantom in one click.",
    features: [
      {
        title: "In-Chat Escrow Engine",
        desc: "Flow: deposit → on-chain verification (Alchemy alchemy_getAssetTransfers) → atomic release → settlement. On-chain anti-replay with nonce. MongoDB atomic lock. Block number + tx hash verification for every state."
      },
      {
        title: "Reown AppKit — Non-Custodial Wallet",
        desc: "Native integration with Reown AppKit (ex WalletConnect v3) + wagmi v3 + viem. Users connect MetaMask, Rainbow, Coinbase Wallet, Trust, or Phantom in one click. Funds never pass through our custodial wallets — they sign directly from the user's wallet."
      },
      {
        title: "Automated Gas Station",
        desc: "Zero blockchain friction for the user. The Gas Station dynamically calculates and replenishes MATIC before each release operation. The algorithm considers real-time gasPrice, estimated gas for the transaction, and a configurable safety buffer."
      },
      {
        title: "getusda.xyz — Global Payment Links",
        desc: "Payment requests via Polygon requesterWallet. Response with a shareable shareLink. Anyone in the world can pay without an AlphaChat account. Claim via POST /api/pay/claim/{code} with on-chain transaction verification."
      }
    ]
  },
  ecosystem: {
    title: "The Ecosystem: AlphaBit",
    subtitle: "One coherent stack.",
    desc: "AlphaBit is the ecosystem. AlphaChat is the flagship consumer interface. USDA is the native payment layer. Alpha Wallet is the multi-chain self-custodial layer. AlphaBit Pay is the merchant infrastructure. They don't compete; they integrate.",
    labels: {
      user: "User",
      alphaChat: "AlphaChat",
      usda: "USDA · Alpha Wallet",
      alphaBitPay: "AlphaBit Pay",
      merchants: "Merchants"
    }
  },
  architecture: {
    title: "System Architecture",
    subtitle: "Edge encryption. Blind relays. Decentralized multi-chain settlement.",
    labels: {
      clients: "Clients (Multi-device PWA)",
      e2e: "Signal Protocol Layer (X3DH · Double Ratchet · AES-256-GCM)",
      backend: "Backend API + WebSocket (Blind Relay)",
      db: "MongoDB (ciphertext) + Cloudflare R2 (encrypted blobs)",
      blockchain: "Multi-Chain: Polygon · Ethereum · BSC · Bitcoin"
    },
    layers: [
      { name: "Client Layer", detail: "React PWA · BIP-39/44 wallet · Encrypted IndexedDB · WebCrypto API" },
      { name: "Signal E2E Layer", detail: "X3DH · Double Ratchet · OTPK · per-device sessions · sealed sender" },
      { name: "Relay Layer", detail: "Node.js API + WS · blind routing · no plaintext in RAM" },
      { name: "Storage Layer", detail: "MongoDB (ciphertext docs) · Cloudflare R2 (AES-GCM blobs) · signed URL" },
      { name: "Blockchain Layer", detail: "Polygon PoS · Ethereum L1 · BSC · Bitcoin UTXO · Gas Station" },
    ]
  },
  competitive: {
    title: "Competitive Landscape",
    subtitle: "Positioning through objective architectural choices.",
    messaging: {
      title: "Messaging Platforms",
      columns: ["Platform", "E2E Default", "Zero-KW Server", "Native Payments", "Self-Custodial Wallet", "Self-Sovereign Recovery"],
      rows: [
        { name: "AlphaChat", e2e: "✓ Signal", zk: "✓ Yes", pay: "✓ 4 chains", wallet: "✓ BIP-39/44", rec: "✓ Phoenix/Card" },
        { name: "Signal", e2e: "✓ Signal", zk: "✓ Yes", pay: "Limited", wallet: "✗ No", rec: "PIN-based" },
        { name: "WhatsApp", e2e: "✓ Signal", zk: "✗ Meta", pay: "Fiat regional", wallet: "✗ No", rec: "✗ Cloud backup" },
        { name: "Telegram", e2e: "✗ Opt-in", zk: "✗ No", pay: "TON integr.", wallet: "✗ No", rec: "✗ Centralized" },
        { name: "iMessage", e2e: "✓ Yes", zk: "✗ Apple", pay: "Apple Pay fiat", wallet: "✗ No", rec: "✗ iCloud" }
      ]
    },
    payments: {
      title: "Payment Processors",
      desc: "Traditional processors operate on centralized rails and checkout pages separate from communication. AlphaChat brings value transfer natively inside the conversation, across four blockchains, with cryptographic escrow.",
      columns: ["Operator", "Blockchain", "On-chain Escrow", "Chat Integration", "Self-Custodial"],
      rows: [
        { name: "AlphaChat / AlphaBit Pay", chain: "Polygon·ETH·BSC·BTC", escrow: "✓ On-chain", chat: "✓ Native", custody: "✓ Yes" },
        { name: "Stripe", chain: "✗ Fiat only", escrow: "✗ No", chat: "✗ External", custody: "✗ No" },
        { name: "PayPal", chain: "✗ Fiat + crypto", escrow: "✗ No", chat: "✗ Adjacent", custody: "✗ Custodial" },
        { name: "Coinbase Commerce", chain: "Multi-chain", escrow: "✗ No", chat: "✗ No", custody: "✗ Custodial" },
        { name: "Lightning (BTC)", chain: "Bitcoin L2", escrow: "✓ HTLC", chat: "✗ External", custody: "✓ Yes" }
      ]
    },
    stablecoins: {
      title: "Stablecoin Settlement",
      desc: "USDA is optimized as the ecosystem's native settlement token, but the multi-chain engine natively supports any ERC-20 on Polygon, Ethereum, and BSC, including USDT and USDC, plus native BTC.",
      columns: ["Asset", "Chain", "Role", "AlphaChat Support"],
      rows: [
        { name: "USDA", chain: "Polygon", role: "Native ecosystem settlement", pos: "✓ Native — in-chat escrow" },
        { name: "USDT", chain: "Polygon·ETH·BSC", role: "Market liquidity", pos: "✓ Multi-chain supported" },
        { name: "USDC", chain: "Polygon·ETH·BSC", role: "Market liquidity", pos: "✓ Multi-chain supported" },
        { name: "BTC", chain: "Bitcoin mainnet", role: "Store of value", pos: "✓ Native UTXO · SegWit" }
      ]
    }
  },
  businessModel: {
    title: "Business Plan & Revenue Model",
    subtitle: "Five structured revenue streams on a single integrated platform.",
    points: [
      {
        title: "Platform Fee — Alpha Wallet",
        desc: "Percentage fee on every self-custodial transaction sent via Alpha Wallet. Applied as a percentage of the sent amount with a minimum floor for BTC (546 sat). Recurring revenue proportional to platform transaction volume."
      },
      {
        title: "Merchant Infrastructure — AlphaBit Pay",
        desc: "AlphaBit Pay charges predictable routing and settlement fees for commercial transaction flows. Merchant onboarding with dedicated dashboard, integration API, and real-time reporting."
      },
      {
        title: "Escrow Service Fee — USDA Engine",
        desc: "The USDA engine applies a micro-fee on in-chat escrow flows. Automated gas abstraction (Gas Station replenishes MATIC at platform expense) positions the service as premium over direct transfers."
      },
      {
        title: "Gas Abstraction Premium",
        desc: "Total gas abstraction (the user never touches MATIC/ETH/BNB for fees) is a premium value. The platform manages automatic top-up and recovers the cost with margin in transaction fees."
      },
      {
        title: "Open API & SDK (Phase 6)",
        desc: "In the Open Platform phase, access to AlphaBit infrastructure via API and SDK will generate revenue from developers/enterprise on a tiered SaaS model."
      }
    ]
  },
  market: {
    title: "Market Opportunity",
    subtitle: "Three massive markets. One unified platform.",
    intro: "AlphaChat sits at the intersection of three of the fastest-growing sectors in the global digital economy. The timing is not coincidental — it is architectural.",
    segments: [
      {
        icon: "💬",
        label: "Secure Messaging",
        stat: "3.1B",
        unit: "daily active users",
        color: "purple",
        points: [
          "WhatsApp has over 2 billion monthly active users",
          "Telegram surpassed 900 million users in 2024",
          "Global OTT messaging market projected at $340B by 2030",
          "85% of internet users want more privacy on their data (Pew Research)",
          "Signal grew 1,200% in one week during privacy concern spikes"
        ]
      },
      {
        icon: "₿",
        label: "Crypto & Stablecoin",
        stat: "$180B+",
        unit: "stablecoin market cap",
        color: "green",
        points: [
          "Stablecoin transaction volume exceeded $10.8T in 2023 — more than Visa",
          "Over 420 million crypto users worldwide (+15% YoY)",
          "Bitcoin: $1.3T market cap, most liquid digital asset in the world",
          "Cross-border stablecoin remittances cost 80-90% less than wire transfers",
          "Regulatory frameworks (MiCA in Europe, US laws) are legitimizing stablecoin commerce"
        ]
      },
      {
        icon: "🌐",
        label: "Digital Payments",
        stat: "$14T+",
        unit: "global transaction volume",
        color: "blue",
        points: [
          "Global digital payments market will reach $29T by 2030 (CAGR 11.5%)",
          "P2P digital payments market will exceed $9T by 2030",
          "Crypto gateway market grows at 16.5% CAGR (2023-2030)",
          "60% of Gen Z and Millennials prefer instant digital payments over traditional banking",
          "Self-custodial wallets: 3x YoY growth in non-exchange user share"
        ]
      }
    ],
    conclusion: "No platform today simultaneously captures zero-knowledge private communication, multi-chain self-custodial wallet, and on-chain escrow payment infrastructure for merchants. AlphaChat is designed to own this intersection."
  },
  swot: {
    title: "SWOT Analysis",
    s: {
      title: "Strengths",
      items: [
        "Fully integrated tech stack: Signal E2E + BIP-39/44 HD wallet + multi-chain escrow in a single app",
        "Zero-knowledge by design: server mathematically unable to read messages or access private keys",
        "Native multi-chain: Polygon, Ethereum, BSC, Bitcoin in one interface",
        "Auto-scaling platform fee model: revenue proportional to volume without subscription dependency",
        "Extreme account resilience: Phoenix Protocol, Recovery Card, Dead Man Switch, Safety Numbers",
        "Progressive UX: from non-crypto user to self-custodial wallet without technical friction"
      ]
    },
    w: {
      title: "Weaknesses",
      items: [
        "Early-stage adoption — network effects still building",
        "Technical complexity requires user education on self-custody concepts",
        "Dependence on public RPC nodes/Alchemy for on-chain queries"
      ]
    },
    o: {
      title: "Opportunities",
      items: [
        "Growing global demand for privacy-first communication platforms post-surveillance legislation",
        "Mass stablecoin adoption in emerging markets (LATAM, Africa, SEA)",
        "Bitcoin mainstream: 1 billion potential users needing a simple, secure wallet",
        "Regulatory clarity (MiCA, SAB 121) legitimizing crypto commerce embedded in apps",
        "SDK/API expansion: AlphaBit infrastructure as a B2B platform for fintech"
      ]
    },
    t: {
      title: "Threats",
      items: [
        "Feature cloning by incumbents (WhatsApp, Telegram, Big Tech)",
        "Regulatory volatility on crypto in some jurisdictions",
        "Self-custody friction for non-tech users (seed phrase loss)"
      ]
    }
  },
  roadmap: {
    title: "Strategic Roadmap",
    subtitle: "Seven sprints completed. Two phases in progress.",
    phases: [
      {
        name: "Phase 1 — E2E Foundation ✅",
        status: "complete",
        desc: "Complete Signal Protocol: X3DH, Double Ratchet, one-time prekeys, per-device sessions, multi-device fan-out. Installable PWA, VAPID push, 10 languages. The cryptographic foundations are live and in production."
      },
      {
        name: "Phase 2 — Security Fortress ✅",
        status: "complete",
        desc: "Phoenix Protocol (emergency lock/destroy, argon2id), auto-generated Recovery Card, Dead Man Switch, Face ID biometric authentication, Safety Numbers, QR identity verification, Emergency Portal, complete security timeline audit."
      },
      {
        name: "Phase 3 — USDA Infrastructure ✅",
        status: "complete",
        desc: "Complete USDA escrow engine: deposit → on-chain verification → atomic release. Gas Station with dynamic MATIC replenishment. Global payment links getusda.xyz. AlphaBit Pay merchant rails. Anti-replay, MongoDB atomic lock."
      },
      {
        name: "Phase 4 — Media, Calls & Storage ✅",
        status: "complete",
        desc: "Media migration to Cloudflare R2 (multipart upload, signed URL). Secure WebRTC voice calls with ICE restart, call verification, admin call monitor. Lottie animated stickers E2E encrypted. Local encrypted media cache."
      },
      {
        name: "Phase 5 — Alpha Wallet Self-Custodial ✅",
        status: "complete",
        desc: "BIP-39/44 HD multi-chain wallet (Polygon, ETH, BSC, Bitcoin Native SegWit). Real-time on-chain balance, EVM send + Bitcoin PSBT, transaction history, QR receive. Platform fee model. Chat Wallet Bridge for in-chat self-custodial payments. Recipient discovery."
      },
      {
        name: "Phase 6 — Multi-Chain Payment Engine ✅",
        status: "complete",
        desc: "Escrow engine extended to 4 chains: Polygon, Ethereum, BSC, Bitcoin UTXO. Pure state machine with 6 states. Dynamic network fee (CoinGecko real-time). Quote mode recipient-exact/sender-exact. Admin Multi-Chain Monitor. Gas Reserve Protection. Cancel-stale scheduler. 626+ unit tests."
      },
      {
        name: "Phase 7 — UX, Personalization & Optimization ✅",
        status: "complete",
        desc: "Complete i18n in 10 languages (IT, EN, ES, FR, DE, PT, JA, ZH, AR, RU). Themes, accents, and UI personalization. iOS-optimized emoji picker. Google Noto animated stickers. PWA session persistence and biometric-only lock. Admin R2 Monitor with cost forecast."
      },
      {
        name: "Phase 8 — Network Growth 🔄",
        status: "active",
        desc: "Structured user acquisition campaigns for privacy-first segments. Commercial merchant onboarding for AlphaBit Pay. Fintech operator partnerships. Cross-border remittance corridors. Qualitative target: 100K active users."
      },
      {
        name: "Phase 9 — Open Platform",
        status: "upcoming",
        desc: "Developer SDK and open APIs for B2B integrations. Decentralized identity federation. Cross-chain settlement via attested bridges. AlphaBit governance framework. The full sovereign communication and payment infrastructure for the open internet."
      }
    ]
  },
  heroPrivate: {
    badge: "Signal Protocol · X3DH + Double Ratchet",
    headline: "Private conversations.",
    headline2: "Protected by design.",
    sub: "Every message is encrypted with Signal Protocol. The server is a blind relay — never has access to plaintext, by mathematical design.",
    chat: [
      { side: "left",  text: "Did you review the contract?" },
      { side: "right", text: "Yes — everything's in order. Let's proceed." },
      { side: "left",  text: "I'm sending you the payment now." },
      { side: "right", text: "Received. Thank you!", usda: false },
    ],
    lock: "End-to-end encrypted",
  },
  heroPayment: {
    badge: "USDA · Polygon · Multi-Chain",
    headline: "Money moves at the",
    headline2: "speed of conversation.",
    tagline: ["No banks.", "No borders.", "No waiting."],
    sub: "Send stablecoins directly in chat. On-chain cryptographic escrow. Alchemy verification. Self-custodial signing.",
    amount: "+$250 USDA",
    status: "Payment complete",
    escrow: "On-chain Escrow",
  },
  heroTransfer: {
    badge: "Polygon · Ethereum · BSC · Bitcoin",
    headline: "Send. Receive.",
    headline2: "Across four blockchains.",
    sub: "Cryptographically secure escrow. Anti-replay. Atomic lock. Pure state machine. Verified on-chain before release.",
    fromLabel: "Sender",
    toLabel: "Recipient",
    steps: ["Deposit", "Escrow", "Verify", "Release"],
    network: "Multi-Chain",
  },
  heroWallet: {
    badge: "Alpha Wallet · BIP-39/44 · 4 Chains",
    headline: "Your money,",
    headline2: "mathematically yours.",
    sub: "Self-custodial HD wallet. BIP-39/44. secp256k1 EVM + Native SegWit BTC. Keys never transmitted. Ever.",
    balance: "3,840.00",
    currency: "USD equiv.",
    actions: ["Send", "Receive", "History", "QR"],
    history: [
      { label: "ETH received — Ethereum", amount: "+0.42 ETH", date: "Today, 14:32" },
      { label: "USDT sent — Polygon",     amount: "-250 USDT", date: "Today, 11:08" },
      { label: "BTC received — Mainnet",  amount: "+0.005 BTC", date: "Yesterday" },
    ],
  },
  heroMerchant: {
    badge: "AlphaBit Pay · Merchant Rails",
    headline: "Payments that live",
    headline2: "inside the conversation.",
    sub: "From customer to merchant. In-chat. On-chain. Across four blockchains. Instant.",
    steps: [
      { label: "Customer", icon: "👤" },
      { label: "Chat",     icon: "💬" },
      { label: "Payment",  icon: "💸" },
      { label: "Escrow",   icon: "🔒" },
      { label: "Verify",   icon: "⛓️" },
      { label: "Merchant", icon: "🏪" },
    ],
    note: "The same reliability as Stripe — built natively inside the conversation, on blockchain.",
  },
  closing: {
    title: "The Vision Forward",
    takeaways: [
      "AlphaChat has built the world's only platform where Signal E2E, multi-chain self-custodial wallet, and on-chain payment coexist in a single conversation.",
      "The zero-knowledge architecture mathematically guarantees the server can never read messages or access private keys — not by policy, by design.",
      "The AlphaBit ecosystem is the scalable foundation for the new paradigm: private communication + value transfer as a single digital primitive."
    ],
    linksTitle: "Official Links",
    contactTitle: "Press Contact"
  }
};
