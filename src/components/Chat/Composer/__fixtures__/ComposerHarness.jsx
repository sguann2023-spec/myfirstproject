import AttachmentUploadCards from '../AttachmentUploadCards';
import { buildAttachmentPurposeGroups, normalizeAttachmentPurpose } from '../attachmentPurpose';
import useAttachmentPrompt from '../useAttachmentPrompt';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Select } from 'antd';
import { ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import ToolArea from '../ToolArea';
import LocalFilePreviewList from '../LocalFilePreviewList';
import AiWriteToolDetail from '../AiWriteToolDetail';
import DigitalHumanToolDetail from '../DigitalHumanToolDetail';
import ImagePanToolDetail from '../ImagePanToolDetail';
import VideoToolDetail from '../VideoToolDetail';
import VoiceSquareToolDetail from '../VoiceSquareToolDetail';
import AudioAddToolDetail from '../../../AudioAddToolDetail';
import RecognizationSubtitleToolDetail from '../../../RecognizationSubtitleToolDetail';
import MusicGenerateToolDetail from '../../../MusicGenerateToolDetail';
import DraftDownloadToolDetail from '../../../DraftDownloadToolDetail';
import DraftInspectToolDetail from '../../../DraftInspectToolDetail';
import DraftModifyToolDetail from '../../../DraftModifyToolDetail';
import DraftToolDetail from '../../../DraftToolDetail';
import PresetAddDetail from '../../../PresetAddDetail';
import RevertPrompt from '../../../RevertPrompt';
import ImageAddDetailTool from '../../../ImageAddDetailTool';
import TextAddDetail from '../../../TextAddDetail';
import TTSToolDetail from '../../../TTSToolDetail';
import VideoDetailTool from '../../../VideoDetailTool';
import VoiceConversationTool from '../../../VoiceConversationTool';
import { fixtureImage } from './api-mocks';
import '../Composer.css';
import './harness.css';

// Same 19 detail branches as Composer. Menus/dialogs are the components' own AntD UI.
export const TOOL_MODES = [
  ['recognize-subtitle', '识别字幕', RecognizationSubtitleToolDetail], ['text-add', '添加文本', TextAddDetail],
  ['preset-add', '添加预设', PresetAddDetail], ['audio-add', '添加音频', AudioAddToolDetail],
  ['image-add', '添加图片', ImageAddDetailTool], ['reverse-prompt', '反推提示词', RevertPrompt],
  ['video-understand', '逐帧拉片', VideoDetailTool], ['ai-write', 'AI文本工具', AiWriteToolDetail],
  ['draft', '新草稿', DraftToolDetail], ['draft-export', '导出草稿', DraftDownloadToolDetail],
  ['draft-inspect', '查看草稿', DraftInspectToolDetail], ['draft-modify', '修改草稿', DraftModifyToolDetail],
  ['voice-square', 'AI朗读', TTSToolDetail], ['music-generate', 'AI生成音频', MusicGenerateToolDetail],
  ['voice-conversion', '变声', VoiceConversationTool], ['voice-clone', '克隆', VoiceSquareToolDetail],
  ['digital-human', '数字人', DigitalHumanToolDetail], ['image-pan', 'AI图片', ImagePanToolDetail],
  ['ai-video', 'AI生成视频', VideoToolDetail],
];
const initial = new URLSearchParams(location.search);
const validMode = (value) => TOOL_MODES.some(([id]) => id === value) ? value : '';
const longText = Array.from({ length: 36 }, (_, index) => `第${index + 1}段：这是用于验证输入区滚动、工具栏与附件互不遮挡的长文本。Actual TipTap editor / 真实工具组件与 AntD 浮层。`).join('\n');
const noop = () => {};
const priceState = { loading: false, text: '2积分', priceText: '2积分', title: '只读测试价格' };
const file = (id, kind = 'image', slotId = '') => ({ uid: `fixture-${id}`, slotId, name: kind === 'image' ? `测试图片-${id}.svg` : `这是一份用于验证超长文件名与省略号的普通附件-${id}.txt`, fileType: kind === 'image' ? 'image/svg+xml' : 'text/plain', ...(kind === 'image' ? { localPreviewUrl: fixtureImage } : {}) });
const slots = [{ key: 'first-frame', label: '首帧图片', kind: 'image' }, { key: 'last-frame', label: '尾帧图片', kind: 'image' }, { key: 'audio-reference', label: '参考音频', kind: 'audio' }];
const groups = () => [
  { key: 'images', label: '参考图片', count: 1, countHint: '1/4', files: [file('group-1')], placeholder: { key: 'images', label: '添加图片', kind: 'image' } },
  { key: 'videos', label: '参考视频', count: 0, countHint: '至少1个', invalid: true, files: [], placeholder: { key: 'videos', label: '添加视频', kind: 'video' } },
  { key: 'audio', label: '参考音频', count: 0, countHint: '可选', files: [], placeholder: { key: 'audio', label: '添加音频', kind: 'audio' } },
];

class DetailBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <div role="alert">Actual component failed: {this.state.error.message}</div> : this.props.children; }
}

