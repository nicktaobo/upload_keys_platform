import { Alert, Button, Form, Input, Typography } from "antd";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import type { SessionUser } from "../api/client";
import { useI18n } from "../app/i18n";

export function LoginPage({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async ({ username, password }: { username: string; password: string }) => {
    setBusy(true); setError(null);
    try { onLogin((await api.login(username, password)).user); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("login.failed", "Sign in failed")); }
    finally { setBusy(false); }
  };
  return <main className="login-page"><section className="login-panel">
    <div className="brand-mark"><KeyRound size={22} /><span>KeyHub</span></div>
    <Typography.Title level={2}>{t("login.title", "Sign in")}</Typography.Title>
    <Typography.Paragraph type="secondary">{t("login.subtitle", "Access your supplier Key workspace.")}</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} />}
    <Form layout="vertical" requiredMark={false} onFinish={submit}>
      <Form.Item label={t("login.username", "Username")} name="username" rules={[{ required: true, message: t("login.enterUsername", "Enter your username") }]}><Input autoComplete="username" autoFocus /></Form.Item>
      <Form.Item label={t("login.password", "Password")} name="password" rules={[{ required: true, message: t("login.enterPassword", "Enter your password") }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Button block type="primary" htmlType="submit" loading={busy}>{t("login.signIn", "Sign in")}</Button>
    </Form>
  </section></main>;
}
