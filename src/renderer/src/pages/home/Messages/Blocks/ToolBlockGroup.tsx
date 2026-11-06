import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { MCPToolResponseStatus } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse, type CollapseProps } from 'antd'
import { ChevronDown } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { css } from 'styled-components'
import styled from 'styled-components'

import MessageTools from '../Tools/MessageTools'
import { getAgentToolIcon } from '../Tools/ToolHeader'
import { useTranslation } from 'react-i18next'
import { getToolDisplayName } from '../Tools/shared/toolDisplay'
import { isDraftRenderToolName } from '../Tools/MessageAgentTools/draftRenderTool'
import { DraftRenderBillingBadge } from '../Tools/MessageAgentTools/DraftRenderToolRenderer'
import { isMediaGenerationBillingToolName, MediaGenBillingBadge } from '../Tools/MessageAgentTools/billingTools'
import { sumMediaGenerationBillingSummaries } from '../Tools/MessageAgentTools/mediaGenerationBilling'
import { toolCompletedDimCss, toolHeaderCursorDefaultCss, toolRunningShimmerCss } from '../Tools/shared/toolShimmer'
import BlockErrorFallback from './BlockErrorFallback'

import { getToolGroupSummary } from './toolGrouping'

// ============ Styled Components ============

const Container = styled.div<{ $running?: boolean; $completed?: boolean }>`
  width: fit-content;
  max-width: 100%;

  /* Only style the direct group collapse, not nested tool collapses */
  > .ant-collapse {
    background: transparent;
    border: none;

    > .ant-collapse-item {
      border: none !important;

      > .ant-collapse-header {
        padding: 4px 0 !important;
        background: transparent;
        border: none;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        ${toolHeaderCursorDefaultCss}
      }

      > .ant-collapse-content {
        border: none;
        background: transparent;

        > .ant-collapse-content-box {
          padding: 4px 0 0 12px !important;
          margin-left: 5px;
          border-left: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
      }
    }
  }

  /* 正在执行的工具组：头部统一用斜方向扫光表示 */
  ${(props) =>
    props.$running
      ? css`
          > .ant-collapse > .ant-collapse-item > .ant-collapse-header {
            ${toolRunningShimmerCss}
          }
        `
      : ''}

  /* 全部执行完成的工具组：头部置灰 */
  ${(props) =>
    props.$completed
      ? css`
          > .ant-collapse > .ant-collapse-item > .ant-collapse-header {
            ${toolCompletedDimCss}
          }
        `
      : ''}
`

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;

  .tool-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    color: inherit;
    line-height: 0;

    svg { display: block; }
  }

  .tool-count {
    color: inherit;
  }
`

const ScrollableToolList = styled.div`
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ToolItem = styled.div``

// ============ Types & Helpers ============

interface Props {
  blocks: ToolMessageBlock[]
}

function isCompletedStatus(status: MCPToolResponseStatus | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

interface GroupHeaderContentProps {
  blocks: ToolMessageBlock[]
  allCompleted: boolean
  expanded: boolean
}

const GroupHeaderContent = React.memo(({ blocks, expanded }: GroupHeaderContentProps) => {
  const { t } = useTranslation()
  const tool = blocks[0]?.metadata?.rawMcpToolResponse?.tool
  const toolName = tool?.name || blocks[0]?.toolName || ''
  const displayName = tool ? getToolDisplayName(tool, t) : toolName

  // One combined badge summing the media-generation billing of every billed
  // child (e.g. 联网搜索PRO children each showing ✦ 2.00 → header shows ✦ 4.00).
  // Draft-render blocks keep their own per-block badges below.
  const billedPointsSummary = useMemo(() => {
    const billedOutputs = blocks.flatMap((block) => {
      const result = block.metadata?.rawMcpToolResponse
      const childToolName = result?.tool?.name || ''
      const childServerName = (result?.tool as { serverName?: string } | undefined)?.serverName
      if (!childToolName || isDraftRenderToolName(childToolName, childServerName)) return []
      if (!isMediaGenerationBillingToolName(childToolName, childServerName)) return []
      return [{ response: result?.response, responseRaw: result?.responseRaw }]
    })
    if (billedOutputs.length === 0) return null
    const summary = sumMediaGenerationBillingSummaries(billedOutputs)
    return summary && summary.totalConsumedPoints > 0 ? summary : null
  }, [blocks])

  return (
    <GroupHeader>
      <span className="tool-icon">{getAgentToolIcon(toolName)}</span>
      <span className="tool-count">
        <span style={{ fontSize: 14, fontWeight: 400 }}>{getToolGroupSummary(blocks, displayName, t)}</span>
        {expanded && blocks.length > 1 && (
          <ChevronDown size={12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
        )}
      </span>
      {blocks.map((block) => {
        const result = block.metadata?.rawMcpToolResponse
        const serverName = (result?.tool as { serverName?: string } | undefined)?.serverName
        return isDraftRenderToolName(result?.tool?.name || '', serverName) ? (
          <DraftRenderBillingBadge key={block.id} output={{ response: result?.response, responseRaw: result?.responseRaw }} />
        ) : null
      })}
      {billedPointsSummary && (
        <MediaGenBillingBadge
          centered
          displayText={billedPointsSummary.totalConsumedPoints.toFixed(2)}
          title={`总消耗 ${billedPointsSummary.totalConsumedPoints.toFixed(2)} 点`}
        />
      )}
    </GroupHeader>
  )
})
GroupHeaderContent.displayName = 'GroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolListContentProps {
  blocks: ToolMessageBlock[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const ToolListContent = React.memo(({ blocks, scrollRef }: ToolListContentProps) => (
  <ScrollableToolList ref={scrollRef}>
    {blocks.map((block) => {
      return (
        <ToolItem key={block.id} data-block-id={block.id}>
          <ErrorBoundary fallbackComponent={BlockErrorFallback}>
            <MessageTools block={block} />
          </ErrorBoundary>
        </ToolItem>
      )
    })}
  </ScrollableToolList>
))
ToolListContent.displayName = 'ToolListContent'

// ============ Main Component ============

const ToolBlockGroup: React.FC<Props> = ({ blocks }) => {
  const [activeKey, setActiveKey] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const allCompleted = useMemo(() => {
    return blocks.every((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return isCompletedStatus(status)
    })
  }, [blocks])

  // 组内任意子任务未完成（执行中/待确认）时，聚合标题显示扫光
  const groupRunning = !allCompleted

  const currentRunningBlock = useMemo(() => {
    return blocks.find((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return !isCompletedStatus(status)
    })
  }, [blocks])

  useEffect(() => {
    if (activeKey.includes('tool-group') && currentRunningBlock && scrollRef.current) {
      const element = scrollRef.current.querySelector(`[data-block-id="${currentRunningBlock.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeKey, currentRunningBlock])

  const handleChange = (keys: string | string[]) => {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    setActiveKey(keyArray)
  }

  const items: CollapseProps['items'] = useMemo(() => {
    return [
      {
        key: 'tool-group',
        showArrow: false,
        label: <GroupHeaderContent blocks={blocks} allCompleted={allCompleted} expanded={activeKey.includes('tool-group')} />,
        children: <ToolListContent blocks={blocks} scrollRef={scrollRef} />
      }
    ]
  }, [blocks, allCompleted, activeKey])

  return (
    <Container $running={groupRunning} $completed={allCompleted}>
      <Collapse
        ghost
        size="small"
        activeKey={activeKey}
        onChange={handleChange}
        items={items}
      />
    </Container>
  )
}

export default React.memo(ToolBlockGroup)
