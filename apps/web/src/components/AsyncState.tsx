import { Alert, Empty, Skeleton } from "antd";
import type { ReactNode } from "react";

export function AsyncState({ loading, error, empty, children }: { loading: boolean; error: string | null; empty?: boolean; children: ReactNode }) {
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (error) return <Alert type="error" showIcon message="Unable to load data" description={error} />;
  if (empty) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No records yet" />;
  return children;
}
