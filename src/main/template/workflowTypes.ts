export interface WorkflowStep {
  type: 'action' | 'set_var' | 'if' | 'for'
  id: string
  index: number
  action_type?: string
  params?: Record<string, unknown>
  name?: string
  value?: string | number
  condition?: string
  then?: WorkflowStep[]
  else?: WorkflowStep[]
  in?: string
  loopCount?: string | number
  loop?: WorkflowStep[]
  loopItem?: string
}

export interface TemplateWorkflow extends Record<string, unknown> {
  width: number
  height: number
  inputs: Record<string, unknown>
  input_labels?: Array<{ path: string[]; label: string }>
  script: WorkflowStep[]
}

export interface WorkflowInputBinding {
  key: string
  variable: string
  // Path within the root input; "*" denotes an item in a containing batch array.
  inputPath?: string[]
  encoding: 'identity' | 'json' | 'text'
  runtime: boolean
}
