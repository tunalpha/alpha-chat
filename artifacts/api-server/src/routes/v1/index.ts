import { Router } from "express";
import systemRoutes from "./system.routes";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import conversationRoutes from "./conversation.routes";
import messageRoutes from "./message.routes";
import inviteRoutes from "./invite.routes";
import mediaRoutes from "./media.routes";
import keysRoutes from "./keys.routes";
import phoenixRoutes from "./phoenix.routes";
import deadManSwitchRoutes from "./dead-man-switch.routes";
import recoveryContactsRoutes from "./recovery-contacts.routes";
import securityTimelineRoutes from "./security-timeline.routes";
import recoveryDashboardRoutes from "./recovery-dashboard.routes";
import trustCenterRoutes from "./trust-center.routes";
import groupRoutes from "./group.routes";
import feedbackRoutes from "./feedback.routes";

/**
 * /api/v1/ — mounts all versioned sub-routers.
 */
const v1Router = Router();

v1Router.use("/", systemRoutes);
v1Router.use("/auth", authRoutes);
v1Router.use("/users", userRoutes);
v1Router.use("/conversations", conversationRoutes);
v1Router.use("/conversations/:conversationId/messages", messageRoutes);
v1Router.use("/invites", inviteRoutes);
v1Router.use("/media", mediaRoutes);
v1Router.use("/keys", keysRoutes);

// Phoenix Protocol — Sprint 18
v1Router.use("/phoenix", phoenixRoutes);

// Recovery & Continuity Center — Sprint 19
v1Router.use("/dead-man-switch", deadManSwitchRoutes);
v1Router.use("/recovery-contacts", recoveryContactsRoutes);
v1Router.use("/security-timeline", securityTimelineRoutes);
v1Router.use("/recovery-dashboard", recoveryDashboardRoutes);

// Trust Center — Sprint 20
v1Router.use("/trust-center", trustCenterRoutes);

// Gruppi E2E — Sprint 21
v1Router.use("/groups", groupRoutes);

// Segnalazioni utenti — canale e-mail isolato da pagamenti e swap
v1Router.use("/feedback", feedbackRoutes);

// Chiamate — Sprint 25
import callsRoutes from "./calls.routes";
v1Router.use("/calls", callsRoutes);

// Chiamate — State Machine REST API — Sprint 30 (modulo separato, zero regressioni)
import callSessionRoutes from "./call-session.routes";
v1Router.use("/calls", callSessionRoutes);

// Account Recovery — Sprint 22
import { recoveryAuthRouter, recoveryAccountRouter } from "./account-recovery.routes";
v1Router.use("/auth/recover",     recoveryAuthRouter);
v1Router.use("/account/recovery", recoveryAccountRouter);

// Admin Operations Center — Sprint 23
import adminRoutes from "./admin.routes";
v1Router.use("/admin", adminRoutes);

// Signal Audit — logging crittografico client → server
import signalAuditRoutes from "./signal-audit.routes";
v1Router.use("/signal/audit", signalAuditRoutes);

// Web Push Notifications — completamente separato dalla messaggistica
import pushRoutes from "./push.routes";
v1Router.use("/push", pushRoutes);

// Call Diagnostics Center — raccolta eventi dal client
import diagnosticsRoutes from "./diagnostics.routes";
v1Router.use("/diagnostics", diagnosticsRoutes);

// USDA Payments — adapter-layer (MockAdapter → HttpAdapter quando USDA_API_BASE_URL è configurato)
import usdaRoutes from "./usda.routes";
v1Router.use("/usda", usdaRoutes);

// Chat Payment Engine — P2P nativo, indipendente da getusda.xyz (Sprint 2)
import paymentRoutes from "./payment.routes";
v1Router.use("/payments", paymentRoutes);

// Investor Secure Access — Virtual Data Room gate
import investorRoutes from "./investor.routes";
v1Router.use("/investor", investorRoutes);

// Multi-Chain Payment Engine — Phase 2+ (additivo, zero regressioni USDA)
import multichainPaymentRoutes from "./multichain-payment.routes";
v1Router.use("/multichain", multichainPaymentRoutes);

