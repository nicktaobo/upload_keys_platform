import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { KeyRound, UserPlus, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ApiUser, Role } from "../../api/client";
import { AsyncState } from "../../components/AsyncState";

export function UsersPage() {
  const [users, setUsers] = useState<ApiUser[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false), [resetUser, setResetUser] = useState<ApiUser | null>(null), [busy, setBusy] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [createForm] = Form.useForm(), [resetForm] = Form.useForm(); const [toast, context] = message.useMessage();
  const load = async () => { setLoading(true); try { setUsers((await api.adminUsers()).items); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load users"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const create = async ({ username, password, role }: { username: string; password: string; role: Role }) => { setBusy(true); try { const result = await api.createUser({ username, password, role }); setUsers((current) => [...current, result.user]); toast.success("User created"); setCreateOpen(false); createForm.resetFields(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Create failed"); } finally { setBusy(false); } };
  const disable = async (record: ApiUser) => { setDisablingId(record.id); try { await api.setUserStatus(record.id, false); setUsers((current) => current.map((item) => item.id === record.id ? { ...item, isActive: false } : item)); toast.success("User disabled"); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Disable failed"); } finally { setDisablingId(null); } };
  const reset = async ({ password }: { password: string }) => { if (!resetUser) return; setBusy(true); try { await api.resetPassword(resetUser.id, password); toast.success("Password reset"); setResetUser(null); resetForm.resetFields(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Reset failed"); } finally { setBusy(false); } };
  return <>{context}<div className="page-heading"><div><Typography.Title level={2}>Users</Typography.Title><Typography.Paragraph type="secondary">Create accounts and control access.</Typography.Paragraph></div><Button type="primary" icon={<UserPlus size={16} />} onClick={() => setCreateOpen(true)}>Create user</Button></div>
    <AsyncState loading={loading} error={error} empty={!loading && !error && users.length === 0}><Table size="small" rowKey="id" dataSource={users} columns={[
      { title: "Username", dataIndex: "username" }, { title: "Role", dataIndex: "role", render: (value: string) => <Tag>{value}</Tag> }, { title: "Status", dataIndex: "isActive", render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "Active" : "Disabled"}</Tag> },
      { title: "Actions", render: (_: unknown, record: ApiUser) => <Space><Button aria-label={`Reset password for ${record.username}`} icon={<KeyRound size={15} />} onClick={() => setResetUser(record)}>Reset password</Button>{record.isActive && <Popconfirm title="Disable user" description="Existing sessions will be invalidated." okText="Disable" okButtonProps={{ loading: disablingId === record.id }} onConfirm={() => disable(record)}><Button danger aria-label={`Disable ${record.username}`} loading={disablingId === record.id} disabled={disablingId !== null} icon={<UserX size={15} />}>Disable</Button></Popconfirm>}</Space> },
    ]} /></AsyncState>
    <Modal title="Create user" aria-label="Create user" open={createOpen} destroyOnHidden onCancel={() => setCreateOpen(false)} footer={null}><Form form={createForm} layout="vertical" initialValues={{ role: "user" }} onFinish={create}><Form.Item label="Username" name="username" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="Temporary password" name="password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item><Form.Item label="Role" name="role"><Select options={[{ value: "user", label: "User" }, { value: "admin", label: "Administrator" }]} /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>Create</Button></Form></Modal>
    <Modal title="Reset password" aria-label="Reset password" open={resetUser !== null} destroyOnHidden onCancel={() => setResetUser(null)} footer={null}><Form form={resetForm} layout="vertical" onFinish={reset}><Form.Item label="New temporary password" name="password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>Reset</Button></Form></Modal>
  </>;
}
