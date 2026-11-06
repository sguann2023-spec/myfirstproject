import { Typography } from 'antd'

import './index.css'

const { Text } = Typography

export interface PinnedDraftPanelItem {
  id?: string
  draftId?: string
  [key: string]: unknown
}

interface PinnedDraftPanelProps {
  drafts?: PinnedDraftPanelItem[]
  onClick?: () => void
}

// 消息区右上角的草稿概要胶囊：仅展示「生成 xx 草稿」，
// 点击后由宿主打开 ArtifactPreview 预览窗格查看草稿列表。
export default function PinnedDraftPannel({ drafts = [], onClick }: PinnedDraftPanelProps) {
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return null
  }

  return (
    <div
      className="pinned-draft-panel"
      role="button"
      tabIndex={0}
      aria-label={`查看生成的 ${drafts.length} 个草稿`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.()
        }
      }}>
      <div className="pinned-draft-panel__body">
        <div className="pinned-draft-panel__header">
          <Text className="pinned-draft-panel__header-title">
            {'生成'}
            <span className="pinned-draft-panel__header-count">{` ${drafts.length} `}</span>
            {'草稿'}
          </Text>
        </div>
      </div>
    </div>
  )
}
