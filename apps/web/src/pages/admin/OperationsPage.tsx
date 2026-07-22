import { Alert, Button, Space, Typography, message } from "antd";
import { Database, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useI18n } from "../../app/i18n";

export function OperationsPage() {
  const { t } = useI18n();
  const [syncing, setSyncing] = useState(false);
  const [toast, context] = message.useMessage();
  const sync = async () => {
    setSyncing(true);
    try { toast.success((await api.syncNow()).message); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Sync failed"); }
    finally { setSyncing(false); }
  };
  return <>{context}<Typography.Title level={2}>{t("operations.title", "Operations")}</Typography.Title><Typography.Paragraph type="secondary">{t("operations.subtitle", "Run synchronization and inspect submissions that need operator attention.")}</Typography.Paragraph><Alert type="info" showIcon message={t("operations.retryHint", "Submission retries are managed from All Keys")} /><Space className="operations-actions"><Button type="primary" icon={<RefreshCw size={16} />} loading={syncing} onClick={() => void sync()}>{t("action.sync", "Sync now")}</Button><Link to="/admin/keys"><Button icon={<Database size={16} />}>{t("operations.reviewFailed", "Review failed Keys")}</Button></Link></Space></>;
}
