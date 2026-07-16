import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LockProvider, useLock } from "./contexts/LockContext";
import { CallProvider } from "./contexts/CallContext";
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
  | "recovery-settings";

/** Controlla se l'URL corrente è la pagina di emergenza (accessibile senza auth). */
function isEmergencyPath(): boolean {
  return window.location.pathname === "/emergency" ||
    window.location.pathname.endsWith("/emergency");
}

function AppContent() {
  const { auth, isLoading, logout, logoutAll, clearPasswordChangeRequired } = useAuth();
  const { isLocked, showPrivacy, hasPINSet } = useLock();
  const [view, setView] = useState<AppView>("chat");

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

  if (hasPINSet && isLocked) return <LockScreen />;

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

      {(() => {
        switch (view) {
          case "profile":
            return <ProfilePage auth={auth} onBack={goBack} />;
          case "settings":
            return <SettingsPage onBack={goBack} onNavigate={setView} />;
          case "security":
            return <SecuritySettingsPage onBack={goSettings} />;
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
    <AuthProvider>
      <LockProvider>
        <CallProvider>
          <AppContent />
          <IncomingCallModal />
          <ActiveCallScreen />
        </CallProvider>
      </LockProvider>
    </AuthProvider>
  );
}
