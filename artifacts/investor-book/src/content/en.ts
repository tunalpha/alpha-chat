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
      "USDA is not just a payment token — it is the proof that money can move at the speed of conversation. With getusda.xyz, anyone in the world can request or receive digital dollars instantly, without banks, without borders, without intermediaries.",
      "The AlphaBit ecosystem is designed for the long term. It is grounded in the belief that privacy is a right, not a feature, and that payments belong where relationships happen — inside the conversation.",
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
    subtitle: "Digital dollars at the speed of conversation.",
    desc: "USDA is not just another stablecoin — it is the missing bridge between private communication and global finance. An ERC-20 digital dollar engineered on Polygon, purpose-built as the native settlement asset inside AlphaChat. While the world's messaging apps treat payments as an afterthought, we built them into the DNA of every conversation.",
    features: [
      {
        title: "In-Chat Escrow Engine",
        desc: "Send and request funds directly in conversation. A cryptographically secured deposit → claim/release flow with on-chain verification, anti-replay protection, and atomic locking. No banks. No delays. No intermediaries."
      },
      {
        title: "Non-Custodial Wallets",
        desc: "Users maintain complete, sovereign control over their funds. Deep WalletConnect/Reown integration — MetaMask, Rainbow, Coinbase, Trust, and Phantom — so your money is always yours, not ours."
      },
      {
        title: "Automated Gas Station",
        desc: "Zero blockchain friction. Our Gas Station automatically tops up MATIC when needed, making on-chain transactions feel as effortless as sending a text. Users never touch network fees."
      },
      {
        title: "getusda.xyz — Global Payment Links",
        desc: "Payment requests that work for anyone, anywhere, without an AlphaChat account. Share a link. Get paid in stablecoins. No borders. No bank accounts required. The gateway to mainstream adoption."
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
  market: {
    title: "Market Opportunity",
    subtitle: "Three massive markets. One unified platform.",
    intro: "AlphaChat sits at the intersection of three of the fastest-growing sectors in the global digital economy. The timing is not accidental — it is architectural.",
    segments: [
      {
        icon: "💬",
        label: "Messaging",
        stat: "3.1B",
        unit: "daily active users",
        color: "purple",
        points: [
          "WhatsApp alone has 2B+ monthly active users",
          "Telegram surpassed 900M users in 2024",
          "Global OTT messaging market projected at $340B by 2030",
          "85% of internet users want more data privacy (Pew Research)",
          "Signal grew 1,200% in a single week following privacy concern spikes"
        ]
      },
      {
        icon: "💵",
        label: "Stablecoins",
        stat: "$180B+",
        unit: "total market cap",
        color: "green",
        points: [
          "Stablecoin transaction volume exceeded $10.8T in 2023 — surpassing Visa",
          "USDT market cap: ~$115B. USDC: ~$35B. Market expanding rapidly",
          "Stablecoin adoption growing 3x YoY in emerging markets (Chainalysis)",
          "Cross-border stablecoin remittances 80–90% cheaper than traditional wire transfers",
          "Regulated stablecoin frameworks accelerating in EU (MiCA), US, and Asia"
        ]
      },
      {
        icon: "🌐",
        label: "Digital Payments",
        stat: "$14T+",
        unit: "global transaction volume",
        color: "blue",
        points: [
          "Global digital payments market projected to reach $29T by 2030 (CAGR 11.5%)",
          "420M+ crypto users globally (Triple-A, 2024) — growing 15% annually",
          "P2P digital payment market to exceed $9T by 2030",
          "Crypto payment gateway market growing at 16.5% CAGR (2023–2030)",
          "60% of Gen Z and Millennials prefer instant digital payments over traditional banking"
        ]
      }
    ],
    conclusion: "No single platform today captures all three layers simultaneously — private communication, stablecoin settlement, and merchant payment infrastructure. AlphaChat is engineered to own this intersection."
  },
  swot: {
    title: "SWOT Analysis",
    s: {
      title: "Strengths",
      items: [
        "Deeply integrated tech stack — communication + payments in one sovereign environment",
        "Military-grade E2E encryption (Signal protocol) — the same standard used by governments",
        "USDA: proprietary stablecoin purpose-built for in-chat settlement on Polygon",
        "Guided onboarding — crypto-native UX that works for everyday users, not just techies",
        "Clear Founder-led vision with 15+ years of architectural depth"
      ]
    },
    w: {
      title: "Weaknesses",
      items: [
        "Early stage adoption — network effects still building",
        "Lack of existing large-scale network effects",
        "Dependency on WalletConnect ecosystem for external wallet integrations"
      ]
    },
    o: {
      title: "Opportunities",
      items: [
        "Rising global demand for privacy-first communication platforms",
        "Stablecoin mass adoption accelerating across emerging and developed markets",
        "De-platforming risks driving users to sovereign, independent networks",
        "Regulatory clarity (MiCA, US frameworks) legitimizing stablecoin-based commerce",
        "USDA expansion via getusda.xyz into global merchant and remittance flows"
      ]
    },
    t: {
      title: "Threats",
      items: [
        "Incumbent feature cloning by WhatsApp, Telegram, or big tech",
        "Evolving and fragmented regulatory frameworks across jurisdictions",
        "Wallet dependency friction for non-crypto-native users"
      ]
    }
  },
  roadmap: {
    title: "Strategic Roadmap",
    subtitle: "Where we have been. Where we are going.",
    phases: [
      {
        name: "Phase 1 — Foundation ✅",
        status: "complete",
        desc: "Core E2E protocol (Signal X3DH + Double Ratchet), PWA deployment, multi-device sync, VAPID push notifications, and initial USDA wallet integration. The bedrock is live."
      },
      {
        name: "Phase 2 — Security Fortress ✅",
        status: "complete",
        desc: "Phoenix Protocol (emergency account lock/destroy), biometric authentication (Face ID), Recovery Cards, Dead Man Switch, multi-device identity verification, Safety Numbers, and comprehensive security timeline audit."
      },
      {
        name: "Phase 3 — Payment Infrastructure ✅",
        status: "complete",
        desc: "Full in-chat escrow engine (deposit → claim/release with on-chain verification), Automated Gas Station with dynamic MATIC top-ups, getusda.xyz global payment links, AlphaBit Pay merchant rails, and anti-replay protection."
      },
      {
        name: "Phase 4 — USDA Expansion 🔄",
        status: "active",
        desc: "USDA off-ramp and on-ramp integrations for fiat conversion, expanded payment link ecosystem via getusda.xyz, multi-stablecoin routing, and USDA public API for third-party integrations. Turning USDA into an open financial primitive."
      },
      {
        name: "Phase 5 — Network Growth",
        status: "upcoming",
        desc: "Structured user acquisition campaigns targeting privacy-conscious demographics, AlphaBit Pay commercial merchant onboarding, partnerships with fintech operators and cross-border remittance corridors, 100K active user milestone."
      },
      {
        name: "Phase 6 — Open Platform",
        status: "upcoming",
        desc: "Developer SDKs and open APIs, decentralized identity federation, cross-chain settlement layers beyond Polygon, and AlphaBit ecosystem governance framework. The full sovereign communication and payment infrastructure for the open internet."
      }
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
