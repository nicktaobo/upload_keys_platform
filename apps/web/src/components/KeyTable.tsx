import { Button, Table, Tag, Tooltip, Typography } from "antd";
import { RotateCcw } from "lucide-react";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { KeyRecord } from "../api/client";
import { formatDateTime } from "../utils/date";

const statusColor: Record<KeyRecord["status"], string> = {
  pending: "default", submitting: "processing", submitted: "success", test_failed: "warning", retrying: "processing", upstream_error: "error",
};
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const date = formatDateTime;

export function KeyTable({ records, pagination, admin = false, onReveal, onRetry }: {
  records: KeyRecord[];
  pagination: TablePaginationConfig;
  admin?: boolean;
  onReveal?: (record: KeyRecord) => void;
  onRetry?: (record: KeyRecord) => void;
}) {
  const isAdmin = admin === true;
  const columns: ColumnsType<KeyRecord> = [
    ...(isAdmin ? [{ title: "Owner", dataIndex: ["owner", "username"], width: 130 }] : []),
    {
      title: "Key", dataIndex: "maskedKey", width: 210, fixed: "left",
      render: (value: string, record) => isAdmin
        ? <Typography.Text code>{value}</Typography.Text>
        : <Button type="link" className="key-link" onClick={() => onReveal?.(record)}>{value}</Button>,
    },
    { title: "Status", dataIndex: "status", width: 130, render: (value: KeyRecord["status"]) => <Tag color={statusColor[value]}>{label(value)}</Tag> },
    { title: "Test", dataIndex: "testResult", width: 100, render: (value: string | null) => value ? label(value) : "—" },
    { title: "Access", dataIndex: "accessStatus", width: 100, render: (value: string | null) => value ? label(value) : "—" },
    { title: "Usage", dataIndex: "usageUsd", width: 100, align: "right", render: (value: number) => `$${value.toFixed(2)}` },
    { title: "Sites", dataIndex: "usageSiteCount", width: 75, align: "right" },
    { title: "Sampled", dataIndex: "sampledAt", width: 180, render: date },
    { title: "Submitted", dataIndex: "submittedAt", width: 180, render: date },
    { title: "Failure", dataIndex: "failureMessage", width: 260, render: (value: string | null) => value ?? "—" },
    ...(isAdmin ? [{
      title: "", key: "action", width: 60, fixed: "right" as const,
      render: (_: unknown, record: KeyRecord) => record.status === "upstream_error" || record.status === "test_failed"
        ? <Tooltip title="Retry submission"><Button aria-label={`Retry ${record.id}`} icon={<RotateCcw size={16} />} onClick={() => onRetry?.(record)} /></Tooltip>
        : null,
    }] : []),
  ];
  return <Table rowKey="id" size="small" columns={columns} dataSource={records} pagination={pagination} scroll={{ x: isAdmin ? 1350 : 1300 }} />;
}
