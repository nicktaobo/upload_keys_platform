import { Alert, Button, Form, Input, InputNumber, Tabs, Typography, message } from "antd";
import { Send } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import type { BatchError } from "../api/client";

export function SubmitPage() {
  const [errors, setErrors] = useState<BatchError[]>([]), [busy, setBusy] = useState(false); const [toast, context] = message.useMessage();
  const [singleForm] = Form.useForm(), [batchForm] = Form.useForm();
  const handle = async (run: () => ReturnType<typeof api.submit>, onAccepted?: () => void) => { setBusy(true); setErrors([]); try { const result = await run(); setErrors(result.errors); if (result.accepted) { toast.success(`${result.accepted} Key${result.accepted === 1 ? "" : "s"} accepted`); onAccepted?.(); } } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Submission failed"); } finally { setBusy(false); } };
  return <>{context}<Typography.Title level={2}>Submit Key</Typography.Title><Typography.Paragraph type="secondary">Keys are submitted to the fixed Claude official API channel.</Typography.Paragraph><div className="channel-strip"><span>Channel</span><strong>Claude official API</strong></div>
    {errors.length > 0 && <Alert type="error" showIcon message="Some rows could not be submitted" description={errors.map((error) => <div key={error.row}>Row {error.row}: {error.message}</div>)} />}
    <Tabs items={[
      { key: "single", label: "Single", children: <Form form={singleForm} layout="vertical" className="form-column" initialValues={{ warrantyHours: 1 }} onFinish={({ key, warrantyHours }) => void handle(() => api.submit(key, warrantyHours), () => singleForm.resetFields(["key"]))}><Form.Item label="API Key" name="key" rules={[{ required: true, message: "Enter an API Key" }]}><Input.Password visibilityToggle={false} placeholder="sk-ant-..." /></Form.Item><Form.Item label="Warranty hours" name="warrantyHours" rules={[{ required: true }]}><InputNumber min={1} max={8760} /></Form.Item><Button type="primary" htmlType="submit" icon={<Send size={16} />} loading={busy}>Submit Key</Button></Form> },
      { key: "batch", label: "Batch paste", children: <Form form={batchForm} layout="vertical" className="form-column" onFinish={({ rows }) => void handle(() => api.submitBatch(rows), () => batchForm.resetFields(["rows"]))}><Form.Item label="Keys and warranty hours" name="rows" extra="One row per Key: Key, warranty hours" rules={[{ required: true, message: "Paste at least one row" }]}><Input.TextArea rows={9} placeholder="sk-ant-..., 1" /></Form.Item><Button type="primary" htmlType="submit" icon={<Send size={16} />} loading={busy}>Submit batch</Button></Form> },
    ]} />
  </>;
}
