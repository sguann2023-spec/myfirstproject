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
  loopCount?: string | number
  loop?: WorkflowStep[]
}

export interface TemplateWorkflow extends Record<string, unknown> {
  width: number
  height: number
  inputs: Record<string, unknown>
  script: WorkflowStep[]
}

export interface WorkflowInputBinding {
  key: string
  variable: string
  encoding: 'identity' | 'json'
  runtime: boolean
}
