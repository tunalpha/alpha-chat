import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LockProvider, useLock } from "./contexts/LockContext";
import { CallProvider, useCall } from "./contexts/CallContext";
import { WebSocketProvider, useWs } from "./contexts/WebSocketContext";
import { AppSettingsProvider } from "./contexts/AppSettingsContext";
import IncomingCallModal from "./components/IncomingCallModal";
import ActiveCallScreen from "./components/ActiveCallScreen";
import LandingPage from "./pages/LandingPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import SecuritySettingsPage from "./pages/SecuritySettingsPage";
import PhoenixSetupPage from "./pages/PhoenixSetupPage";
import DevicesPage from "./pages/DevicesPage";
import PrivacyPage from "./pages/PrivacyPage";
import ComingSoonPage from "./pages/ComingSoonPage";
import ArchivioPage from "./pages/ArchivioPage";
import WalletCenterPage from "./pages/WalletCenterPage";
import UsdaSettingsPage from "./pages/UsdaSettingsPage";
import EmergencyPage from "./pages/EmergencyPage";
import SecurityCenterPage from "./pages/SecurityCenterPage";
import DeadManSwitchPage from "./pages/DeadManSwitchPage";
import RecoveryContactsPage from "./pages/RecoveryContactsPage";
import RecoveryDashboardPage from "./pages/RecoveryDashboardPage";
import SecurityTimelinePage from "./pages/SecurityTimelinePage";
import TrustCenterPage from "./pages/TrustCenterPage";
import RecoverySettingsPage from "./pages/RecoverySettingsPage";
import RecoveryPage from "./pages/RecoveryPage";
import ForcePasswordChangePage from "./pages/ForcePasswordChangePage";
import LockScreen from "./components/LockScreen";
import PrivacyOverlay from "./components/PrivacyOverlay";
import BusyCallScreen from "./components/BusyCallScreen";
import CallHistoryPage from "./pages/CallHistoryPage";
import CallSettingsPage from "./pages/CallSettingsPage";
import AppearancePage from "./pages/AppearancePage";
import NotificationsPage from "./pages/NotificationsPage";
import LanguagePage from "./pages/LanguagePage";
import NuclearDestroyPage from "./pages/NuclearDestroyPage";
import { useNotifSync } from "./hooks/useNotifSync";
import { initServiceWorker, requestAndSubscribe as pushSubscribe } from "./lib/pushManager";
import SignalReinstallBanner from "./components/SignalReinstallBanner";

export type AppView =
  | "chat"
  | "profile"
  | "settings"
  | "security"
  | "phoenix"
  | "devices"
  | "privacy"
  | "archive"
  | "security-center"
  | "dead-man-switch"
  | "recovery-contacts"
  | "recovery-dashboard"
  | "security-timeline"
  | "trust-center"
  | "group-info"
  | "recovery-settings"
  | "call-history"
  | "call-settings"
  | "appearance"
  | "notifications-settings"
  | "language"
  | "nuclear-destroy"
  | "wallet-center"
  | "usda-settings";

/** Controlla se l'URL corrente è la pagina di emergenza (accessibile senza auth). */
function isEmergencyPath(): boolean {
  return window.location.pathname === "/emergency" ||
    window.location.pathname.endsWith("/emergency");
}