// Multi-Chain Admin endpoints — monitoraggio e gestione trasferimenti
import adminMultichainRoutes from "./admin-multichain.routes";
v1Router.use("/admin/multichain", adminMultichainRoutes);

// Bitcoin Admin endpoints — Bitcoin Operations panel
import adminBitcoinRoutes from "./admin-bitcoin.routes";
v1Router.use("/admin/bitcoin", adminBitcoinRoutes);

// Alpha Wallet — Native self-custodial wallet (Phase B)
// ISOLAMENTO: completamente separato dal Payment Engine e da USDA
import alphaWalletRoutes from "./alpha-wallet.routes";
v1Router.use("/alpha-wallet", alphaWalletRoutes);

// Alpha Wallet Monitor — Admin monitoring (read-only)
import alphaWalletMonitorRoutes from "./admin-alpha-wallet-monitor.routes";
v1Router.use("/admin/alpha-wallet-monitor", alphaWalletMonitorRoutes);

// Spark/Lightning — Platform Fee config (Phase Spark)
// ISOLAMENTO: completamente separato da Alpha Wallet BTC, MultiChain, USDA.
// Default feature flag spark_lightning_enabled = false fino a go-live esplicito.
import sparkRoutes from "./spark.routes";
v1Router.use("/spark", sparkRoutes);

// Lightning Invoice Links — deep link pubblico per condivisione invoice BOLT11
// POST autenticato (crea link), GET pubblico (nessun dato personale).
import lightningRoutes from "./lightning.routes";
v1Router.use("/lightning/invoice-links", lightningRoutes);

// Alpha Swap — BTC↔Lightning swap module
// ISOLAMENTO: completamente separato da payment engine, USDA, MultiChain, Spark fee.
// SWAP_ENABLED = false — default protetto, abilitare solo dopo audit di sicurezza.
import swapRoutes from "./swap.routes";
v1Router.use("/swap", swapRoutes);

// Alpha Swap — EVM (Li.Fi) — completamente separato da BTC/Lightning.
// Fee 0.25% raccolta tramite Li.Fi Fee Forwarder (integrator: alpha-chat).
// NON modifica fee wallet, NON tocca payment engine esistente.
import evmSwapRoutes from "./evm-swap.routes";
v1Router.use("/swap/evm", evmSwapRoutes);

// Swap Provider Manager — infrastruttura admin per gestione provider EVM Swap.
// ISOLATO da Li.Fi operativo, payment engine, USDA, MultiChain.
// Solo admin autenticati possono leggere/modificare (requireAdmin nel router).
// ChangeNOW DISABLED — nessuna API ChangeNOW chiamata.
import swapProvidersRoutes from "./swap-providers.routes";
v1Router.use("/swap/providers", swapProvidersRoutes);

// ── ChangeNOW Swap — BTC→USDT (DISABLED di default, abilitabile da admin) ────
// ISOLATO: zero import da Li.Fi, payment engine, USDA, MultiChain, Spark.
// Richiede autenticazione JWT per tutti gli endpoint.
// La API key ChangeNOW è server-side only — MAI esposta al frontend.
import changeNowSwapRoutes from "./changenow-swap.routes";
v1Router.use("/swap/changenow", changeNowSwapRoutes);

import changeNowEvmSwapRoutes from "./changenow-evm-swap.routes.js";
v1Router.use("/swap/changenow/evm", changeNowEvmSwapRoutes);

// ── Buy with Card — Fiat→Crypto onramp (FASE 2) ───────────────────────────────
// ISOLATO: zero import da payment engine, swap, USDA, MultiChain, Spark.
// Provider stub (ChangeNOW Fiat) — richiede KYB completato per endpoint reali.
// FIAT_BUY_ENABLED=false di default — ogni endpoint operativo lancia 503.
// destinationAddress sempre da wallet Alpha verificato server-side, mai dall'utente.
import { buyRouter } from "./buy.routes";
v1Router.use("/buy", buyRouter);

export default v1Router;
