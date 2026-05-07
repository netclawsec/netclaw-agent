import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { usePlugins } from "@/plugins";
import { MainShell } from "@/components/shell/MainShell";

// New product pages
import LoginPage from "@/pages/LoginPage";
import CommandCenter from "@/pages/CommandCenter";
import SocialPage from "@/pages/SocialPage";
import VideoStudioPage from "@/pages/VideoStudioPage";
import ImageStudioPage from "@/pages/ImageStudioPage";
import AgentChatPage from "@/pages/AgentChatPage";
import WechatPage from "@/pages/WechatPage";
import AnalyticsNewPage from "@/pages/AnalyticsNewPage";
import SettingsPage from "@/pages/SettingsPage";
import AccountPage from "@/pages/AccountPage";
import SettingsGeneralPage from "@/pages/settings/GeneralPage";
import SettingsModelsPage from "@/pages/settings/ModelsPage";
import SettingsPluginsPage from "@/pages/settings/PluginsPage";

// Existing ops pages — relocated under /settings/runtime/* (Phase 9 consolidation)
import StatusPage from "@/pages/StatusPage";
import ConfigPage from "@/pages/ConfigPage";
import EnvPage from "@/pages/EnvPage";
import SessionsPage from "@/pages/SessionsPage";
import LogsPage from "@/pages/LogsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import CronPage from "@/pages/CronPage";
import SkillsPage from "@/pages/SkillsPage";

export default function App() {
  const { plugins } = usePlugins();
  const location = useLocation();

  // /login: full-screen, no AppShell
  if (location.pathname === "/login") {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    );
  }

  // Main app: MainShell wraps every primary product route.
  return (
    <MainShell>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/social" element={<SocialPage />} />
        <Route path="/studio/video" element={<VideoStudioPage />} />
        <Route path="/studio/image" element={<ImageStudioPage />} />
        <Route path="/wechat" element={<WechatPage />} />
        <Route path="/agent-chat" element={<AgentChatPage />} />
        <Route path="/analytics" element={<AnalyticsNewPage />} />

        {/* Settings hub — section index + nested ops 8 pages */}
        <Route path="/settings" element={<SettingsPage />}>
          <Route path="account" element={<AccountPage />} />
          <Route path="general" element={<SettingsGeneralPage />} />
          <Route path="models" element={<SettingsModelsPage />} />
          <Route path="plugins" element={<SettingsPluginsPage />} />
          <Route path="runtime" element={<Navigate to="/settings/runtime/status" replace />} />
          <Route path="runtime/status" element={<StatusPage />} />
          <Route path="runtime/sessions" element={<SessionsPage />} />
          <Route path="runtime/logs" element={<LogsPage />} />
          <Route path="runtime/cron" element={<CronPage />} />
          <Route path="runtime/skills" element={<SkillsPage />} />
          <Route path="runtime/config" element={<ConfigPage />} />
          <Route path="runtime/env" element={<EnvPage />} />
          <Route path="runtime/analytics" element={<AnalyticsPage />} />
        </Route>

        {/* Legacy URLs — redirect into Settings runtime tabs (preserve external links) */}
        <Route path="/sessions" element={<Navigate to="/settings/runtime/sessions" replace />} />
        <Route path="/logs" element={<Navigate to="/settings/runtime/logs" replace />} />
        <Route path="/cron" element={<Navigate to="/settings/runtime/cron" replace />} />
        <Route path="/skills" element={<Navigate to="/settings/runtime/skills" replace />} />
        <Route path="/config" element={<Navigate to="/settings/runtime/config" replace />} />
        <Route path="/env" element={<Navigate to="/settings/runtime/env" replace />} />

        {/* Plugin routes — preserved at top level */}
        {plugins.map(({ manifest, component: PluginComponent }) => (
          <Route
            key={manifest.name}
            path={manifest.tab.path}
            element={<PluginComponent />}
          />
        ))}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MainShell>
  );
}
