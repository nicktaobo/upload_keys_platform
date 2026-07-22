import { Alert, Button, Form, Input, InputNumber, Tabs, Typography, message } from "antd";
import { Send } from "lucide-react";
import { useState } from "react";
import { analyzeBatch } from "@keyhub/domain/batch";
import { api } from "../api/client";
import type { BatchError } from "../api/client";
import { useI18n } from "../app/i18n";

export function SubmitPage() {
  const { t } = useI18n();
  const [errors, setErrors] = useState<BatchError[]>([]), [busy, setBusy] = useState(false); const [toast, context] = message.useMessage();
  const [singleForm] = Form.useForm(), [batchForm] = Form.useForm();
  const batchText = Form.useWatch("rows", batchForm) ?? "";
  const batchStats = analyzeBatch(batchText);
  const handle = async (run: () => ReturnType<typeof api.submit>, onAccepted?: () => void) => { setBusy(true); setErrors([]); try { const result = await run(); setErrors(result.errors); if (result.accepted) { toast.success(`${result.accepted} Key${result.accepted === 1 ? "" : "s"} accepted`); onAccepted?.(); } } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Submission failed"); } finally { setBusy(false); } };
  return <>{context}<Typography.Title level={2}>{t("submit.title", "Submit Key")}</Typography.Title><Typography.Paragraph type="secondary">{t("submit.subtitle", "Keys are submitted to the fixed Claude official API channel.")}</Typography.Paragraph><div className="channel-strip"><span>{t("submit.channel", "Channel")}</span><strong>Claude official API</strong></div>
    {errors.length > 0 && <Alert type="error" showIcon message="Some rows could not be submitted" description={errors.map((error) => <div key={error.row}>Row {error.row}: {error.message}</div>)} />}
    <Tabs items={[
      { key: "single", label: t("submit.single", "Single"), children: <Form form={singleForm} layout="vertical" className="form-column" initialValues={{ warrantyHours: 1 }} onFinish={({ key, warrantyHours }) => void handle(() => api.submit(key, warrantyHours), () => singleForm.resetFields(["key"]))}><Form.Item label={t("submit.apiKey", "API Key")} name="key" rules={[{ required: true, message: "Enter an API Key" }]}><Input.Password visibilityToggle={false} placeholder="sk-ant-..." /></Form.Item><Form.Item label={t("submit.warranty", "Warranty hours")} name="warrantyHours" rules={[{ required: true }]}><InputNumber min={1} max={8760} /></Form.Item><Button type="primary" htmlType="submit" icon={<Send size={16} />} loading={busy}>{t("submit.submit", "Submit Key")}</Button></Form> },
      { key: "batch", label: t("submit.batch", "Batch paste"), children: <Form form={batchForm} layout="vertical" className="form-column" onFinish={({ rows }) => void handle(() => api.submitBatch(rows), () => batchForm.resetFields(["rows"]))}><Form.Item label={t("submit.batchLabel", "Keys and warranty hours")} name="rows" extra={t("submit.help", "One Key per row. Warranty hours are optional and default to 1.")} rules={[{ required: true, message: "Paste at least one row" }]}><Input.TextArea className="batch-textarea" rows={9} wrap="off" spellCheck={false} placeholder={"sk-ant-...\nsk-ant-..."} /></Form.Item><div className="batch-stats" aria-label="Batch statistics"><Typography.Text type="secondary">{t("submit.total", "Total rows")} <strong>{batchStats.totalRows}</strong></Typography.Text><Typography.Text type="success">{t("submit.ready", "Ready to submit")} <strong>{batchStats.submitableRows}</strong></Typography.Text><Typography.Text type="warning">{t("submit.duplicates", "Duplicates")} <strong>{batchStats.duplicateRows}</strong></Typography.Text><Typography.Text type="danger">{t("submit.invalid", "Invalid")} <strong>{batchStats.invalidRows}</strong></Typography.Text></div><Button type="primary" htmlType="submit" icon={<Send size={16} />} loading={busy}>{t("submit.batchSubmit", "Submit batch")}</Button></Form> },
    ]} />
  </>;
}
