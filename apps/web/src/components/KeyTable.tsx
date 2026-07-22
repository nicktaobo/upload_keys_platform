import { Button, Table, Tag, Tooltip, Typography } from "antd";
import { RotateCcw } from "lucide-react";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { KeyRecord } from "../api/client";
import { formatDateTime } from "../utils/date";
import { useI18n } from "../app/i18n";

const statusColor: Record<KeyRecord["status"], string> = {
  pending: "default", submitting: "processing", submitted: "success", test_failed: "warning", retrying: "processing", upstream_error: "error",
};
const date = formatDateTime;

export function KeyTable({ records, pagination, admin = false, onReveal, onRetry }: {
  records: KeyRecord[];
  pagination: TablePaginationConfig;
  admin?: boolean;
  onReveal?: (record: KeyRecord) => void;
  onRetry?: (record: KeyRecord) => void;
}) {
  const { t } = useI18n();
  const isAdmin = admin === true;
  const columns: ColumnsType<KeyRecord> = [
    ...(isAdmin ? [{ title: t("table.owner", "Owner"), dataIndex: ["owner", "username"], width: 130 }] : []),
    {
      title: t("table.key", "Key"), dataIndex: "maskedKey", width: 210, fixed: "left",
      render: (value: string, record) => isAdmin
        ? <Typography.Text code>{value}</Typography.Text>
        : <Button type="link" className="key-link" onClick={() => onReveal?.(record)}>{value}</Button>,
    },
    { title: t("table.status", "Status"), dataIndex: "status", width: 130, render: (value: KeyRecord["status"]) => <Tag color={statusColor[value]}>{t(`status.${value}`, value)}</Tag> },
    { title: t("table.test", "Test"), dataIndex: "testResult", width: 100, render: (value: string | null) => value ? value : "—" },
    { title: t("table.access", "Access"), dataIndex: "accessStatus", width: 100, render: (value: string | null) => value ? value : "—" },
    { title: t("table.usage", "Usage"), dataIndex: "usageUsd", width: 100, align: "right", render: (value: number) => `$${value.toFixed(2)}` },
    { title: t("table.sites", "Sites"), dataIndex: "usageSiteCount", width: 75, align: "right" },
    { title: t("table.sampled", "Sampled"), dataIndex: "sampledAt", width: 180, render: date },
    { title: t("table.submitted", "Submitted"), dataIndex: "submittedAt", width: 180, render: date },
    { title: t("table.failure", "Failure"), dataIndex: "failureMessage", width: 260, render: (value: string | null) => value ?? "—" },
    ...(onRetry ? [{
      title: "", key: "action", width: 60, fixed: "right" as const,
      render: (_: unknown, record: KeyRecord) => record.status === "upstream_error" || record.status === "test_failed"
        ? <Tooltip title="Retry submission"><Button aria-label={`Retry ${record.id}`} icon={<RotateCcw size={16} />} onClick={() => onRetry?.(record)} /></Tooltip>
        : null,
    }] : []),
  ];
  return <Table rowKey="id" size="small" columns={columns} dataSource={records} pagination={pagination} scroll={{ x: isAdmin || onRetry ? 1350 : 1300 }} />;
}
