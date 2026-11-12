import React from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Select } from 'antd';
import './CustomModelsDialog.css';

export const validateCustomModel = (model) => {
  if (!model.name?.trim()) return '请输入模型名称';
  if (!['openai', 'anthropic'].includes(model.protocol)) return '请选择有效协议';
  try {
    const url = new URL(model.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { return '请输入有效的 HTTP/HTTPS Base URL'; }
  if (!model.apiKey?.trim()) return '请输入 API Key';
  if (!model.modelId?.trim()) return '请输入模型 ID';
  return '';
};

// Mount only while open so a new session starts with the latest persisted models.
export default function CustomModelsDialog({ customModels = [], onSaveCustomModels, customModelsLoading = false, customModelsError = '', onClose }) {
  const [draft, setDraft] = React.useState(() => customModels.map(model => ({ ...model })));
  const initialized = React.useRef(!customModelsLoading);
  React.useEffect(() => {
    if (!customModelsLoading && !initialized.current) {
      setDraft(customModels.map(model => ({ ...model })));
      initialized.current = true;
    }
  }, [customModels, customModelsLoading]);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const busy = saving || customModelsLoading;
  const update = (id, key, value) => setDraft(items => items.map(item => item.id === id ? { ...item, [key]: value } : item));
  const save = async () => {
    const invalid = draft.map((item, index) => ({ message: validateCustomModel(item), index })).find(item => item.message);
    if (invalid) { setError(`模型 ${invalid.index + 1}：${invalid.message}`); return; }
    if (!onSaveCustomModels) { setError('暂时无法保存自定义模型'); return; }
    setSaving(true);
    setError('');
    try {
      await onSaveCustomModels(draft.map(item => ({ ...item, name: item.name.trim(), baseUrl: item.baseUrl.trim(), apiKey: item.apiKey.trim(), modelId: item.modelId.trim() })));
      onClose();
    } catch {
      // Never display server errors here: they can contain the submitted API key.
      setError('保存失败，请检查配置后重试。当前草稿已保留。');
    } finally { setSaving(false); }
  };
  return (
    <Modal title="自定义模型" open width={640} onCancel={busy ? undefined : onClose} closable={!busy} maskClosable={false}
      footer={<><Button onClick={onClose} disabled={busy}>取消</Button><Button type="primary" onClick={save} loading={saving} disabled={customModelsLoading || Boolean(customModelsError)}>保存</Button></>}>
      <div className="custom-models-dialog">
        <p>配置自己的模型服务。API Key 为敏感信息，请勿分享。</p>
        {(error || customModelsError) && <Alert type="error" showIcon message={error || '自定义模型加载失败，请稍后重试。'} />}
        <div className="custom-models-dialog__list">
          {draft.length === 0 && <p>暂无自定义模型，点击下方按钮新增。</p>}
          {draft.map((item, index) => (
            <fieldset key={item.id} disabled={busy} className="custom-models-dialog__item">
              <legend>模型 {index + 1}</legend>
              <Form layout="vertical" component="div">
                <Form.Item label="名称" required><Input aria-label={`模型 ${index + 1} 名称`} value={item.name} onChange={e => update(item.id, 'name', e.target.value)} /></Form.Item>
                <Form.Item label="协议" required><Select aria-label={`模型 ${index + 1} 协议`} value={item.protocol} disabled={busy} options={[{ value: 'openai', label: 'OpenAI Chat Completions' }, { value: 'anthropic', label: 'Anthropic Messages' }]} onChange={value => update(item.id, 'protocol', value)} /></Form.Item>
                <Form.Item label="Base URL" required extra={item.protocol === 'openai' ? '填写 API 基础地址，通常以 /v1 结尾；不要填写 /chat/completions。' : '填写服务根地址；不要填写 /v1/messages。'}><Input aria-label={`模型 ${index + 1} Base URL`} placeholder="https://api.example.com/v1" value={item.baseUrl} onChange={e => update(item.id, 'baseUrl', e.target.value)} /></Form.Item>
                <Form.Item label="API Key" required><Input.Password aria-label={`模型 ${index + 1} API Key`} autoComplete="new-password" value={item.apiKey} onChange={e => update(item.id, 'apiKey', e.target.value)} /></Form.Item>
                <Form.Item label="模型 ID" required><Input aria-label={`模型 ${index + 1} 模型 ID`} value={item.modelId} onChange={e => update(item.id, 'modelId', e.target.value)} /></Form.Item>
                <div className="custom-models-dialog__actions">
                  <Checkbox checked={Boolean(item.read_image)} disabled={busy} onChange={e => update(item.id, 'read_image', e.target.checked)}>支持识图</Checkbox>
                  <Popconfirm title="确认删除此模型？" okText="删除" cancelText="取消" onConfirm={() => setDraft(items => items.filter(model => model.id !== item.id))}>
                    <Button danger disabled={busy}>删除模型 {index + 1}</Button>
                  </Popconfirm>
                </div>
              </Form>
            </fieldset>
          ))}
        </div>
        <Button disabled={busy} onClick={() => setDraft(items => [...items, { id: `custom-${crypto.randomUUID()}`, name: '', protocol: 'openai', baseUrl: '', apiKey: '', modelId: '', read_image: false }])}>新增模型</Button>
      </div>
    </Modal>
  );
}
