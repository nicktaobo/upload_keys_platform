import { Card, Flex, Modal, Select, Space, Statistic, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { KeyRecord, KeyStatus, AdminKeyStat } from "../../api/client";
import { AsyncState } from "../../components/AsyncState";
import { KeyTable } from "../../components/KeyTable";

const PAGE_SIZE = 20;

export function AdminKeysPage() {
  const [records, setRecords] = useState<KeyRecord[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState<KeyRecord | null>(null), [busy, setBusy] = useState(false);
  const [owners, setOwners] = useState<Array<{ id: string; username: string }>>([]), [stats, setStats] = useState<AdminKeyStat[]>([]);
  const [ownerId, setOwnerId] = useState<string>(), [status, setStatus] = useState<KeyStatus>();
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [toast, context] = message.useMessage();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const result = await api.adminKeys(page, PAGE_SIZE, ownerId, status); setRecords(result.items); setTotal(result.total); setOwners(result.owners ?? []); setStats(result.stats ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Keys"); }
    finally { setLoading(false); }
  }, [page, ownerId, status]);
  useEffect(() => { void load(); }, [load]);
  const confirm = async () => { if (!retry) return; setBusy(true); try { toast.success((await api.retryKey(retry.id)).message); setRetry(null); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Retry failed"); } finally { setBusy(false); } };
  return <>{context}<Typography.Title level={2}>All Keys</Typography.Title><Typography.Paragraph type="secondary">Masked records across all owners, including sanitized failure details.</Typography.Paragraph>
    <Flex gap={12} wrap="wrap" className="table-toolbar"><Select aria-label="Filter by account" allowClear showSearch optionFilterProp="label" placeholder="All accounts" value={ownerId} onChange={(value) => { setOwnerId(value); setPage(1); }} options={owners.map((owner) => ({ value: owner.id, label: owner.username }))} /><Select aria-label="Filter by status" allowClear placeholder="All statuses" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={["pending", "submitting", "submitted", "test_failed", "retrying", "upstream_error"].map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) }))} /></Flex>
    <Flex gap={12} wrap="wrap" className="metrics">{stats.map((stat) => <Card key={stat.ownerId} size="small" title={stat.username}><Space size={20}><Statistic title="Keys" value={stat.keyCount} /><Statistic title="Healthy" value={stat.healthyCount} /><Statistic title="Usage" value={stat.usageUsd} precision={2} prefix="$" /></Space></Card>)}</Flex>
    <AsyncState loading={loading} error={error} empty={!loading && !error && records.length === 0}><KeyTable admin records={records} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage }} onRetry={setRetry} /></AsyncState><Modal title="Retry submission" open={retry !== null} onCancel={() => setRetry(null)} onOk={() => void confirm()} okText="Retry" confirmLoading={busy}>Queue another submission attempt for <strong>{retry?.maskedKey}</strong>?</Modal></>;
}
