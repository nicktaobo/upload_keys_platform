import { Button, ConfigProvider, Drawer, Layout, Menu, Select, Tooltip, Typography } from "antd";
import { Activity, Database, KeyRound, LogOut, Menu as MenuIcon, Send, Server, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { SessionUser } from "../api/client";
import { LoginPage } from "../pages/LoginPage";
import { KeysPage } from "../pages/KeysPage";
import { SubmitPage } from "../pages/SubmitPage";
import { AdminKeysPage } from "../pages/admin/KeysPage";
import { OperationsPage } from "../pages/admin/OperationsPage";
import { UpstreamPage } from "../pages/admin/UpstreamPage";
import { UsersPage } from "../pages/admin/UsersPage";
import { useI18n } from "./i18n";
import { I18nProvider } from "./i18n";
import "./styles.css";

const theme = { token: { colorPrimary: "#176b5b", colorInfo: "#176b5b", colorBgLayout: "#f5f6f7", colorBorderSecondary: "#e2e5e8", borderRadius: 6, fontSize: 14 }, components: { Layout: { siderBg: "#18211f", headerBg: "#ffffff" }, Menu: { darkItemBg: "#18211f", darkItemSelectedBg: "#28443e" }, Table: { headerBg: "#f3f5f5" } } };

function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const location = useLocation(), navigate = useNavigate(), [drawer, setDrawer] = useState(false);
  const { language, setLanguage, t } = useI18n();
  const userItems = [{ key: "/keys", icon: <Database size={17} />, label: <Link to="/keys">{t("nav.keys")}</Link> }, { key: "/submit", icon: <Send size={17} />, label: <Link to="/submit">{t("nav.submit")}</Link> }];
  const adminItems = [{ key: "/admin/users", icon: <Users size={17} />, label: <Link to="/admin/users">{t("nav.users")}</Link> }, { key: "/admin/keys", icon: <Database size={17} />, label: <Link to="/admin/keys">{t("nav.allKeys")}</Link> }, { key: "/admin/upstream", icon: <Server size={17} />, label: <Link to="/admin/upstream">{t("nav.upstream")}</Link> }, { key: "/admin/operations", icon: <Activity size={17} />, label: <Link to="/admin/operations">{t("nav.operations")}</Link> }];
  const items = user.role === "admin" ? adminItems : userItems;
  const nav = <><div className="sidebar-brand"><KeyRound size={20} /><span>KeyHub</span></div><Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={items} onClick={() => setDrawer(false)} /></>;
  return <Layout className="app-layout"><Layout.Sider className="desktop-sider" width={216}>{nav}</Layout.Sider><Drawer className="mobile-drawer" placement="left" width={240} open={drawer} onClose={() => setDrawer(false)} styles={{ body: { padding: 0, background: "#18211f" } }}>{nav}</Drawer><Layout><Layout.Header className="topbar"><Button className="mobile-menu" aria-label="Open navigation" type="text" icon={<MenuIcon size={20} />} onClick={() => setDrawer(true)} /><div className="topbar-spacer" /><Select aria-label={t("action.language")} size="small" value={language} onChange={setLanguage} options={[{ value: "en", label: t("language.en") }, { value: "zh", label: t("language.zh") }]} /><Typography.Text>{user.username}</Typography.Text><Tooltip title={t("action.signOut")}><Button aria-label={t("action.signOut")} type="text" icon={<LogOut size={18} />} onClick={async () => { await api.logout().catch(() => undefined); onLogout(); navigate("/login"); }} /></Tooltip></Layout.Header><Layout.Content className="content"><Routes><Route path="/keys" element={user.role === "user" ? <KeysPage /> : <Navigate to="/admin/users" replace />} /><Route path="/submit" element={user.role === "user" ? <SubmitPage /> : <Navigate to="/admin/users" replace />} /><Route path="/admin/users" element={user.role === "admin" ? <UsersPage /> : <Navigate to="/keys" replace />} /><Route path="/admin/keys" element={user.role === "admin" ? <AdminKeysPage /> : <Navigate to="/keys" replace />} /><Route path="/admin/upstream" element={user.role === "admin" ? <UpstreamPage /> : <Navigate to="/keys" replace />} /><Route path="/admin/operations" element={user.role === "admin" ? <OperationsPage /> : <Navigate to="/keys" replace />} /><Route path="*" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/keys"} replace />} /></Routes></Layout.Content></Layout></Layout>;
}

function AppRoutes() {
  const [user, setUser] = useState<SessionUser | null>(null), [checking, setChecking] = useState(true); const navigate = useNavigate();
  useEffect(() => { api.me().then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="boot-state" aria-label="Loading KeyHub"><KeyRound size={28} /></div>;
  if (!user) return <Routes><Route path="*" element={<LoginPage onLogin={(nextUser) => { setUser(nextUser); navigate(nextUser.role === "admin" ? "/admin/users" : "/keys"); }} />} /></Routes>;
  return <Shell user={user} onLogout={() => setUser(null)} />;
}

export function App() { return <I18nProvider><ConfigProvider theme={theme}><BrowserRouter><AppRoutes /></BrowserRouter></ConfigProvider></I18nProvider>; }
