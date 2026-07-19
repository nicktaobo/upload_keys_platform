import { Modal, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { KeyRecord } from "../../api/client";
import { AsyncState } from "../../components/AsyncState";
import { KeyTable } from "../../components/KeyTable";

export function AdminKeysPage() {
  const [records, setRecords] = useState<KeyRecord[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState<KeyRecord | null>(null), [busy, setBusy] = useState(false);
  const [toast, context] = message.useMessage();
  useEffect(() => { api.adminKeys().then((result) => setRecords(result.items)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load Keys")).finally(() => setLoading(false)); }, []);
  const confirm = async () => { if (!retry) return; setBusy(true); try { toast.success((await api.retryKey(retry.id)).message); setRetry(null); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Retry failed"); } finally { setBusy(false); } };
  return <>{context}<Typography.Title level={2}>All Keys</Typography.Title><Typography.Paragraph type="secondary">Masked records across all owners, including sanitized failure details.</Typography.Paragraph><AsyncState loading={loading} error={error} empty={!loading && !error && records.length === 0}><KeyTable admin records={records} onRetry={setRetry} /></AsyncState><Modal title="Retry submission" open={retry !== null} onCancel={() => setRetry(null)} onOk={() => void confirm()} okText="Retry" confirmLoading={busy}>Queue another submission attempt for <strong>{retry?.maskedKey}</strong>?</Modal></>;
}
