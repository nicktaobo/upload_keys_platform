import { Input, Modal, Typography } from "antd";

export function RevealKeyModal({ value, onClose }: { value: string | null; onClose: () => void }) {
  return (
    <Modal title="Full Key" open={value !== null} onCancel={onClose} onOk={onClose} okText="Done" cancelButtonProps={{ style: { display: "none" } }}>
      <Typography.Paragraph type="secondary">Copied to clipboard</Typography.Paragraph>
      <Input.TextArea aria-label="Full Key value" value={value ?? ""} readOnly autoSize={{ minRows: 2, maxRows: 4 }} />
    </Modal>
  );
}
