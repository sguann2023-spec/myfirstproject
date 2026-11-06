import { css, keyframes } from 'styled-components'

// 文字颜色扫光动画：一道亮光周期性从文字上掠过，表示“正在执行”
export const toolShimmerSweep = keyframes`
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
`

/**
 * “正在执行”的文字扫光效果，附加到工具调用行头部元素上。
 * 默认以 #000 显示文字，仅在文字叶节点上裁剪渐变，避免跨层容器裁剪导致文字透明消失。
 */
export const toolRunningShimmerCss = css`
  color: #000;
  -webkit-text-fill-color: #000;

  span:not(:has(*)):not([class*='billing']):not([class*='billing'] *) {
    color: #000;
    background-image: linear-gradient(100deg, #000 30%, #888 50%, #000 70%);
    background-size: 200% 100%;
    background-repeat: repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: ${toolShimmerSweep} 2s linear infinite;
  }

  /* 积分徽标等带自身配色的元素不参与扫光，避免文字透明后与自身底色混叠不可读 */
  img,
  svg,
  button,
  a,
  [class*='billing'] {
    -webkit-text-fill-color: initial;
  }
`

/**
 * 工具执行完成后的置灰效果：整行文字（含图标，走 currentColor）统一变灰 #888，
 * 积分徽标保留自身配色。
 */
export const toolCompletedDimCss = css`
  color: #888;

  span:not([class*='billing']),
  svg {
    color: #888;
  }
`

/**
 * 工具行不显示任何鼠标状态（pointer/not-allowed/text 等），一律默认箭头。
 * 附加到折叠卡片头部元素上；展开内容区（链接、按钮等）不受影响。
 */
export const toolHeaderCursorDefaultCss = css`
  cursor: default !important;

  * {
    cursor: default !important;
  }
`
