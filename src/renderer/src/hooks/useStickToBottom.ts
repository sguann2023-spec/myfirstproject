import { type RefObject, useCallback, useEffect, useRef } from 'react'

/** 距底部不超过该阈值(px)时视为“在底部” */
const BOTTOM_THRESHOLD = 40

/** 距顶部不超过该阈值(px)时视为“在顶部”(该区域会触发向上加载更多历史消息) */
const TOP_THRESHOLD = 50

/**
 * 聊天消息列表(column-reverse 布局)的跟随滚动控制。
 *
 * column-reverse 容器中 scrollTop === 0 表示底部, 向上滚动为负值。浏览器对这类容器
 * 没有可靠的滚动锚定: 流式输出导致底部内容增长时, 视口会被持续“推”向底部, 表现为
 * 用户向上翻阅历史时被自动滚回底部。
 *
 * 本 hook 的策略:
 * - 用户在底部: 不干预, 保持吸附底部
 * - 用户不在底部: 仅在消息生成期间, 对底部内容的高度增量做反向补偿, 保持阅读位置不动
 * - 用户在顶部附近: 不补偿(该区域触发向上加载历史, 增长发生在视口上方)
 *
 * @param containerRef 滚动容器 ref
 * @param isStreaming 是否有消息正在生成
 * @param resetKey 滚动容器可能被重新挂载的 key(如 assistant/session 切换), 变化时重新绑定监听
 */
export default function useStickToBottom(
  containerRef: RefObject<HTMLDivElement | null>,
  isStreaming: boolean,
  resetKey?: string
) {
  const isAtBottomRef = useRef(true)
  const isNearTopRef = useRef(false)
  const isStreamingRef = useRef(isStreaming)
  const prevContentHeightRef = useRef<number | null>(null)

  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  /** column-reverse 布局: scrollTop === 0 为底部, 向上滚动为负值, 顶部为 -(scrollHeight - clientHeight) */
  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (container) {
      isAtBottomRef.current = container.scrollTop >= -BOTTOM_THRESHOLD
      isNearTopRef.current = container.scrollTop <= -(container.scrollHeight - container.clientHeight) + TOP_THRESHOLD
    }
  }, [containerRef])

  useEffect(() => {
    // 消息内容是滚动容器的第一个子元素(NarrowLayout), 观察其高度变化
    const container = containerRef.current
    const content = container?.firstElementChild
    if (!container || !content) return

    // 容器(重新)挂载后内容整体变化, 重置基线不做补偿
    prevContentHeightRef.current = null

    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (!el) return

      const contentHeight = el.scrollHeight
      const prevHeight = prevContentHeightRef.current
      prevContentHeightRef.current = contentHeight
      if (prevHeight === null || contentHeight === prevHeight) return

      // 顶部区域在加载更多历史消息(增长在视口上方), 不在底部且生成中才补偿
      if (isNearTopRef.current || isAtBottomRef.current || !isStreamingRef.current) return

      // 不在底部: 底部新内容把旧内容向上推, 反向补偿相同增量, 让阅读位置保持不动
      el.scrollTop -= contentHeight - prevHeight
    })

    observer.observe(content)
    return () => observer.disconnect()
  }, [containerRef, resetKey])

  return { handleScroll }
}
