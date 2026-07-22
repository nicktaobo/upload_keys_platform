import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { KeyRound, UserPlus, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ApiUser, Role } from "../../api/client";
import { useI18n } from "../../app/i18n";
import { AsyncState } from "../../components/AsyncState";

export function UsersPage() {
  const { t } = useI18n();
  const [users, setUsers] = useState<ApiUser[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false), [resetUser, setResetUser] = useState<ApiUser | null>(null), [busy, setBusy] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [createForm] = Form.useForm(), [resetForm] = Form.useForm(); const [toast, context] = message.useMessage();
  const load = async () => { setLoading(true); try { setUsers((await api.adminUsers()).items); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load users"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const create = async ({ username, password, role }: { username: string; password: string; role: Role }) => { setBusy(true); try { const result = await api.createUser({ username, password, role }); setUsers((current) => [...current, result.user]); toast.success("User created"); setCreateOpen(false); createForm.resetFields(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Create failed"); } finally { setBusy(false); } };
  const disable = async (record: ApiUser) => { setDisablingId(record.id); try { await api.setUserStatus(record.id, false); setUsers((current) => current.map((item) => item.id === record.id ? { ...item, isActive: false } : item)); toast.success("User disabled"); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Disable failed"); } finally { setDisablingId(null); } };
  const reset = async ({ password }: { password: string }) => { if (!resetUser) return; setBusy(true); try { await api.resetPassword(resetUser.id, password); toast.success("Password reset"); setResetUser(null); resetForm.resetFields(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Reset failed"); } finally { setBusy(false); } };
  return <>{context}<div className="page-heading"><div><Typography.Title level={2}>{t("users.title", "Users")}</Typography.Title><Typography.Paragraph type="secondary">{t("users.subtitle", "Create accounts and control access.")}</Typography.Paragraph></div><Button type="primary" icon={<UserPlus size={16} />} onClick={() => setCreateOpen(true)}>{t("users.create", "Create user")}</Button></div>
    <AsyncState loading={loading} error={error} empty={!loading && !error && users.length === 0}><Table size="small" rowKey="id" dataSource={users} columns={[
      { title: t("users.username", "Username"), dataIndex: "username" }, { title: t("users.role", "Role"), dataIndex: "role", render: (value: string) => <Tag>{value === "admin" ? t("users.admin", "Administrator") : t("users.user", "User")}</Tag> }, { title: t("users.status", "Status"), dataIndex: "isActive", render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? t("users.active", "Active") : t("users.disabled", "Disabled")}</Tag> },
      { title: t("users.actions", "Actions"), render: (_: unknown, record: ApiUser) => <Space><Button aria-label={`Reset password for ${record.username}`} icon={<KeyRound size={15} />} onClick={() => setResetUser(record)}>{t("users.resetPassword", "Reset password")}</Button>{record.isActive && <Popconfirm title={t("users.disable", "Disable user")} description="Existing sessions will be invalidated." okText={t("users.disable", "Disable")} okButtonProps={{ loading: disablingId === record.id }} onConfirm={() => disable(record)}><Button danger aria-label={`Disable ${record.username}`} loading={disablingId === record.id} disabled={disablingId !== null} icon={<UserX size={15} />}>{t("users.disable", "Disable")}</Button></Popconfirm>}</Space> },
    ]} /></AsyncState>
    <Modal title={t("users.create", "Create user")} aria-label="Create user" open={createOpen} destroyOnHidden onCancel={() => setCreateOpen(false)} footer={null}><Form form={createForm} layout="vertical" initialValues={{ role: "user" }} onFinish={create}><Form.Item label={t("users.username", "Username")} name="username" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label={t("users.tempPassword", "Temporary password")} name="password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item><Form.Item label={t("users.role", "Role")} name="role"><Select options={[{ value: "user", label: t("users.user", "User") }, { value: "admin", label: t("users.admin", "Administrator") }]} /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>{t("action.create", "Create")}</Button></Form></Modal>
    <Modal title={t("users.resetPassword", "Reset password")} aria-label="Reset password" open={resetUser !== null} destroyOnHidden onCancel={() => setResetUser(null)} footer={null}><Form form={resetForm} layout="vertical" onFinish={reset}><Form.Item label={t("users.newTempPassword", "New temporary password")} name="password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>{t("action.reset", "Reset")}</Button></Form></Modal>
  </>;
}
