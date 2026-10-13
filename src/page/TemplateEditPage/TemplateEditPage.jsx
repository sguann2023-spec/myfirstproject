import React, { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { parseTree } from 'jsonc-parser';
import { Braces, ChevronDown, ChevronRight, Film, Image, Layers, Music2, Type } from 'lucide-react';
import './TemplateEditPage.css';

const icons = { composition: Layers, text: Type, image: Image, video: Film, audio: Music2 };
const tools = [
  { type: 'text', label: '添加文字', Icon: Type },
  { type: 'image', label: '添加图片', Icon: Image },
  { type: 'video', label: '添加视频', Icon: Film },
  { type: 'audio', label: '添加音频', Icon: Music2 }
];
const extensions = [json(), EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Menlo, Consolas, monospace', lineHeight: '1.8' },
  '.cm-gutters': { backgroundColor: '#fff', borderRight: '1px solid #f0f0f0', color: '#a0a0a0' },
  '.cm-activeLine': { backgroundColor: '#f4f6fa' }
})];
const formatTime = (value) => Number(value.toFixed(4)).toString();
const invoke = (channel, ...args) => {
  const ipc = window.electron?.ipcRenderer || window.require?.('electron')?.ipcRenderer;
  return ipc ? ipc.invoke(channel, ...args) : Promise.reject(new Error('请在桌面客户端打开模版编辑器'));
};

