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
}

// 消息区右上角的草稿概要胶囊：仅展示「生成 xx 个草稿」，
// 不再提供展开列表 / 轨道预览 / 导出 / 关闭等入口。
export default function PinnedDraftPannel({ drafts = [] }: PinnedDraftPanelProps) {
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return null
  }

  return (
    <div className="pinned-draft-panel">
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
