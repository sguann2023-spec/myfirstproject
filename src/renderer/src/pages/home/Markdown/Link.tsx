import { parseJSON } from '@renderer/utils/json'
import { findCitationInChildren } from '@renderer/utils/markdown'
import { isEmpty, omit } from 'lodash'
import React, { useMemo } from 'react'
import type { Node } from 'unist'
import { ChatTaskContext } from '../../../../../components/Chat/ChatShell/ChatTaskContext'
import { parseSubtitleStoryboardLink } from '../../../../../shared/subtitleRecognition'

import CitationTooltip, { CitationSchema } from './CitationTooltip'
import Hyperlink from './Hyperlink'
import { openMarkdownFileLink } from '../../../../../shared/markdownFileLinks'

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  node?: Omit<Node, 'type'>
}

const Link: React.FC<LinkProps> = (props) => {
  const { openSubtitleStoryboard, openWebUrl, openFilePath } = React.useContext(ChatTaskContext)
  const citationData = useMemo(() => {
    const raw = parseJSON(findCitationInChildren(props.children))
    const parsed = CitationSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [props.children])

  const storyboardPath = parseSubtitleStoryboardLink(props.href)
  if (storyboardPath) {
    return <a
      {...omit(props, ['node', 'citationData'])}
      target={undefined}
      aria-disabled={!openSubtitleStoryboard}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openSubtitleStoryboard?.(storyboardPath)
      }}
    />
  }

  // 处理内部链接
  if (props.href?.startsWith('#')) {
    return <span className="link">{props.children}</span>
  }

  // 包含<sup>标签表示是一个引用链接
  const isCitation = React.Children.toArray(props.children).some((child) => {
    if (typeof child === 'object' && 'type' in child) {
      return child.type === 'sup'
    }
    return false
  })
  const isWebUrl = (() => {
    try {
      const protocol = new URL(props.href || '').protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  })()
  const handleOpenInPreview = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (isWebUrl && typeof openWebUrl === 'function') {
      openWebUrl(props.href || '', props.title || '')
      return
    }
    if (openMarkdownFileLink(props.href || '', openFilePath)) return
    if (props.href) {
      window.open(props.href, '_blank', 'noopener,noreferrer')
    }
  }

  // 如果是引用链接并且有引用数据，则使用CitationTooltip
  if (isCitation && citationData) {
    return (
      <CitationTooltip citation={citationData}>
        <a
          {...omit(props, ['node', 'citationData'])}
          href={isEmpty(props.href) ? undefined : props.href}
          target={isWebUrl ? undefined : '_blank'}
          rel="noreferrer"
          onClick={handleOpenInPreview}
        />
      </CitationTooltip>
    )
  }

  // 普通链接
  return (
    <Hyperlink href={props.href || ''}>
      <a
        {...omit(props, ['node', 'citationData'])}
        target={isWebUrl ? undefined : '_blank'}
        rel="noreferrer"
        onClick={handleOpenInPreview}
      />
    </Hyperlink>
  )
}

export default Link
