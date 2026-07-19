import { Modal, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { KeyRecord } from "../../api/client";
import { AsyncState } from "../../components/AsyncState";
import { KeyTable } from "../../components/KeyTable";

const PAGE_SIZE = 20;

export function AdminKeysPage() {
  const [records, setRecords] = useState<KeyRecord[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState<KeyRecord | null>(null), [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [toast, context] = message.useMessage();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const result = await api.adminKeys(page, PAGE_SIZE); setRecords(result.items); setTotal(result.total); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Keys"); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  const confirm = async () => { if (!retry) return; setBusy(true); try { toast.success((await api.retryKey(retry.id)).message); setRetry(null); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Retry failed"); } finally { setBusy(false); } };
  return <>{context}<Typography.Title level={2}>All Keys</Typography.Title><Typography.Paragraph type="secondary">Masked records across all owners, including sanitized failure details.</Typography.Paragraph><AsyncState loading={loading} error={error} empty={!loading && !error && records.length === 0}><KeyTable admin records={records} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage }} onRetry={setRetry} /></AsyncState><Modal title="Retry submission" open={retry !== null} onCancel={() => setRetry(null)} onOk={() => void confirm()} okText="Retry" confirmLoading={busy}>Queue another submission attempt for <strong>{retry?.maskedKey}</strong>?</Modal></>;
}
