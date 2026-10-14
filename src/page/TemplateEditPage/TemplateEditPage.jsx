import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { parseTree } from 'jsonc-parser';
import { Braces, Film, Image, Layers, Music2, Redo2, SlidersHorizontal, Sparkles, Sticker, Type, Undo2 } from 'lucide-react';
import LayerPanel from './LayerPanel';
import EditorTimeline from './EditorTimeline';
import { indexEditorTree, sceneTimeline } from './editorView';
import './TemplateEditPage.css';

const tools = [
  { type: 'scene', label: '添加 Scene', Icon: Layers },
  { type: 'text', label: '添加文字', Icon: Type },
  { type: 'image', label: '添加图片', Icon: Image },
  { type: 'video', label: '添加视频', Icon: Film },
  { type: 'audio', label: '添加音频', Icon: Music2 },
  { type: 'sticker', label: '添加贴纸', Icon: Sticker },
  { type: 'filter', label: '添加滤镜', Icon: SlidersHorizontal },
  { type: 'effect', label: '添加特效', Icon: Sparkles }
];
const extensions = [json(), EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Menlo, Consolas, monospace', lineHeight: '1.8' },
  '.cm-gutters': { backgroundColor: '#fff', borderRight: '1px solid #f0f0f0', color: '#a0a0a0' },
  '.cm-activeLine': { backgroundColor: '#f4f6fa' }
})];
const invoke = (channel, ...args) => {
  const ipc = window.electron?.ipcRenderer || window.require?.('electron')?.ipcRenderer;
  return ipc ? ipc.invoke(channel, ...args) : Promise.reject(new Error('请在桌面客户端打开模版编辑器'));
};