export function ComposerHarness() {
  const [mode, setMode] = React.useState(validMode(initial.get('tool')));
  const [width, setWidth] = React.useState(Math.max(320, Math.min(1400, Number(initial.get('width')) || 960)));
  const [attachmentMode, setAttachmentMode] = React.useState(initial.get('attachments') || 'none');
  const [files, setFiles] = React.useState([file('image'), file('document', 'file')]);
  const [placeholders, setPlaceholders] = React.useState(slots);
  const [fileGroups, setFileGroups] = React.useState(groups);
  const [activeGroup, setActiveGroup] = React.useState('images');
  const [text, setText] = React.useState(initial.get('long') === '1' ? longText : '');
  const [selectedDraftIds, setSelectedDraftIds] = React.useState([]);
  const [selectedPreset, setSelectedPreset] = React.useState(null);
  const [presetId, setPresetId] = React.useState('add-text');
  const [draftResolution, setDraftResolution] = React.useState('1920x1080');
  const [imageModel, setImageModel] = React.useState('seedream-4.5');
  const [imageResolution, setImageResolution] = React.useState('1440x2560');
  const [videoModel, setVideoModel] = React.useState('seedance-2.0');
  const [videoMode, setVideoMode] = React.useState('text_to_video');
  const [videoResolution, setVideoResolution] = React.useState('720x1280');
  const [duration, setDuration] = React.useState(5);
  const [generateAudio, setGenerateAudio] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const [superResolve, setSuperResolve] = React.useState(false);
  const [speechModel, setSpeechModel] = React.useState('');
  const [chatModel, setChatModel] = React.useState('gpt-6.1-sol');
  const bar = React.useRef(null), right = React.useRef(null), scroll = React.useRef(null);
  const [maxWidth, setMaxWidth] = React.useState(null);
  const [overflow, setOverflow] = React.useState({ overflowing: false, left: false, right: false });
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, codeBlock: false, horizontalRule: false, link: false })],
    content: { type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) },
    editorProps: { attributes: { class: 'chat-panel__input-prosemirror', role: 'textbox', 'aria-label': 'Fixture composer input', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: value }) => setText(value.getText()),
  });
  const fill = React.useCallback((value) => {
    setText(value);
    editor?.commands.setContent({ type: 'doc', content: value.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) });
  }, [editor]);
  useAttachmentPrompt({
    editor,
    files,
    enabled: !mode,
    sessionId: 'fixture',
    getText: (value) => value.getText(),
    setText,
    buildDocument: (value) => ({ type: 'doc', content: [{ type: 'paragraph', ...(value ? { content: [{ type: 'text', text: value }] } : {}) }] }),
  });
  const back = React.useCallback(() => setMode(''), []);
  const selectTool = (id) => {
    if (id === 'template-new') return; // Opens a separate app window in production; intentionally unavailable.
    if (id.startsWith('ai-write:')) {
      const preset = id.slice(9);
      if (['add-text', 'recognize-subtitle', 'reverse-prompt'].includes(preset)) setMode(preset === 'add-text' ? 'text-add' : preset);
      else if (preset === 'subtitle-storyboard') { setPresetId(preset); setMode('ai-write'); }
      else { setPresetId(preset); setMode('ai-write'); }
    } else setMode(validMode(id));
  };
  React.useLayoutEffect(() => {
    const update = () => {
      if (bar.current && right.current) {
        const style = getComputedStyle(bar.current);
        const gap = parseFloat(style.columnGap || style.gap) || 0;
        const next = Math.max(0, bar.current.clientWidth - right.current.offsetWidth - gap - 32);
        setMaxWidth((previous) => previous !== null && Math.abs(previous - next) < 1 ? previous : next);
      }
      const element = scroll.current;
      if (!element) return;
      const max = Math.max(0, element.scrollWidth - element.clientWidth), overflowing = max > 24;
      const next = { overflowing, left: overflowing && element.scrollLeft > 1, right: overflowing && element.scrollLeft < max - 1 };
      setOverflow((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new ResizeObserver(update);
    [bar.current, right.current, scroll.current, scroll.current?.firstElementChild].filter(Boolean).forEach((element) => observer.observe(element));
    scroll.current?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const element = scroll.current;
    update();
    return () => { observer.disconnect(); element?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [mode, width, chatModel]);
  const addPurposeAttachment = (purpose) => setFiles((previous) => [
    ...previous,
    { ...file(`${purpose}-${previous.length}`), purpose },
  ]);
  const addPlaceholder = (placeholder) => {
    if (placeholder.purpose) {
      addPurposeAttachment(placeholder.purpose);
      setActiveGroup(placeholder.key);
      return;
    }
    const groupKey = placeholder.key;
    if (fileGroups.some((group) => group.key === groupKey) && attachmentMode === 'grouped') {
      setFileGroups((previous) => previous.map((group) => group.key !== groupKey ? group : { ...group, invalid: false, count: group.count + 1, files: [...group.files, file(`${groupKey}-${group.count + 1}`, placeholder.kind === 'image' ? 'image' : 'file')], countHint: '只读演示素材' }));
    } else {
      setFiles((previous) => [...previous, file(groupKey, placeholder.kind === 'image' ? 'image' : 'file', groupKey)]);
      setPlaceholders((previous) => previous.filter((slot) => slot.key !== groupKey));
    }
  };
  const removeFile = (removed) => {
    setFiles((previous) => previous.filter((entry) => entry.uid !== removed.uid));
    setFileGroups((previous) => previous.map((group) => { const files = group.files.filter((entry) => entry.uid !== removed.uid); return { ...group, files, count: files.length }; }));
    if (removed.slotId) setPlaceholders((previous) => [...previous, slots.find((slot) => slot.key === removed.slotId)].filter(Boolean));
  };
  const hidden = ['text-add', 'recognize-subtitle', 'audio-add', 'image-add', 'voice-conversion'].includes(mode);
  const hasAttachments = attachmentMode !== 'none' || files.some((entry) => entry.purpose);
  const purposeGroups = !mode && attachmentMode !== 'grouped' ? buildAttachmentPurposeGroups(files) : null;
  const showUploadCards = !mode && !purposeGroups && attachmentMode !== 'grouped';
  const visibleFiles = purposeGroups ? files.filter((entry) => !normalizeAttachmentPurpose(entry.purpose)) : files;
  const Detail = TOOL_MODES.find(([id]) => id === mode)?.[2];
  const detailProps = { disabled: false, onBack: back, selectedDraftIds, onSelectedDraftIdsChange: setSelectedDraftIds, inputText: text, onInputTextChange: fill, onSettingsChange: noop, selectedPreset, onSelectedPresetChange: setSelectedPreset, onPromptChange: fill, onTemplateMediaChange: noop, onSelectedVoiceChange: noop, priceState, ...(mode === 'ai-write' ? { selectedPresetId: presetId, onPresetSelect: setPresetId } : {}), ...(mode === 'draft' ? { selectedResolution: draftResolution, onResolutionChange: setDraftResolution } : {}), ...(mode === 'voice-square' ? { selectedModel: speechModel, onModelChange: setSpeechModel } : {}), ...(mode === 'voice-clone' ? { cloneOnly: true } : {}), ...(mode === 'image-pan' ? { selectedModel: imageModel, onModelChange: setImageModel, selectedResolution: imageResolution, onResolutionChange: setImageResolution } : {}), ...(mode === 'ai-video' ? { selectedModel: videoModel, onModelChange: setVideoModel, selectedGenerationMode: videoMode, onGenerationModeChange: setVideoMode, selectedResolution: videoResolution, onResolutionChange: setVideoResolution, selectedDuration: duration, onDurationChange: setDuration, selectedGenerateAudio: generateAudio, onGenerateAudioChange: setGenerateAudio, selectedSeedanceOffline: offline, onSeedanceOfflineChange: setOffline, selectedSuperResolve: superResolve, onSuperResolveChange: setSuperResolve } : {}) };
  return <ConfigProvider theme={{ token: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>
    <main className="fixture-page">
      <header className="fixture-controls">
        <h1>Composer · real component fixture</h1>
        <p>DEV/TEST only · 19 actual details · no send, generation, uploads, disk access or external requests</p>
        <div className="fixture-control-row">
          <label>Tool mode <select aria-label="Tool mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="">Default ToolArea</option>{TOOL_MODES.map(([id, name]) => <option key={id} value={id}>{id} · {name}</option>)}</select></label>
          <label>Host width <select aria-label="Host width" value={width} onChange={(event) => setWidth(Number(event.target.value))}>{[360, 480, 640, 768, 960, 1200, 1400, width].filter((value, index, all) => all.indexOf(value) === index).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Attachments <select aria-label="Attachments" value={attachmentMode} onChange={(event) => setAttachmentMode(event.target.value)}><option value="none">None</option><option value="ordinary">Ordinary files</option><option value="slots">Placeholder/file slots</option><option value="grouped">Grouped slots + files</option></select></label>
          <label><input type="checkbox" aria-label="Select fixture draft" checked={selectedDraftIds.length > 0} onChange={(event) => setSelectedDraftIds(event.target.checked ? ['fixture-draft-01'] : [])} />Select fixture draft</label>
          <button type="button" onClick={() => fill(longText)}>Fill long input</button><button type="button" onClick={() => fill('')}>Clear input</button>
          <button type="button" onClick={() => { setFiles([file('image'), file('document', 'file')]); setPlaceholders(slots); setFileGroups(groups()); setActiveGroup('images'); }}>Reset attachments</button>
        </div>
      </header>
      <section className="fixture-stage" style={{ width: `${width}px` }} aria-label="Composer layout host">
        <div className="chat-panel__composer" data-active-tool={mode || 'default'} data-attachment-mode={attachmentMode}>
          <div className="chat-panel__editor">
            <LocalFilePreviewList files={hasAttachments ? visibleFiles : []} placeholders={attachmentMode === 'slots' ? placeholders : []} slotOrder={attachmentMode === 'slots' ? slots.map((slot) => slot.key) : []} fileGroups={purposeGroups || (attachmentMode === 'grouped' ? fileGroups : null)} activeGroupKey={activeGroup} onActiveGroupChange={setActiveGroup} onRemove={removeFile} onAddFile={addPlaceholder} />
            <div ref={bar} className={`chat-panel__tool-bar${hasAttachments ? ' chat-panel__tool-bar--with-attachments' : ''}`}>
              <div className="chat-panel__tool-left"><div className="chat-panel__tool-content-shell" style={maxWidth === null ? undefined : { maxWidth: `${maxWidth}px` }}>
                <div className={`chat-panel__tool-content-viewport${overflow.overflowing ? ' is-overflowing' : ''}${overflow.left ? ' can-scroll-left' : ''}${overflow.right ? ' can-scroll-right' : ''}`}>
                  <div ref={scroll} className="chat-panel__tool-content-scroll"><DetailBoundary key={mode}>{Detail ? <Detail {...detailProps} /> : <ToolArea onSelect={selectTool} />}</DetailBoundary></div>
                </div>
                <div className="chat-panel__tool-content-nav-group" aria-hidden={!overflow.overflowing}>{[-1, 1].map((direction) => {
                  const available = direction < 0 ? overflow.left : overflow.right, Icon = direction < 0 ? ChevronLeft : ChevronRight;
                  return <button key={direction} type="button" aria-label={direction < 0 ? '向左查看工具' : '向右查看工具'} className={`chat-panel__tool-content-nav${available ? ' is-visible' : ''}`} disabled={!available} onClick={() => scroll.current?.scrollBy({ left: direction * 220, behavior: 'smooth' })}><Icon className="chat-panel__tool-content-nav-icon" /></button>;
                })}</div>
              </div></div>
              <div ref={right} className="chat-panel__tool-right"><div className="chat-panel__model-picker-wrap"><Select size="small" variant="borderless" className="chat-panel__model-picker chat-panel__model-picker--chat" value={chatModel} onChange={setChatModel} options={[{ value: 'gpt-6.1-sol', label: 'gpt-6.1-sol' }, { value: 'claude-opus-5-5', label: 'claude-opus-5-5' }]} popupMatchSelectWidth={false} virtual={false} getPopupContainer={(trigger) => trigger.parentElement} /></div><span><button type="button" className="chat-panel__send-btn disabled" aria-label="发送消息（fixture disabled）" disabled aria-disabled="true"><ArrowUp className="chat-panel__send-icon" /></button></span></div>
            </div>
            <div className={`chat-panel__input-wrap${showUploadCards ? ' chat-panel__input-wrap--with-upload-cards' : ''}${hidden ? ' chat-panel__input-wrap--hidden' : ''}`}>{showUploadCards ? <AttachmentUploadCards onSelect={addPurposeAttachment} /> : null}<div className={`chat-panel__input-editor${hidden ? ' chat-panel__input-editor--hidden' : ''}`}><EditorContent editor={editor} className="chat-panel__input chat-panel__input--tiptap" style={{ '--input-placeholder': JSON.stringify(text ? '' : '输入内容；此测试环境无法发送') }} /></div></div>
          </div>
        </div>
      </section>
      <footer className="fixture-status" role="status">Mode: {mode || 'default'} · input: {text.length} characters · editor {hidden ? 'hidden (production rule)' : 'visible'} · actual CSS is imported unchanged. Remote template previews and custom text preset persistence are unavailable.</footer>
    </main>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')).render(<ComposerHarness />);