function AppContent() {
  const { auth, isLoading, logout, logoutAll, clearPasswordChangeRequired, updateAuth } = useAuth();
  const { isLocked, showPrivacy, hasPINSet, biometricOnlyEnabled } = useLock();
  const { on, send: wsSend } = useWs();
  const { setWsSend, handleWsCallEvent } = useCall();
  const [view, setView] = useState<AppView>("chat");

  // ── Registra il sender WS nel CallContext ─────────────────────────────────
  useEffect(() => { setWsSend(wsSend); }, [wsSend, setWsSend]);

  // ── Routing eventi call + phoenix — sempre attivo, indipendente dalla vista ─
  // Questi eventi devono essere consegnati anche quando ChatPage non è montata
  // (utente su LockScreen, ProfilePage, SettingsPage, ecc.).
  useEffect(() => {
    return on((event) => {
      switch (event.type) {
        case "call.incoming":
        case "call.answered":
        case "call.ice_candidate":
        case "call.rejected":
        case "call.ended":
        case "call.busy":
        case "call.missed":
        case "call.ended_elsewhere":
          handleWsCallEvent(event.type, event.payload as Record<string, unknown>);
          break;
        case "phoenix:lock":
          void logout();
          break;
        case "phoenix:destroy":
          localStorage.clear();
          sessionStorage.clear();
          void logout();
          break;
      }
    });
  }, [on, handleWsCallEvent, logout]);

  // Sincronizza le impostazioni notifiche dal backend quando l'utente è autenticato
  useNotifSync(auth?.userId ?? null);

  // ── Web Push: inizializza SW e rinnova subscription ad ogni login ─────────
  useEffect(() => {
    if (!auth?.userId) return;
    void initServiceWorker().then(() => pushSubscribe()).catch(() => {});
  }, [auth?.userId]);

  // ── Web Push: navigazione push → conversazione corretta ──────────────────
  // Gestisce due scenari:
  // 1. App aperta: il SW invia postMessage → dispatch CustomEvent → ChatPage ascolta
  // 2. App chiusa: il SW apre /?push_conv=<id> → letto qui all'avvio
  useEffect(() => {
    if (!auth?.userId) return;

    // Scenario 2: app aperta dal click sulla notifica con URL param
    const params = new URLSearchParams(window.location.search);
    const pushConv = params.get("push_conv");
    if (pushConv) {
      // Rimuove il param dall'URL senza reload
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      window.dispatchEvent(new CustomEvent("push:open-conversation", { detail: { convId: pushConv } }));
    }

    // Scenario 1: app già aperta, il SW invia postMessage
    const onSwMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; conversationId?: string; callerId?: string };
      console.log('[DIAG-CP3] App.tsx onSwMessage ricevuto:', msg?.type, msg);
      if (msg?.type === "push.openConversation" && msg.conversationId) {
        window.dispatchEvent(new CustomEvent("push:open-conversation", { detail: { convId: msg.conversationId } }));
      }
      if (msg?.type === "push.openCall") {
        // Il server re-invia call.incoming via WS al callee che si riconnette
        // (pendingCalls in WsManager). Non c'è nulla da fare qui: IncomingCallModal
        // è sempre montata e apparirà non appena il WS consegna l'evento.
        console.log('[WS] push.openCall: callerId=', msg.callerId, '— call.incoming sarà re-consegnato via WS');
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  }, [auth?.userId]);

  // Pagina di emergenza — accessibile senza autenticazione
  if (isEmergencyPath()) return <EmergencyPage />;

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading-logo">α</div>
        <div className="app-loading-text">Caricamento…</div>
      </div>
    );
  }

  if (!auth) return <LandingPage />;

  if ((hasPINSet || biometricOnlyEnabled) && isLocked) return <LockScreen />;

  // Sprint 22: cambio password obbligatorio dopo recovery con password temporanea
  if (auth.requirePasswordChange) {
    return (
      <ForcePasswordChangePage
        onComplete={() => clearPasswordChangeRequired()}
        onLogout={async () => { await logout(); }}
      />
    );
  }

  const goBack = () => setView("chat");
  const goSettings = () => setView("settings");

  return (
    <>
      {showPrivacy && <PrivacyOverlay />}
      <SignalReinstallBanner />

      {(() => {
        switch (view) {
          case "profile":
            return <ProfilePage auth={auth} onBack={goBack} onAuthUpdate={updateAuth} />;
          case "settings":
            return <SettingsPage onBack={goBack} onNavigate={setView} />;
          case "security":
            return <SecuritySettingsPage onBack={goSettings} onNavigate={setView} />;
          case "nuclear-destroy":
            return <NuclearDestroyPage onBack={goSettings} />;
          case "phoenix":
            return <PhoenixSetupPage onBack={goSettings} />;
          case "devices":
            return (
              <DevicesPage
                auth={auth}
                onBack={goBack}
                onLoggedOut={() => { void logoutAll(); }}
              />
            );
          case "privacy":
            return <PrivacyPage onBack={goBack} />;
          case "archive":
            return <ArchivioPage onBack={goBack} onOpen={(_convId) => { goBack(); /* naviga a conversazione */ }} />;
          case "security-center":
            return <SecurityCenterPage onClose={goSettings} />;
          case "dead-man-switch":
            return <DeadManSwitchPage onBack={goSettings} />;
          case "recovery-contacts":
            return <RecoveryContactsPage onBack={goSettings} />;
          case "recovery-dashboard":
            return <RecoveryDashboardPage onBack={goSettings} onNavigate={setView} />;
          case "security-timeline":
            return <SecurityTimelinePage onBack={goSettings} />;
          case "trust-center":
            return <TrustCenterPage onBack={goSettings} onNavigate={setView} />;
          case "recovery-settings":
            return <RecoverySettingsPage onBack={goSettings} />;
          case "call-history":
            return <CallHistoryPage onBack={goBack} />;
          case "call-settings":
            return <CallSettingsPage onBack={goBack} />;
          case "appearance":
            return <AppearancePage onBack={goSettings} />;
          case "notifications-settings":
            return <NotificationsPage onBack={goSettings} />;
          case "language":
            return <LanguagePage onBack={goSettings} />;
          case "wallet-center":
            return <WalletCenterPage onBack={goBack} />;
          case "usda-settings":
            return <UsdaSettingsPage onBack={goSettings} />;
          // group-info è gestito come overlay dentro ChatPage
          default:
            return <ChatPage onNavigate={setView} />;
        }
      })()}
    </>
  );
}

export default function App() {
  return (
    <AppSettingsProvider>
      <AuthProvider>
        <LockProvider>
          <WebSocketProvider>
            <CallProvider>
              <AppContent />
              <IncomingCallModal />
              <ActiveCallScreen />
              <BusyCallScreen />
            </CallProvider>
          </WebSocketProvider>
        </LockProvider>
      </AuthProvider>
    </AppSettingsProvider>
  );
}
