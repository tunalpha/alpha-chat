export const en = {
  nav: {
    readEn: "EN",
    readIt: "IT",
    contact: "Contact",
    download: "Download PDF",
  },
  cover: {
    title: "AlphaChat",
    badge: "Investor Book",
    subtitle: "Private communication. Integrated payments. One ecosystem.",
  },
  founder: {
    title: "The Founder",
    name: "Enrico Maria Giaquinta",
    alias: 'alias "Alpha"',
    role: "Founder & Chief Architect",
    paragraphs: [
      "Enrico Maria Giaquinta, known by the pseudonym \"Alpha\", is an Italian entrepreneur, software architect, and technological innovator. With over 15 years of experience in blockchain technology, digital payment systems, and secure communications, he has designed and engineered numerous web platforms and digital infrastructure projects.",
      "As the founder of AlphaBit and creator of AlphaChat, he leads the strategic vision, architectural design, and product evolution. His work is characterized by a low public profile, choosing instead to let the engineering and the robustness of his systems speak for themselves.",
      "Beyond technology, he is the founder of Felinia, an independent initiative dedicated to the care and protection of stray cats, reflecting a personal commitment to social impact."
    ],
    philosophyTitle: "Engineering Philosophy",
    philosophy: [
      {
        title: "Simplicity",
        desc: "Technology should eliminate complexity, not create it."
      },
      {
        title: "Security",
        desc: "Data protection and privacy must be integrated from the architectural foundation."
      },
      {
        title: "Long-term Vision",
        desc: "Platforms must be designed to evolve without ever losing reliability."
      }
    ],
    quote: "Technology should never replace human relationships. It should make them safer, simpler and freer."
  },
  founderLetter: {
    title: "Founder Letter",
    greeting: "To our future partners,",
    paragraphs: [
      "I started building AlphaChat because the way we communicate digitally is fundamentally broken. We have accepted a reality where our most intimate conversations are mined for data, where digital identity is rented rather than owned, and where sending value to a friend requires leaving the conversation to use a disconnected, often archaic, financial system.",
      "The communication layer and the settlement layer should be the same space.",
      "With AlphaChat, we are not just building another messaging app. We are building a secure, sovereign digital environment. By integrating the Signal protocol for end-to-end encryption and Polygon for instant, stablecoin-based settlement, we've created a seamless experience. Your messages are mathematically yours. Your money is cryptographically yours.",
      "The AlphaBit ecosystem is designed for the long term. It is grounded in the belief that privacy is a right, not a feature, and that payments belong where relationships happen—inside the conversation.",
      "This book details the architecture, the market positioning, and the vision. We invite you to look closely at the foundation we have built.",
      "— Alpha"
    ]
  },
  story: {
    title: "Why AlphaChat Exists",
    subtitle: "The narrative before the product.",
    sections: [
      {
        title: "The Fragmentation of Communication",
        desc: "Modern interactions are scattered across dozens of platforms. We message on one app, pay on another, and verify identity on a third. This friction degrades the user experience and slows down commerce."
      },
      {
        title: "Privacy as a Fundamental Right",
        desc: "The surveillance economy has commodified human interaction. We believe that privacy is not a luxury or an opt-in feature; it is the default state of free digital societies."
      },
      {
        title: "The Changing Digital Identity",
        desc: "Identity is moving from centralized databases to cryptographic self-sovereignty. Users demand control over who they are online and who can access their data."
      },
      {
        title: "Payments Belong Inside Conversation",
        desc: "Value transfer is essentially a form of communication. Moving money should be as instantaneous, secure, and native to a chat interface as sending a text message."
      }
    ]
  },
  product: {
    title: "The Product: AlphaChat",
    subtitle: "A unified application engineered for uncompromising privacy and integrated value transfer.",
    facts: [
      {
        title: "End-to-End Encryption",
        desc: "Built on the Signal protocol (X3DH, Double Ratchet, one-time prekeys). Multi-device support with strictly per-device sessions."
      },
      {
        title: "Encrypted Media & Storage",
        desc: "E2E encrypted media (AES-256-GCM per blob, Signal-wrapped keys). Encrypted local cache with E2E thumbnails."
      },
      {
        title: "Identity & Trust",
        desc: "TOFU (Trust On First Use) model. Verified through Safety Numbers, QR code verification, and key-change alerts."
      },
      {
        title: "Secure Calls",
        desc: "WebRTC with encrypted signaling, ICE restart resilience, and call verification against cryptographic key bundles."
      },
      {
        title: "Group Chats",
        desc: "Fully end-to-end encrypted via per-member Signal fan-out architecture."
      },
      {
        title: "Account Resilience",
        desc: "Recovery Card, Phoenix Protocol (emergency lock/destroy with argon2id-protected code), Dead Man Switch, recovery contacts, and full security timeline audit."
      },
      {
        title: "Progressive Web App",
        desc: "Installable, offline-tolerant, push notifications via VAPID, localized in 10 languages."
      },
      {
        title: "Zero-Knowledge Stance",
        desc: "The server acts as a blind relay and never sees plaintext. Metadata is strictly minimized."
      }
    ]
  },
  paymentLayer: {
    title: "The Payment Layer: USDA",
    subtitle: "Digital dollars, natively integrated.",
    desc: "USDA is an ERC-20 digital dollar stablecoin operating on the Polygon blockchain, acting as the native settlement asset inside AlphaChat.",
    features: [
      {
        title: "In-Chat Escrow Engine",
        desc: "Send and request funds directly in conversation. Features a deposit → claim/release flow with on-chain verification, anti-replay protection, and atomic locking."
      },
      {
        title: "Non-Custodial Wallets",
        desc: "Users maintain complete control over their funds. Deep integration via WalletConnect/Reown supporting MetaMask, Rainbow, Coinbase, Trust, and Phantom."
      },
      {
        title: "Automated Gas Station",
        desc: "Frictionless UX with automated MATIC top-ups, abstracting away the complexities of blockchain network fees."
      },
      {
        title: "External Payment Links",
        desc: "Link-based payment requests powered by getusda.xyz, bridging external users into the AlphaChat payment layer."
      }
    ]
  },
  ecosystem: {
    title: "The Ecosystem: AlphaBit",
    subtitle: "One coherent stack.",
    desc: "AlphaBit is the ecosystem. AlphaChat is the flagship consumer interface. USDA is the native payment layer. AlphaBit Pay is the merchant infrastructure. They do not compete; they compound.",
    labels: {
      user: "User",
      alphaChat: "AlphaChat",
      usda: "USDA Rails",
      alphaBitPay: "AlphaBit Pay",
      merchants: "Merchants"
    }
  },
  architecture: {
    title: "System Architecture",
    subtitle: "Edge encryption. Blind relays. Decentralized settlement.",
    labels: {
      clients: "Clients (PWA Multi-device)",
      e2e: "E2E Layer (Signal Protocol)",
      backend: "API + WebSocket Backend",
      db: "MongoDB + R2 Object Storage",
      blockchain: "Polygon Blockchain"
    }
  },
  competitive: {
    title: "Competitive Landscape",
    subtitle: "Positioning through objective architectural choices.",
    messaging: {
      title: "Messaging Platforms",
      columns: ["Platform", "E2E Default", "Independence", "Integrated Payments", "Self-Sovereign Recovery"],
      rows: [
        { name: "AlphaChat", e2e: "Yes", ind: "Yes", pay: "Native (USDA)", rec: "Yes (Phoenix/Cards)" },
        { name: "Signal", e2e: "Yes", ind: "Yes", pay: "Limited (MobileCoin)", rec: "PIN based" },
        { name: "WhatsApp", e2e: "Yes", ind: "No (Meta)", pay: "Fiat/Regional", rec: "Cloud backup" },
        { name: "Telegram", e2e: "No (Opt-in)", ind: "Yes", pay: "TON integration", rec: "Centralized" },
        { name: "iMessage", e2e: "Yes", ind: "No (Apple)", pay: "Apple Pay (Fiat)", rec: "Cloud tied" }
      ]
    },
    payments: {
      title: "Payment Processors",
      desc: "Traditional processors (Stripe, PayPal, Adyen, Square) focus on merchant checkout pages. AlphaChat shifts value transfer to conversation-native flows, bypassing traditional acquiring friction.",
      columns: ["Player", "Primary Surface", "Settlement Rail", "Relationship to Conversation"],
      rows: [
        { name: "AlphaBit Pay + USDA", surface: "In-chat & merchant rails", rail: "Stablecoin on Polygon", rel: "Native — payment lives inside the conversation" },
        { name: "Stripe", surface: "Merchant checkout & APIs", rail: "Card networks / bank rails", rel: "External — invoked from apps and websites" },
        { name: "PayPal", surface: "Wallet & checkout buttons", rail: "Proprietary wallet + banks", rel: "Adjacent — P2P exists, separate from messaging" },
        { name: "Adyen", surface: "Enterprise acquiring", rail: "Card networks / local rails", rel: "External — back-end processor for merchants" },
        { name: "Square", surface: "POS & SMB commerce", rail: "Card networks", rel: "External — physical and online retail focus" }
      ]
    },
    stablecoins: {
      title: "Stablecoin Settlement",
      desc: "While USDC, USDT, and EURC are general-purpose market liquidity assets, USDA is optimized as an ecosystem-native settlement token on Polygon, engineered specifically for chat-based escrow and micro-transactions.",
      columns: ["Asset", "Peg", "Primary Role", "Ecosystem Positioning"],
      rows: [
        { name: "USDA", peg: "US Dollar", role: "Ecosystem-native settlement", pos: "Purpose-built for in-chat escrow and AlphaBit Pay flows on Polygon" },
        { name: "USDC", peg: "US Dollar", role: "General market liquidity", pos: "Broad exchange and DeFi usage, regulated issuer (Circle)" },
        { name: "USDT", peg: "US Dollar", role: "General market liquidity", pos: "Largest trading-pair liquidity across exchanges" },
        { name: "EURC", peg: "Euro", role: "Euro-denominated liquidity", pos: "Euro settlement for European market flows" }
      ]
    }
  },
  businessModel: {
    title: "Business Model",
    subtitle: "Sustainable economics powering free privacy.",
    points: [
      {
        title: "Consumer Freemium",
        desc: "AlphaChat remains free for core communication. Privacy is never put behind a paywall."
      },
      {
        title: "Merchant Infrastructure",
        desc: "AlphaBit Pay serves as the revenue engine, charging predictable routing and settlement fees for commercial transaction flows (alphabitpay.com)."
      },
      {
        title: "Payment-Flow Economics",
        desc: "Value captured through escrow services, automated gas abstractions, and cross-border settlement efficiencies."
      }
    ]
  },
  swot: {
    title: "SWOT Analysis",
    s: { title: "Strengths", items: ["Deeply integrated tech stack", "E2E depth & cryptographic rigor", "Clear Founder-led vision"] },
    w: { title: "Weaknesses", items: ["Early stage adoption", "Lack of existing network effects", "Complex onboarding for non-crypto natives"] },
    o: { title: "Opportunities", items: ["Rising global demand for privacy", "Stablecoin mass adoption", "De-platforming risks on major networks"] },
    t: { title: "Threats", items: ["Incumbent feature cloning", "Evolving regulatory frameworks", "Wallet dependency friction"] }
  },
  roadmap: {
    title: "Strategic Roadmap",
    phases: [
      { name: "Phase 1: Foundation", desc: "Core E2E protocol, PWA deployment, multi-device sync, and basic USDA integration." },
      { name: "Phase 2: Ecosystem Growth", desc: "Advanced Phoenix Protocol features, deeper WalletConnect integrations, and user acquisition." },
      { name: "Phase 3: Merchant Network", desc: "Rollout of AlphaBit Pay tools, external payment links, and commercial escrow APIs." },
      { name: "Phase 4: Open Platform", desc: "Developer SDKs, decentralized identity federation, and cross-chain settlement layers." }
    ]
  },
  closing: {
    title: "The Vision Forward",
    takeaways: [
      "Alpha had a clear, uncompromising vision for digital sovereignty.",
      "AlphaChat solves the fragmentation between private conversation and value transfer.",
      "The AlphaBit ecosystem provides the scalable foundation for this new paradigm."
    ],
    linksTitle: "Official Links",
    contactTitle: "Press Contact"
  }
};