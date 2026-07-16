import { useState } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LockProvider, useLock } from "./contexts/LockContext";
import LandingPage from "./pages/LandingPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import SecuritySettingsPage from "./pages/SecuritySettingsPage";
import DevicesPage from "./pages/DevicesPage";
import PrivacyPage from "./pages/PrivacyPage";
import ComingSoonPage from "./pages/ComingSoonPage";
import LockScreen from "./components/LockScreen";
import PrivacyOverlay from "./components/PrivacyOverlay";

export type AppView = "chat" | "profile" | "settings" | "security" | "devices" | "privacy" | "archive";

function AppContent() {
  const { auth, isLoading, logout, logoutAll } = useAuth();
  const { isLocked, showPrivacy, hasPINSet } = useLock();
  const [view, setView] = useState<AppView>("chat");

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading-logo">α</div>
        <div className="app-loading-text">Caricamento…</div>
      </div>
    );
  }

  if (!auth) return <LandingPage />;

  // Se il PIN è impostato e l'app è bloccata → mostra lock screen
  if (hasPINSet && isLocked) return <LockScreen />;

  const goBack = () => setView("chat");

  return (
    <>
      {/* Schermata privacy quando l'app va in background */}
      {showPrivacy && <PrivacyOverlay />}

      {(() => {
        switch (view) {
          case "profile":
            return <ProfilePage auth={auth} onBack={goBack} />;
          case "settings":
            return <SettingsPage onBack={goBack} onNavigate={setView} />;
          case "security":
            return <SecuritySettingsPage onBack={() => setView("settings")} />;
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
            return <ComingSoonPage title="Archivio" onBack={goBack} />;
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
        <AppContent />
      </LockProvider>
    </AuthProvider>
  );
}
