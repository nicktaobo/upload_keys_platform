import { Alert, Button, Descriptions, Form, Input, Space, Typography, message } from "antd";
import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { UpstreamConnection } from "../../api/client";
import { AsyncState } from "../../components/AsyncState";

const format = (value: string | null) => value ? new Date(value).toLocaleString() : "Never";
export function UpstreamPage() {
  const [connection, setConnection] = useState<UpstreamConnection | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false), [syncing, setSyncing] = useState(false);
  const [toast, context] = message.useMessage();
  useEffect(() => { api.upstream().then(setConnection).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load connection")).finally(() => setLoading(false)); }, []);
  const save = async ({ username, password }: { username: string; password: string }) => { setSaving(true); try { await api.saveUpstream(username, password); toast.success("Credentials saved"); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Save failed"); } finally { setSaving(false); } };
  const sync = async () => { setSyncing(true); try { toast.success((await api.syncNow()).message); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Sync failed"); } finally { setSyncing(false); } };
  return <>{context}<div className="page-heading"><div><Typography.Title level={2}>Upstream</Typography.Title><Typography.Paragraph type="secondary">Shared supplier connection and synchronization controls.</Typography.Paragraph></div><Button type="primary" icon={<RefreshCw size={16} />} loading={syncing} onClick={() => void sync()}>Sync now</Button></div><AsyncState loading={loading} error={error}>{connection && <><>{connection.state === "blocked" && <Alert className="blocking-alert" type="error" showIcon message="Automation is blocked" description={connection.failureMessage} />}</><Descriptions size="small" bordered column={{ xs: 1, sm: 3 }} items={[{ key: "state", label: "State", children: connection.state }, { key: "login", label: "Last login", children: format(connection.lastLoginAt) }, { key: "sync", label: "Last sync", children: format(connection.lastSyncAt) }]} /><Typography.Title level={4}>Credentials</Typography.Title><Form layout="vertical" className="form-column" initialValues={{ username: connection.username }} onFinish={save}><Form.Item label="Upstream username" name="username" rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item><Form.Item label="Upstream password" name="password" rules={[{ required: true }]}><Input.Password autoComplete="new-password" /></Form.Item><Space><Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving}>Save credentials</Button></Space></Form></>}</AsyncState></>;
}
