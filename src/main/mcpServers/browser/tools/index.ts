export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReload, ReloadSchema, reloadToolDefinition } from './reload'
export { handleReset, resetToolDefinition } from './reset'
export { handleScreenshot, screenshotToolDefinition } from './screenshot'
export { handleSnapshot, snapshotToolDefinition } from './snapshot'
export {
  closeTabToolDefinition,
  handleCloseTab,
  handleListTabs,
  handleSwitchTab,
  listTabsToolDefinition,
  switchTabToolDefinition
} from './tabs'

import type { CdpBrowserController } from '../controller'
import { executeToolDefinition, handleExecute } from './execute'
import { handleOpen, openToolDefinition } from './open'
import { handleReload, reloadToolDefinition } from './reload'
import { handleReset, resetToolDefinition } from './reset'
import { handleScreenshot, screenshotToolDefinition } from './screenshot'
import { handleSnapshot, snapshotToolDefinition } from './snapshot'
import {
  closeTabToolDefinition,
  handleCloseTab,
  handleListTabs,
  handleSwitchTab,
  listTabsToolDefinition,
  switchTabToolDefinition
} from './tabs'
import type { ToolContent } from './utils'

export const toolDefinitions = [
  openToolDefinition,
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
  execute: handleExecute,
  reload: handleReload,
  screenshot: handleScreenshot,
  snapshot: handleSnapshot,
  list_tabs: handleListTabs,
  switch_tab: handleSwitchTab,
  close_tab: handleCloseTab,
  reset: handleReset
}
