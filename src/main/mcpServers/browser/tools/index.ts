export { clickToolDefinition, handleClick } from './click'
export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { focusToolDefinition, handleFocus } from './focus'
export { handleHover, hoverToolDefinition } from './hover'
export { handleInspect, inspectToolDefinition } from './inspect'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handlePress, pressToolDefinition } from './press'
export { handleReload, ReloadSchema, reloadToolDefinition } from './reload'
export { handleReset, resetToolDefinition } from './reset'
export { handleScreenshot, screenshotToolDefinition } from './screenshot'
export { handleScroll, scrollToolDefinition } from './scroll'
export { handleSnapshot, snapshotToolDefinition } from './snapshot'
export {
  closeTabToolDefinition,
  handleCloseTab,
  handleListTabs,
  handleSwitchTab,
  listTabsToolDefinition,
  switchTabToolDefinition
} from './tabs'
export { handleType, typeToolDefinition } from './type'
export { handleWaitFor, waitForToolDefinition } from './wait'

import type { CdpBrowserController } from '../controller'
import { clickToolDefinition, handleClick } from './click'
import { executeToolDefinition, handleExecute } from './execute'
import { focusToolDefinition, handleFocus } from './focus'
import { handleHover, hoverToolDefinition } from './hover'
import { handleInspect, inspectToolDefinition } from './inspect'
import { handleOpen, openToolDefinition } from './open'
import { handlePress, pressToolDefinition } from './press'
import { handleReload, reloadToolDefinition } from './reload'
import { handleReset, resetToolDefinition } from './reset'
import { handleScreenshot, screenshotToolDefinition } from './screenshot'
import { handleScroll, scrollToolDefinition } from './scroll'
import { handleSnapshot, snapshotToolDefinition } from './snapshot'
import {
  closeTabToolDefinition,
  handleCloseTab,
  handleListTabs,
  handleSwitchTab,
  listTabsToolDefinition,
  switchTabToolDefinition
} from './tabs'
import { handleType, typeToolDefinition } from './type'
import type { ToolContent } from './utils'
import { handleWaitFor, waitForToolDefinition } from './wait'

export const toolDefinitions = [
  openToolDefinition,
  clickToolDefinition,
  typeToolDefinition,
  pressToolDefinition,
  scrollToolDefinition,
  focusToolDefinition,
  hoverToolDefinition,
  waitForToolDefinition,
  inspectToolDefinition,
  executeToolDefinition,
  reloadToolDefinition,
  screenshotToolDefinition,
  snapshotToolDefinition,
  listTabsToolDefinition,
  switchTabToolDefinition,
  closeTabToolDefinition,
  resetToolDefinition
]

export const toolHandlers: Record<
  string,
  (controller: CdpBrowserController, args: unknown) => Promise<{ content: ToolContent[]; isError: boolean }>
> = {
  open: handleOpen,
  click: handleClick,
  type: handleType,
  press: handlePress,
  scroll: handleScroll,
  focus: handleFocus,
  hover: handleHover,
  wait_for: handleWaitFor,
  inspect: handleInspect,
  execute: handleExecute,
  reload: handleReload,
  screenshot: handleScreenshot,
  snapshot: handleSnapshot,
  list_tabs: handleListTabs,
  switch_tab: handleSwitchTab,
  close_tab: handleCloseTab,
  reset: handleReset
}
