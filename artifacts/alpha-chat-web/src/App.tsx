import { useState } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LandingPage from "./pages/LandingPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import DevicesPage from "./pages/DevicesPage";
import PrivacyPage from "./pages/PrivacyPage";
import ComingSoonPage from "./pages/ComingSoonPage";

export type AppView = "chat" | "profile" | "settings" | "devices" | "privacy" | "archive";

function AppContent() {
  const { auth, isLoading, logout, logoutAll } = useAuth();
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

  const goBack = () => setView("chat");

  switch (view) {
    case "profile":
      return <ProfilePage auth={auth} onBack={goBack} />;
    case "settings":
      return <SettingsPage onBack={goBack} />;
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
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
