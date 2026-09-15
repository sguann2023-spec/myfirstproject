import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { Typography } from 'antd'
import { CheckCircle, ChevronDown, ChevronUp, Eye, SquareArrowOutUpRight, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import PinnedDraftTrackView, {
  type DraftTrackScriptData
} from '../PinnedDraftTrackView/PinnedDraftTrackView'
import './index.css'

const { Text } = Typography
const logger = loggerService.withContext('PinnedDraftPannel')

const STATUS_META = {
  in_progress: {
    label: '处理中',
    tone: 'processing'
  },
  completed: {
    label: '已完成',
    tone: 'completed'
  }
} as const

type DraftStatus = keyof typeof STATUS_META

export interface PinnedDraftPanelItem {
  id?: string
  draftId?: string
  title?: string
  name?: string
  draftTitle?: string
  activeTitle?: string
  status?: DraftStatus
  statusLabel?: string
  statusTone?: 'processing' | 'completed'
  trackPreview?: DraftTrackScriptData
}

interface PinnedDraftPanelProps {
  drafts?: PinnedDraftPanelItem[]
  sessionActive?: boolean
  sessionFulfilled?: boolean
  defaultCollapsed?: boolean
  title?: string
  emptyText?: string
  onClose?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onDownloadAll?: (drafts: DisplayDraftItem[]) => void
  onDownloadItem?: (draft: DisplayDraftItem) => void
  onPreviewItem?: (draft: DisplayDraftItem) => void
  previewLoadingKey?: string | null
  previewErrorKey?: string | null
  previewErrorMessage?: string
  onToggle?: (collapsed: boolean) => void
}

interface DisplayDraftItem extends PinnedDraftPanelItem {
  key: string
  title: string
  status: DraftStatus
  statusLabel: string
  statusTone: 'processing' | 'completed'
}

const getStatusMeta = (status: DraftStatus) => STATUS_META[status] || STATUS_META.in_progress

const getDraftTitle = (draft: PinnedDraftPanelItem, index: number, sessionActive: boolean) => {
  if (draft.status === 'in_progress' && sessionActive && draft.activeTitle) {
    return draft.activeTitle
  }

  return draft.title || draft.name || draft.draftTitle || `草稿 ${index + 1}`
}

const DraftStatusIcon = ({ status }: { status: DraftStatus }) => {
  if (status === 'completed') {
    return <CheckCircle size={14} style={{ color: 'var(--color-primary)' }} />
  }

  return <LoadingIcon size={14} style={{ color: 'var(--color-primary)' }} />
}

export default function PinnedDraftPannel({
  drafts = [],
  sessionActive = false,
  sessionFulfilled = false,
  defaultCollapsed = true,
  title = '草稿处理',
  emptyText = '暂无草稿',
  onClose,
  onDownloadAll,
  onDownloadItem,
  onPreviewItem,
  previewLoadingKey = null,
  previewErrorKey = null,
  previewErrorMessage = '',
  onToggle
}: PinnedDraftPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const [previewDraftKey, setPreviewDraftKey] = useState<string | null>(null)
  const lastTriggeredPreviewKeyRef = useRef<string | null>(null)

  const displayDrafts = useMemo<DisplayDraftItem[]>(() => {
    return drafts.map((draft, index) => {
      const status: DraftStatus = draft.status === 'completed' ? 'completed' : 'in_progress'
      const normalizedStatus: DraftStatus = sessionFulfilled && !sessionActive ? 'completed' : status

      return {
        ...draft,
        key: draft.id || draft.draftId || `${draft.title || draft.name || 'draft'}-${index}`,
        title: getDraftTitle({ ...draft, status: normalizedStatus }, index, sessionActive),
        status: normalizedStatus,
        statusLabel: draft.statusLabel || getStatusMeta(normalizedStatus).label,
        statusTone: draft.statusTone || getStatusMeta(normalizedStatus).tone
      }
    })
  }, [drafts, sessionActive, sessionFulfilled])

  const activeDraft =
    displayDrafts.find((draft) => draft.status === 'in_progress') ||
    displayDrafts[0]
  const isSingleDraft = displayDrafts.length === 1
  const previewDraft = displayDrafts.find((draft) => draft.key === previewDraftKey) || null
  const isPreviewMode = isSingleDraft ? Boolean(previewDraft) : (!isCollapsed && Boolean(previewDraft))
  const isCollapsedView = isSingleDraft ? !isPreviewMode : isCollapsed
  const isPreviewLoading = Boolean(previewDraft?.key) && previewLoadingKey === previewDraft?.key
  const shouldShowPreviewLoading = isPreviewMode && (isPreviewLoading || previewDraft?.status === 'in_progress')

  const headerTitle = isPreviewMode
    ? `轨道预览${previewDraft?.title ? ` : ${previewDraft.title}` : ''}`
    : (isSingleDraft
      ? (activeDraft?.title || title)
      : (isCollapsedView && activeDraft ? activeDraft.title : title))
  const headerStatus = isPreviewMode ? previewDraft?.status : activeDraft?.status

  const openPreviewItem = (draft: DisplayDraftItem) => {
    logger.info('[PinnedDraftPannel] open preview item', {
      draftKey: draft.key,
      draftId: draft.id || draft.draftId || '',
      isSingleDraft,
      isCollapsed
    })
    if (!isSingleDraft) {
      setIsCollapsed(false)
      onToggle?.(false)
    }
    setPreviewDraftKey(draft.key)
  }

  useEffect(() => {
    if (!previewDraftKey) {
      logger.info('[PinnedDraftPannel] clear preview draft key')
      lastTriggeredPreviewKeyRef.current = null
      return
    }

    if (lastTriggeredPreviewKeyRef.current === previewDraftKey) {
      logger.info('[PinnedDraftPannel] skip duplicate preview trigger', { previewDraftKey })
      return
    }

    const targetDraft = displayDrafts.find((draft) => draft.key === previewDraftKey)
    if (!targetDraft) {
      logger.warn('[PinnedDraftPannel] preview draft not found in displayDrafts', { previewDraftKey })
      return
    }

    lastTriggeredPreviewKeyRef.current = previewDraftKey
    logger.info('[PinnedDraftPannel] trigger onPreviewItem', {
      previewDraftKey,
      draftId: targetDraft.id || targetDraft.draftId || '',
      title: targetDraft.title
    })
    onPreviewItem?.(targetDraft)
  }, [displayDrafts, onPreviewItem, previewDraftKey])

  const handleToggle = () => {
    logger.info('[PinnedDraftPannel] handle toggle', {
      isSingleDraft,
      isPreviewMode,
      isCollapsed,
      activeDraftKey: activeDraft?.key || null,
      previewDraftKey
    })
    if (isSingleDraft) {
      if (isPreviewMode) {
        setPreviewDraftKey(null)
      } else if (activeDraft) {
        openPreviewItem(activeDraft)
      }
      return
    }

    if (isPreviewMode) {
      setPreviewDraftKey(null)
      return
    }

    if (isCollapsed && activeDraft) {
      openPreviewItem(activeDraft)
      return
    }

    const nextCollapsed = !isCollapsed
    setIsCollapsed(nextCollapsed)
    onToggle?.(nextCollapsed)
  }

  const handleBackToList = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    logger.info('[PinnedDraftPannel] back to list', { previewDraftKey })
    setPreviewDraftKey(null)
  }

  const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onClose?.(event)
  }

  const handleDownloadAll = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (displayDrafts.length > 0) {
      onDownloadAll?.(displayDrafts)
    }
  }

  const handleDownloadItem = (draft: DisplayDraftItem) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDownloadItem?.(draft)
  }

  const handlePreviewItem = (draft: DisplayDraftItem) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    logger.info('[PinnedDraftPannel] preview button clicked', {
      draftKey: draft.key,
      draftId: draft.id || draft.draftId || '',
      currentPreviewDraftKey: previewDraftKey
    })
    setPreviewDraftKey((currentKey) => {
      const nextKey = currentKey === draft.key ? null : draft.key
      logger.info('[PinnedDraftPannel] update preview draft key', {
        currentKey,
        nextKey,
        draftKey: draft.key
      })
      if (nextKey) {
        if (!isSingleDraft) {
          setIsCollapsed(false)
          onToggle?.(false)
        }
      }
      return nextKey
    })
  }

  if (displayDrafts.length === 0) {
    return null
  }

  return (
    <div className="pinned-draft-panel">
      <div className="pinned-draft-panel__body">
        <div
          className="pinned-draft-panel__header"
          onClick={handleToggle}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleToggle()
            }
          }}>
          <div className="pinned-draft-panel__header-left">
            {isCollapsedView ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {headerStatus ? <DraftStatusIcon status={shouldShowPreviewLoading ? 'in_progress' : headerStatus} /> : null}
            <Text className="pinned-draft-panel__header-title">{headerTitle || emptyText}</Text>
          </div>
          <div className="pinned-draft-panel__header-right">
            {isPreviewMode ? (
              <>
                <button
                  type="button"
                  className="pinned-draft-panel__action is-active"
                  onClick={handleBackToList}
                  aria-label="返回草稿列表">
                  <Eye size={14} />
                </button>
                {previewDraft ? (
                  <button
                    type="button"
                    className="pinned-draft-panel__action"
                    onClick={handleDownloadItem(previewDraft)}
                    aria-label={`导出草稿 ${previewDraft.title}`}>
                    <SquareArrowOutUpRight size={14} />
                  </button>
                ) : null}
              </>
            ) : isSingleDraft && activeDraft ? (
              <button
                type="button"
                className="pinned-draft-panel__action"
                onClick={handlePreviewItem(activeDraft)}
                aria-label={`查看草稿 ${activeDraft.title} 的轨道`}>
                <Eye size={14} />
              </button>
            ) : null}
            {!isPreviewMode && isSingleDraft && activeDraft ? (
              <button
                type="button"
                className="pinned-draft-panel__action"
                onClick={handleDownloadItem(activeDraft)}
                aria-label={`导出草稿 ${activeDraft.title}`}>
                <SquareArrowOutUpRight size={14} />
              </button>
            ) : !isPreviewMode && displayDrafts.length > 0 ? (
              <button
                type="button"
                className="pinned-draft-panel__action"
                onClick={handleDownloadAll}
                aria-label="导出全部草稿">
                <SquareArrowOutUpRight size={14} />
              </button>
            ) : null}
            {!isPreviewMode ? (
              <button
                type="button"
                className="pinned-draft-panel__close"
                onClick={handleClose}
                aria-label="关闭草稿面板">
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        {isPreviewMode ? (
          <div className="pinned-draft-panel__preview">
            {isPreviewLoading ? (
              <div className="pinned-draft-panel__preview-state">正在加载轨道预览...</div>
            ) : previewErrorKey === previewDraft?.key ? (
              <div className="pinned-draft-panel__preview-state is-error">
                {previewErrorMessage || '轨道预览加载失败'}
              </div>
            ) : previewDraft?.trackPreview ? (
              <PinnedDraftTrackView
                draftTitle={previewDraft.title}
                preview={previewDraft.trackPreview}
              />
            ) : (
              <div className="pinned-draft-panel__preview-state">暂无可预览轨道</div>
            )}
          </div>
        ) : !isSingleDraft ? (
          <div className={`pinned-draft-panel__list ${isCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
            {displayDrafts.map((draft) => (
              <div
                key={draft.key}
                className={`pinned-draft-panel__item pinned-draft-panel__item--${draft.statusTone} ${
                  draft.status === 'completed' ? 'is-completed' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => openPreviewItem(draft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openPreviewItem(draft)
                  }
                }}>
                <div className="pinned-draft-panel__item-icon">
                    <DraftStatusIcon status={draft.status} />
                </div>
                <div className="pinned-draft-panel__item-main">
                  <div className="pinned-draft-panel__item-top">
                    <Text className="pinned-draft-panel__item-title">{draft.title}</Text>
                    <button
                      type="button"
                      className={`pinned-draft-panel__item-action ${previewDraftKey === draft.key ? 'is-active' : ''}`}
                      onClick={handlePreviewItem(draft)}
                      aria-label={`查看草稿 ${draft.title} 的轨道`}>
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      className="pinned-draft-panel__item-action"
                      onClick={handleDownloadItem(draft)}
                      aria-label={`导出草稿 ${draft.title}`}>
                      <SquareArrowOutUpRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