const TemplateEditPage = () => {
  const [templateJson, setTemplateJson] = useState('');
  const [model, setModel] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [sceneId, setSceneId] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [lockedTracks, setLockedTracks] = useState(new Set());
  const [history, setHistory] = useState({ past: [], future: [] });
  const [workflowMode, setWorkflowMode] = useState(false);
  const [compiled, setCompiled] = useState(null);
  const [error, setError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [ready, setReady] = useState(false);
  const revision = useRef(0);
  const operation = useRef(false);
  const lastTyping = useRef(0);
  const editorRef = useRef(null);
  const index = useMemo(() => indexEditorTree(model?.tree), [model]);
  const timelineView = useMemo(() => sceneTimeline(model, index, sceneId), [model, index, sceneId]);
  const nativeIndex = useMemo(() => {
    const result = new Map();
    try {
      const root = JSON.parse(templateJson);
      result.set('__root__', root);
      const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.id === 'string') result.set(value.id, value);
        Object.values(value).forEach(visit);
      };
      visit(root);
    } catch { /* Keep invalid JSON editable without enabling visual mutations. */ }
    return result;
  }, [templateJson]);
  useEffect(() => {
    if (model && !pending && !analysisError) {
      if (sceneId && !index.has(sceneId)) setSceneId(null);
      if (selectedId && !index.has(selectedId)) setSelectedId('');
    }
  }, [index, model, pending, analysisError, sceneId, selectedId]);

  useEffect(() => {
    let active = true;
    const presetId = new URLSearchParams(window.location.search).get('preset') || 'empty';
    invoke('template:editor-defaults', presetId).then((result) => {
      if (!active) return;
      setTemplateJson(result.templateJson);
      setReady(true);
    }).catch((err) => { if (active) { setError(err.message); setPending(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let active = true;
    const version = revision.current;
    setPending(true);
    const timer = setTimeout(() => {
      invoke('template:editor-analyze', { templateJson }).then((next) => {
        if (!active || version !== revision.current) return;
        setModel(next);
        setAnalysisError('');
      }).catch((err) => {
        if (active && version === revision.current) setAnalysisError(err.message);
      }).finally(() => { if (active && version === revision.current) setPending(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [templateJson, ready]);

  useEffect(() => {
    if (workflowMode) return;
    const view = editorRef.current?.view;
    if (!view) return;
    function locate(node) {
      if (!node) return null;
      if (node.type === 'object' && node.children?.some((property) =>
        property.children?.[0]?.value === 'id' && property.children?.[1]?.value === selectedId)) return node;
      for (const child of node.children || []) {
        const found = locate(child);
        if (found) return found;
      }
      return null;
    }
    const node = locate(parseTree(view.state.doc.toString()));
    if (node) view.dispatch({ selection: { anchor: node.offset, head: node.offset + node.length }, scrollIntoView: true });
  }, [selectedId, workflowMode]);

  const applyJson = (value) => {
    revision.current++;
    setPending(true);
    setCompiled(null);
    setError('');
    setExportResult(null);
    setTemplateJson(value);
  };
  const edit = (value, typing = false) => {
    if (value === templateJson) return;
    const now = Date.now();
    if (!typing || now - lastTyping.current > 700) {
      setHistory(previous => ({ past: [...previous.past.slice(-99), { json: templateJson, selectedId, sceneId }], future: [] }));
    } else setHistory(previous => ({ ...previous, future: [] }));
    lastTyping.current = typing ? now : 0;
    applyJson(value);
  };
  const restore = (redo = false) => {
    if (operation.current || busy) return;
    const source = redo ? history.future : history.past;
    if (!source.length) return;
    const saved = source[source.length - 1];
    const current = { json: templateJson, selectedId, sceneId };
    setHistory(redo
      ? { past: [...history.past, current], future: history.future.slice(0, -1) }
      : { past: history.past.slice(0, -1), future: [...history.future, current] });
    lastTyping.current = 0;
    applyJson(saved.json); setSelectedId(saved.selectedId); setSceneId(saved.sceneId); setWorkflowMode(false);
  };
  const select = (id) => {
    setSelectedId(id);
    setWorkflowMode(false);
    const ancestors = index.get(id)?.ancestors ?? [];
    setCollapsed(previous => new Set([...previous].filter(value => !ancestors.includes(value))));
  };
  const enter = (id) => {
    setSceneId(id); setSelectedId(''); setWorkflowMode(false);
    if (id) setCollapsed(previous => new Set([...previous].filter(value => value !== id && !index.get(id)?.ancestors.includes(value))));
  };
  const reveal = (id) => { setSceneId(index.get(id)?.sceneId ?? null); select(id); };
  const isLocked = (id) => {
    const node = index.get(id);
    return lockedTracks.has(id) || lockedTracks.has(node?.trackId) ||
      node?.ancestors.some(ancestor => lockedTracks.has(ancestor)) ||
      (node && lockedTracks.has('__template_scenes__')) ||
      [...lockedTracks].some(track => index.get(track)?.ancestors.includes(id));
  };
  const mutate = async (action) => {
    if (operation.current || busy || pending || analysisError) return;
    if (isLocked(action.id) || (action.trackId && isLocked(action.trackId)) ||
      (action.beforeId && isLocked(action.beforeId))) { setError('轨道已锁定，请先解锁'); return; }
    operation.current = true; setBusy(true); setError('');
    try {
      const result = await invoke('template:editor-edit', { templateJson }, action);
      edit(result.templateJson); select(result.selectedId);
    } catch (err) { setError(err.message); }
    finally { operation.current = false; setBusy(false); }
  };
  const add = async (type, inScope = false) => {
    if (operation.current || busy || pending || analysisError) return;
    const targetId = inScope ? sceneId : selectedId || sceneId || undefined;
    if (targetId && isLocked(targetId)) { setError('轨道已锁定，请先解锁'); return; }
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await invoke('template:editor-add', { templateJson }, { type, selectedId: targetId,
        ...(type === 'scene' && !targetId && sceneId === null ? { atRoot: true } : {}) });
      if (result) {
        edit(result.templateJson);
        setSelectedId(result.selectedId);
        if (targetId) setCollapsed(previous => new Set([...previous].filter(id => id !== targetId && !index.get(targetId)?.ancestors.includes(id))));
        setWorkflowMode(false);
      }
    } catch (err) { setError(err.message); }
    finally { operation.current = false; setBusy(false); }
  };
  const toggleWorkflow = async () => {
    if (workflowMode) { setWorkflowMode(false); return; }
    setWorkflowMode(true);
    setBusy(true);
    setError('');
    setCompiled(null);
    try {
      setCompiled(await invoke('template:editor-compile', { templateJson }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const testExport = async () => {
    if (busy || pending || analysisError || exporting) return;
    setBusy(true);
    setExporting(true);
    setError('');
    setExportResult(null);
    try {
      setExportResult(await invoke('template:editor-test-export', { templateJson }));
    } catch (err) { setError(err.message); }
    finally { setExporting(false); setBusy(false); }
  };
  const toggleLayer = (id) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const disabled = !ready || busy || pending || Boolean(analysisError);
  const displayedJson = workflowMode ? (compiled ? JSON.stringify(compiled.workflow, null, 2) : '')
    : templateJson;

  return (
    <main className="template-edit-page" aria-label="模版编辑器" onKeyDownCapture={event => {
      const typing = event.target.closest('input, textarea, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        if (typing && !event.target.closest('.cm-editor')) return;
        event.preventDefault(); restore(event.shiftKey || event.key.toLowerCase() === 'y');
        event.stopPropagation();
        return;
      }
      if (typing) return;
      if (['Delete', 'Backspace'].includes(event.key) && selectedId) { event.preventDefault(); mutate({ type: 'delete', id: selectedId }); }
      if (event.key === 'Escape' && sceneId) enter(index.get(sceneId)?.sceneId ?? null);
    }}>
      <header className="template-edit-header">
        <div className="template-edit-title"><Layers size={19} /><h1>新模版</h1><span>Scene 编辑器</span></div>
        <div className="template-edit-tools" role="toolbar" aria-label="添加素材">
          {tools.map(({ type, label, Icon }) => <button key={type} className="template-icon-button"
            aria-label={label} title={label} disabled={!ready || busy || pending || Boolean(analysisError)}
            onClick={() => add(type)}><Icon size={20} /></button>)}
        </div>
        <div className="template-header-actions">
        <button className="template-icon-button" aria-label="撤销" title="撤销 Ctrl/Cmd+Z" disabled={busy || !history.past.length} onClick={() => restore()}><Undo2 size={17} /></button>
        <button className="template-icon-button" aria-label="重做" title="重做 Ctrl/Cmd+Shift+Z" disabled={busy || !history.future.length} onClick={() => restore(true)}><Redo2 size={17} /></button>
        <button className={`template-workflow-toggle ${workflowMode ? 'is-active' : ''}`}
          aria-label={workflowMode ? '切换到模版 JSON' : '切换到 Workflow'} aria-pressed={workflowMode}
          disabled={!ready || busy || (!workflowMode && (pending || Boolean(analysisError)))}
          onClick={toggleWorkflow}><Braces size={20} /><span>{workflowMode ? 'Workflow' : 'JSON'}</span></button>
        <button className="template-test-export" disabled={!ready || busy || pending || Boolean(analysisError)}
          aria-label="测试导出" aria-busy={exporting} onClick={testExport}>
          {exporting ? <span className="template-spinner" /> : null}测试导出
        </button>
        </div>
      </header>

      <div className="template-edit-body">
        <LayerPanel model={model} index={index} nativeIndex={nativeIndex} selectedId={selectedId} collapsed={collapsed} onToggle={toggleLayer}
          onSelect={select} onEnter={enter} onReveal={reveal} onAction={mutate} disabled={disabled} />
        <section className="template-edit-code" aria-label="JSON 编辑区">
          <div className="template-code-heading">
            <strong>{workflowMode ? <>Workflow <span className="template-muted">只读</span></> : 'Template JSON'}</strong>
            <span className="template-muted">{busy || pending ? <span className="template-spinner" aria-label="处理中" /> :
              workflowMode ? '未提交执行' : '仅当前窗口，未保存'}</span>
          </div>
          {(analysisError || error) && <div className="template-edit-error" role="alert">{analysisError || error}</div>}
          {exportResult && <div className="template-export-result" role="status">
            草稿 {exportResult.draftId} 已提交导出，请在主窗口查看下载队列。
            <details><summary>转换说明（{exportResult.warnings.length}）</summary>
              {exportResult.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            </details>
          </div>}
          <div className="template-code-container">
            <CodeMirror ref={editorRef} value={displayedJson} height="100%" extensions={extensions}
              editable={!workflowMode && !busy} readOnly={workflowMode || busy}
              basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: false, history: false }}
              onChange={(value) => { if (!workflowMode && !busy) edit(value, true); }} />
          </div>
          {workflowMode && compiled?.warnings.length > 0 && <details className="template-compile-warnings">
            <summary>转换说明（{compiled.warnings.length}）</summary>
            {compiled.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </details>}
        </section>
      </div>

      <EditorTimeline view={analysisError ? { ...timelineView, rows: [] } : timelineView} selectedId={selectedId} sceneId={sceneId}
        nativeIndex={nativeIndex} onSelect={select} onEnter={enter} onAction={mutate} disabled={disabled}
        onAddScene={() => add('scene', true)} lockedTracks={lockedTracks}
        onLock={id => setLockedTracks(previous => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })} />
    </main>
  );
};

export default TemplateEditPage;
