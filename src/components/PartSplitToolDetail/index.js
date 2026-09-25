import React from 'react';
import { Alert, Empty, Input, Modal, Spin } from 'antd';
import { ChevronRight, FileText, RotateCcw } from 'lucide-react';
import {
  labelParts, listRecognitionFiles, loadRecognition, mergeParts, splitPart,
} from './model';
import StoryboardEditor from './StoryboardEditor';
import { insertEmptyPart } from './timeline';
import { createFileBinding } from './fileBinding';
import { captionCues, deleteSubtitleTextUnits, deleteSubtitleUnits, editCaption } from './subtitles';
import { ChatTaskContext } from '../Chat/ChatShell/ChatTaskContext';
import { AI_ASSIST_DEFAULT_INSTRUCTION } from './aiAssist';
import { useAiAssist } from './useAiAssist';
import AiLoadingOverlay from './AiLoadingOverlay';
import { resizePart } from './trim';
import './index.css';

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

const PartSplitToolDetail = ({ open = false, workspacePath = '', initialFilePath = '', onClose, onBusyChange }) => {
  const chatTask = React.useContext(ChatTaskContext);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiInstruction, setAiInstruction] = React.useState('');
  const [files, setFiles] = React.useState([]);
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [recognition, setRecognition] = React.useState(null);
  const [parts, setParts] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [syncStatus, setSyncStatus] = React.useState({ state: 'loading', message: '' });
  const [closing, setClosing] = React.useState(false);
  const [bindingReady, setBindingReady] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const bindingRef = React.useRef(null);
  const { busy: aiBusy, submit: submitAi } = useAiAssist({
    bindingRef, file: selectedFile, send: chatTask.send, running: chatTask.running, onError: setError, visible: open,
  });
  // Keep the task snapshot and binding alive when only the window is closed.
  const active = open || aiBusy || syncStatus.state === 'restore-error';
  React.useLayoutEffect(() => { onBusyChange?.(aiBusy); }, [aiBusy, onBusyChange]);
  const sequenceRef = React.useRef(0);
  const labeledParts = React.useMemo(() => labelParts(parts), [parts]);
  const editing = Boolean(recognition && !loading);
  const editorDisabled = closing || !bindingReady || aiBusy || ['error', 'conflict', 'restore-error'].includes(syncStatus.state);

  React.useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setSelectedFile(null);
    setRecognition(null);
    listRecognitionFiles(workspacePath, window.api).then((nextFiles) => {
      if (cancelled) return;
      setFiles(nextFiles);
      if (initialFilePath) {
        const targetPath = String(initialFilePath).replace(/\\/g, '/');
        const target = nextFiles.find((file) => file.path === targetPath || file.relativePath === targetPath);
        if (!target) throw new Error('该字幕识别结果已不存在或不在当前工作空间，请重新识别或打开对应工作空间。');
        setSelectedFile(target);
      } else if (nextFiles.length === 1) setSelectedFile(nextFiles[0]);
      else setLoading(false);
    }).catch((cause) => {
      if (cancelled) return;
      setFiles([]);
      setError(cause.message || '工作空间读取失败');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, workspacePath, initialFilePath, revision]);

  React.useEffect(() => {
    if (!active || !selectedFile) return undefined;
    let cancelled = false;
    setLoading(true);
    setRecognition(null);
    setBindingReady(false);
    setError('');
    loadRecognition(selectedFile, window.api).then((result) => {
      if (cancelled) return;
      setRecognition(result);
      setParts(result.parts);
      setSelectedId(result.parts[0]?.id || '');
    }).catch((cause) => {
      if (!cancelled) setError(cause.message || '字幕识别结果读取失败');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, selectedFile]);

  React.useEffect(() => {
    if (!active || !recognition || !selectedFile) return undefined;
    const binding = createFileBinding({
      file: selectedFile, recognition, api: window.api,
      onParts: (next) => {
        setParts(next);
        setSelectedId((previous) => next.some((part) => part.id === previous) ? previous : next[0]?.id || '');
      },
      onStatus: setSyncStatus,
    });
    bindingRef.current = binding;
    let bindingActive = true;
    void binding.ready.then(() => { if (bindingActive) setBindingReady(true); });
    return () => {
      bindingActive = false;
      bindingRef.current = null;
      void binding.dispose();
    };
  }, [active, recognition, selectedFile]);

  const close = async () => {
    if (closing) return;
    setAiOpen(false);
    if (aiBusy) {
      onClose?.();
      return;
    }
    setClosing(true);
    const complete = await bindingRef.current?.flush();
    setClosing(false);
    if (complete !== false) onClose?.();
  };

  const updateParts = (nextParts, nextId = selectedId) => {
    if (editorDisabled) return;
    setParts(nextParts);
    setSelectedId(nextId);
    setError('');
    bindingRef.current?.update(nextParts);
  };

  const nextId = () => `part-${Date.now()}-${++sequenceRef.current}`;
  const partsWithCaptions = () => parts.map((part) => ({
    ...part, captions: captionCues(part, recognition.segments),
  }));
  const addEmptyPart = (index = parts.length) => {
    const result = insertEmptyPart(parts, index, nextId());
    updateParts(result.parts, result.part.id);
  };

  return (
    <>
    <Modal open={open} destroyOnHidden title={aiBusy ? null : '字幕分镜'} centered width={aiBusy ? 440 : editing ? 864 : 520} zIndex={1300}
      className={`part-split-dialog${isWindows ? ' part-split-dialog--win' : ''}${editing ? ' part-split-dialog--editing' : ''}${aiBusy ? ' part-split-dialog--ai-preview' : ''}`}
      closeIcon={<span className="part-split-dialog__close-icon" aria-hidden="true" />}
      closable keyboard maskClosable
      modalRender={(dialog) => <div className="part-split-dialog__surface">
        {dialog}
        {aiBusy ? <AiLoadingOverlay /> : null}
      </div>}
      onCancel={close}
      footer={null}>
      {loading ? <div className="part-split-dialog__status"><Spin /><span>正在读取字幕识别结果...</span></div> : null}
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {!aiBusy && editing && ['conflict', 'error'].includes(syncStatus.state) ? <Alert type="warning" showIcon
        message={syncStatus.message} action={<div className="part-split-dialog__sync-actions">
          <button type="button" onClick={() => bindingRef.current?.resolve('disk')}>载入文件版本</button>
          <button type="button" onClick={() => Modal.confirm({
            title: '用界面版本覆盖绑定文件？', content: '文件中的外部修改将被替换。',
            okText: '保留界面版本', cancelText: '取消', zIndex: 1500,
            onOk: () => bindingRef.current?.resolve('local'),
          })}>保留界面版本</button>
        </div>} /> : null}
      {!loading && !editing ? <>
        {!error && !files.length ? <div className="part-split-dialog__status">
          <Empty description="未发现字幕识别结果" />
          <p>{workspacePath ? '请先在当前工作空间完成字幕识别，生成 sre_ 开头的 JSON 文件。' : '请先选择工作空间并完成字幕识别。'}</p>
        </div> : null}
        {files.length > 1 ? <div className="part-split-dialog__file-picker">
          <p>发现 {files.length} 个字幕识别结果，请先选择一个</p>
          {files.map((file) => <button type="button" key={file.path} className="part-split-dialog__file"
            onClick={() => setSelectedFile({ ...file })}>
            <FileText size={20} aria-hidden="true" /><span title={file.relativePath}>{file.relativePath}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div> : null}
      </> : null}
      {editing ? <fieldset className="part-split-dialog__editor" disabled={editorDisabled}>
        <StoryboardEditor parts={labeledParts} selectedId={selectedId} source={recognition.mediaSource}
          aiDisabled={chatTask.running || !chatTask.send}
          onAiAssist={() => { setAiOpen(true); setAiInstruction(AI_ASSIST_DEFAULT_INSTRUCTION); }}
          fallbackSource={recognition.fallbackSource} segments={recognition.segments} disabled={editorDisabled}
          onSelect={setSelectedId} onInsert={addEmptyPart}
          onResize={(id, edge, value, sourceEnd) => {
            const next = resizePart(parts, recognition.segments, id, edge, value, sourceEnd);
            if (next !== parts) updateParts(next, id);
          }}
          onDeleteSubtitles={(units) => {
            const next = deleteSubtitleUnits(parts, recognition.segments, units);
            updateParts(next, next.some((part) => part.id === selectedId) ? selectedId : next[0]?.id || '');
          }}
          onDeleteSubtitleText={(units) => {
            const next = deleteSubtitleTextUnits(parts, recognition.segments, units);
            if (next.some((part, index) => part !== parts[index])) updateParts(next);
          }}
          onEditCaption={(id, edit) => {
            const next = parts.map((part) => part.id === id ? editCaption(part, recognition.segments, edit) : part);
            if (next.some((part, index) => part !== parts[index])) updateParts(next);
          }}
          onSplit={(time) => updateParts(splitPart(partsWithCaptions(), selectedId, time, nextId()))}
          onMerge={(ids) => {
            try {
              const next = mergeParts(partsWithCaptions(), ids);
              updateParts(next, parts.find((part) => ids.includes(part.id))?.id);
            } catch (cause) { setError(cause.message); }
          }}
          onDelete={(ids = [selectedId]) => {
            const remaining = parts.filter((part) => !ids.includes(part.id));
            const index = parts.findIndex((part) => ids.includes(part.id));
            const nextSelection = remaining.some((part) => part.id === selectedId) ? selectedId
              : remaining[Math.min(Math.max(0, index), remaining.length - 1)]?.id || '';
            updateParts(remaining, nextSelection);
          }} />
      </fieldset> : null}
    </Modal>
      {!aiBusy ? <Modal open={open && aiOpen} title="AI辅助" centered width={480} zIndex={1500}
        className="part-split-ai-dialog" okText="确认" cancelText="取消"
        onCancel={() => setAiOpen(false)} okButtonProps={{ disabled: chatTask.running || editorDisabled }}
        onOk={async () => { if (await submitAi(aiInstruction)) setAiOpen(false); }}>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Input.TextArea aria-label="AI辅助要求" autoFocus value={aiInstruction} maxLength={4000}
          autoSize={{ minRows: 4, maxRows: 8 }}
          onChange={(event) => setAiInstruction(event.target.value)} />
      </Modal> : null}
    </>
  );
};

export default PartSplitToolDetail;
