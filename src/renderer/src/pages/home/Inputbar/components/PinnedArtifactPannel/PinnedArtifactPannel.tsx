import { Typography } from 'antd'

import './index.css'

const { Text } = Typography

export interface PinnedArtifactPanelItem {
  id?: string
  draftId?: string
  [key: string]: unknown
}

interface PinnedArtifactPanelProps {
  drafts?: PinnedArtifactPanelItem[]
  audios?: PinnedArtifactPanelItem[]
  videos?: PinnedArtifactPanelItem[]
  documents?: PinnedArtifactPanelItem[]
  images?: PinnedArtifactPanelItem[]
  onClick?: () => void
}

// 消息区右上角的产物概要胶囊：按类别展示草稿、图片与音频数量，
// 点击后由宿主打开 ArtifactPreview 预览窗格。
export default function PinnedArtifactPannel({ drafts = [], audios = [], images = [], videos = [], documents = [], onClick }: PinnedArtifactPanelProps) {
  const summary = [drafts.length ? `${drafts.length} 草稿` : '', videos.length ? `${videos.length} 视频` : '', images.length ? `${images.length} 图片` : '', audios.length ? `${audios.length} 音频` : '', documents.length ? `${documents.length} 文档` : '']
    .filter(Boolean)
    .join(' ')
  if (!summary) {
    return null
  }

  return (
    <div
      className="pinned-draft-panel"
      role="button"
      tabIndex={0}
      aria-label={`查看生成的 ${summary}`}
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
            {drafts.length > 0 && <>
              <span className="pinned-draft-panel__header-count">{` ${drafts.length} `}</span>
              {'草稿'}
            </>}
            {videos.length > 0 && <>
              <span className="pinned-draft-panel__header-count">{` ${videos.length} `}</span>
              {'视频'}
            </>}
            {images.length > 0 && <>
              <span className="pinned-draft-panel__header-count">{` ${images.length} `}</span>
              {'图片'}
            </>}
            {audios.length > 0 && <>
              <span className="pinned-draft-panel__header-count">{` ${audios.length} `}</span>
              {'音频'}
            </>}
            {documents.length > 0 && <><span className="pinned-draft-panel__header-count">{` ${documents.length} `}</span>{'文档'}</>}
          </Text>
        </div>
      </div>
    </div>
  )
}