function LayerNode({ node, depth = 0, selectedId, onSelect, collapsed, onToggle }) {
  const Icon = icons[node.type] || Layers;
  const isScene = node.type === 'composition';
  const closed = collapsed.has(node.id);
  return (
    <li role="treeitem" aria-selected={selectedId === node.id} aria-expanded={isScene ? !closed : undefined}>
      <div className={`template-layer ${selectedId === node.id ? 'is-selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 20 }}>
        {isScene ? <button className="template-disclosure" aria-label={`${closed ? '展开' : '折叠'} ${node.name}`}
          onClick={() => onToggle(node.id)}>{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
          : <span className="template-disclosure" />}
        <button className="template-layer-select" onClick={() => onSelect(node.id)} title={node.name}>
          <Icon size={15} /><strong>{node.name}</strong>
          {node.text && <span>{node.text}</span>}
        </button>
      </div>
      {isScene && !closed && <ul role="group">{node.children.map((child) =>
        <LayerNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect}
          collapsed={collapsed} onToggle={onToggle} />)}</ul>}
    </li>
  );
}

const TemplateEditPage = () => {
  const [templateJson, setTemplateJson] = useState('');
  const [configJson, setConfigJson] = useState('{}');
  const [model, setModel] = useState(null);
  const [selectedId, setSelectedId] = useState('scene-1');
  const [collapsed, setCollapsed] = useState(new Set());
  const [mode, setMode] = useState('template');
  const [workflowMode, setWorkflowMode] = useState(false);
  const [compiled, setCompiled] = useState(null);
  const [error, setError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState(0);
  const revision = useRef(0);
  const editorRef = useRef(null);

  useEffect(() => {
    let active = true;
    invoke('template:editor-defaults').then((result) => {
      if (!active) return;
      setTemplateJson(result.templateJson);
      setConfigJson(result.configJson);
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
      invoke('template:editor-analyze', { templateJson, configJson }).then((next) => {
        if (!active || version !== revision.current) return;
        setModel(next);
        setAnalysisError('');
        setCursor((value) => Math.min(value, next.duration));
      }).catch((err) => {
        if (active && version === revision.current) setAnalysisError(err.message);
      }).finally(() => { if (active && version === revision.current) setPending(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [templateJson, configJson, ready]);

  useEffect(() => {
    if (workflowMode || mode !== 'template') return;
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
  }, [selectedId, workflowMode, mode]);

  const edit = (value) => {
    revision.current++;
    setPending(true);
    setCompiled(null);
    setError('');
    setExportResult(null);
    if (mode === 'template') setTemplateJson(value);
    else setConfigJson(value);
  };
  const select = (id) => {
    setSelectedId(id);
    setMode('template');
    setWorkflowMode(false);
  };
  const add = async (type) => {
    if (busy || pending || analysisError) return;
    setBusy(true);
    setError('');
    try {
      const result = await invoke('template:editor-add', { templateJson, configJson }, { type, selectedId });
      if (result) {
        revision.current++;
        setPending(true);
        setTemplateJson(result.templateJson);
        setSelectedId(result.selectedId);
        setCollapsed(new Set());
        setMode('template');
        setWorkflowMode(false);
        setCompiled(null);
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const toggleWorkflow = async () => {
    if (workflowMode) { setWorkflowMode(false); return; }
    setWorkflowMode(true);
    setBusy(true);
    setError('');
    setCompiled(null);
    try {
      setCompiled(await invoke('template:editor-compile', { templateJson, configJson }));
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
      setExportResult(await invoke('template:editor-test-export', { templateJson, configJson }));
    } catch (err) { setError(err.message); }
    finally { setExporting(false); setBusy(false); }
  };
  const toggleLayer = (id) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const timelineValid = model && !pending && !analysisError;
  const axisEnd = Math.max(5, Math.ceil((model?.duration || 5) / 5) * 5);
  const ticks = Array.from({ length: 6 }, (_, index) => axisEnd * index / 5);
  const displayedJson = workflowMode ? (compiled ? JSON.stringify(compiled.workflow, null, 2) : '')
    : mode === 'template' ? templateJson : configJson;

  return (
    <main className="template-edit-page" aria-label="模版编辑器">
      <header className="template-edit-header">
        <div className="template-edit-title"><Layers size={19} /><h1>新模版</h1><span>Scene 编辑器</span></div>
        <div className="template-edit-tools" role="toolbar" aria-label="添加素材">
          {tools.map(({ type, label, Icon }) => <button key={type} className="template-icon-button"
            aria-label={label} title={label} disabled={!ready || busy || pending || Boolean(analysisError)}
            onClick={() => add(type)}><Icon size={20} /></button>)}
        </div>
        <div className="template-header-actions">
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
        <aside className="template-edit-layers" aria-label="素材层级">
          <div className="template-panel-heading"><span>层级</span><span>{model?.timeline.length ?? 0} 个元素</span></div>
          {(pending || analysisError) && model && <p className="template-stale-note">上次有效结构</p>}
          <ul role="tree" aria-label="Scene 层级树">{model?.tree.map((node) =>
            <LayerNode key={node.id} node={node} selectedId={selectedId} onSelect={select}
              collapsed={collapsed} onToggle={toggleLayer} />)}</ul>
        </aside>
        <section className="template-edit-code" aria-label="JSON 编辑区">
          <div className="template-code-heading">
            {workflowMode ? <strong>Workflow <span className="template-muted">只读</span></strong> :
              <div className="template-code-tabs" role="tablist" aria-label="JSON 类型">
                <button role="tab" aria-selected={mode === 'template'} onClick={() => setMode('template')}>Template JSON</button>
                <button role="tab" aria-selected={mode === 'config'} onClick={() => setMode('config')}>关联配置</button>
              </div>}
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
              basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: false }}
              onChange={(value) => { if (!workflowMode && !busy) edit(value); }} />
          </div>
          {workflowMode && compiled?.warnings.length > 0 && <details className="template-compile-warnings">
            <summary>转换说明（{compiled.warnings.length}）</summary>
            {compiled.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </details>}
        </section>
      </div>

      <section className="template-edit-timeline" aria-label="静态时间轴">
        <div className="template-timeline-heading">
          <strong>时间轴</strong><span>{formatTime(cursor)} 秒</span>
          <span className="template-muted">静态展示 · 不播放</span>
          <span className="template-timeline-duration">总时长 {formatTime(model?.duration || 0)} 秒</span>
        </div>
        <div className="template-timeline-scroll">
          <div className="template-timeline-inner">
            <div className="template-ruler-row">
              <div className="template-track-label">场景 / 轨道</div>
              <div className="template-ruler" role="slider" aria-label="时间轴游标" tabIndex={0}
                aria-valuemin={0} aria-valuemax={axisEnd} aria-valuenow={cursor}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    setCursor((value) => Math.max(0, Math.min(axisEnd, value + (event.key === 'ArrowRight' ? 0.1 : -0.1))));
                  }
                }}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setCursor(Math.max(0, Math.min(axisEnd, (event.clientX - bounds.left) / bounds.width * axisEnd)));
                }}>
                {ticks.map((tick, index) => <span key={tick} className={index === 5 ? 'is-last' : ''}
                  style={{ left: `${tick / axisEnd * 100}%` }}>{formatTime(tick)}s</span>)}
              </div>
            </div>
            {timelineValid ? model.rows.map((row) => <div className="template-track-row" key={row.id}
              style={{ minHeight: row.lanes * 40 + 12 }}>
              <div className="template-track-label" title={row.name}><span>{row.name}</span><b>{row.track}</b></div>
              <div className="template-track-lane">
                <div className="template-outside-scene" style={{ left: `${model.duration / axisEnd * 100}%` }} />
                {row.clips.map((clip) => {
                  const Icon = icons[clip.type];
                  return <button key={clip.id} className={`template-clip ${selectedId === clip.id ? 'is-selected' : ''}`}
                    style={{ left: `${clip.start / axisEnd * 100}%`, width: `${(clip.end - clip.start) / axisEnd * 100}%`,
                      top: 6 + clip.lane * 40 }}
                    title={`${clip.name} · ${formatTime(clip.start)}–${formatTime(clip.end)} 秒`}
                    aria-label={`${clip.name}，${formatTime(clip.start)} 到 ${formatTime(clip.end)} 秒`}
                    onClick={() => select(clip.id)}><Icon size={13} /><span>{clip.name}</span></button>;
                })}
                <div className="template-playhead" style={{ left: `${cursor / axisEnd * 100}%` }} />
              </div>
            </div>) : <div className="template-timeline-empty">{analysisError ? '修正 JSON 后更新时间轴' : ''}</div>}
            {timelineValid && model.rows.length === 0 && <div className="template-timeline-empty">点击顶部按钮添加素材</div>}
          </div>
        </div>
      </section>
    </main>
  );
};

export default TemplateEditPage;
