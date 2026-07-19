import { Alert, Button, Space, Typography, message } from "antd";
import { Database, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";

export function OperationsPage() {
  const [syncing, setSyncing] = useState(false);
  const [toast, context] = message.useMessage();
  const sync = async () => {
    setSyncing(true);
    try { toast.success((await api.syncNow()).message); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Sync failed"); }
    finally { setSyncing(false); }
  };
  return <>{context}<Typography.Title level={2}>Operations</Typography.Title><Typography.Paragraph type="secondary">Run synchronization and inspect submissions that need operator attention.</Typography.Paragraph><Alert type="info" showIcon message="Submission retries are managed from All Keys" /><Space className="operations-actions"><Button type="primary" icon={<RefreshCw size={16} />} loading={syncing} onClick={() => void sync()}>Sync now</Button><Link to="/admin/keys"><Button icon={<Database size={16} />}>Review failed Keys</Button></Link></Space></>;
}
