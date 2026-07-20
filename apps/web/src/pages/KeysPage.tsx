import { Button, Flex, Select, Space, Statistic, Typography, message } from "antd";
import { RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { KeyRecord, KeyStatus, KeySummary } from "../api/client";
import { AsyncState } from "../components/AsyncState";
import { KeyTable } from "../components/KeyTable";
import { RevealKeyModal } from "../components/RevealKeyModal";
import { formatDateTime } from "../utils/date";

const PAGE_SIZE = 20;

export function KeysPage() {
  const [summary, setSummary] = useState<KeySummary | null>(null), [records, setRecords] = useState<KeyRecord[]>([]);
  const [status, setStatus] = useState<KeyStatus | undefined>(), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null), [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [toast, toastContext] = message.useMessage();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [nextSummary, list] = await Promise.all([api.summary(), api.keys(status, page, PAGE_SIZE)]); setSummary(nextSummary); setRecords(list.items); setTotal(list.total); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Keys"); }
    finally { setLoading(false); }
  }, [page, status]);
  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); try { toast.success((await api.refresh()).message); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Refresh failed"); } finally { setRefreshing(false); } };
  const reveal = async (record: KeyRecord) => {
    try {
      const result = await api.reveal(record.id);
      setRevealed(result.key);
      try { await navigator.clipboard.writeText(result.key); }
      catch { toast.warning("Key displayed, but clipboard access was blocked"); }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Reveal failed");
    }
  };
  return <>{toastContext}<Flex justify="space-between" align="start" gap={16} wrap><div><Typography.Title level={2}>My Keys</Typography.Title><Typography.Paragraph type="secondary">Submission status and current upstream usage.</Typography.Paragraph></div><Space><Button aria-label="Refresh data" icon={<RefreshCw size={16} />} loading={refreshing} onClick={() => void refresh()}>Refresh</Button><Link to="/submit"><Button type="primary" icon={<Send size={16} />}>Submit Key</Button></Link></Space></Flex>
    {summary && <div className="metrics"><Statistic title="Submitted Keys" value={summary.total} /><Statistic title="Healthy" value={summary.healthy} /><Statistic title="Accumulated usage" value={summary.usageUsd} formatter={() => `$${summary.usageUsd.toFixed(2)}`} /><Statistic title="Latest sample" value={summary.latestSampleAt ? formatDateTime(summary.latestSampleAt) : "No samples"} /></div>}
    <div className="table-toolbar"><Select aria-label="Filter by status" placeholder="All statuses" allowClear value={status} onChange={(nextStatus) => { setStatus(nextStatus); setPage(1); }} options={["pending", "submitting", "submitted", "test_failed", "retrying", "upstream_error"].map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase()) }))} /></div>
    <AsyncState loading={loading} error={error} empty={!loading && !error && records.length === 0}><KeyTable records={records} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage }} onReveal={(record) => void reveal(record)} /></AsyncState>
    <RevealKeyModal value={revealed} onClose={() => setRevealed(null)} />
  </>;
}
