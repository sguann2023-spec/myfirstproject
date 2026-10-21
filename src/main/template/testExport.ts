import { compileEditorDocument, type EditorPayload } from './editorModel'
import type { TemplateWorkflow, WorkflowStep } from './workflowTypes'
import { encodeWorkflowInputNames } from './inputNames'

type ToolResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> }
type Dependencies = {
  execute: (workflow: Record<string, unknown>) => Promise<ToolResult>
  exportDraft: (args: Record<string, unknown>) => Promise<ToolResult>
}

function readResult(result: ToolResult, stage: string): Record<string, any> {
  const text = result.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n') ?? ''
  if (result.isError) throw new Error(`${stage}失败：${text}`)
  let data: Record<string, any>
  try { data = JSON.parse(text) } catch { throw new Error(`${stage}返回了无法解析的结果：${text}`) }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${stage}返回格式不正确`)
  if (data.success === false || data.error) throw new Error(`${stage}失败：${data.error || data.message || '未知错误'}`)
  return data
}

// Use input-variable references at the execution boundary so literal text is not evaluated as arithmetic.
export function prepareExecutionWorkflow(workflow: TemplateWorkflow): TemplateWorkflow {
  const result = structuredClone(workflow)
  const inputs: Record<string, unknown> = { ...result.inputs }
  const variables = new Set(Object.keys(inputs))
  function collect(steps: WorkflowStep[]) {
    for (const step of steps) {
      if (step.type === 'set_var' && step.name) variables.add(step.name)
      if (step.type === 'for') {
        variables.add('item')
        variables.add('index')
      }
      collect(step.then ?? [])
      collect(step.else ?? [])
      collect(step.loop ?? [])
    }
  }
  collect(result.script)
  let index = 0
  function protect(steps: WorkflowStep[]) {
    for (const step of steps) {
      for (const [key, value] of Object.entries(step.params ?? {})) {
        if (typeof value !== 'string') continue
        const refs = [...value.matchAll(/\$\{([^}]+)\}/g)]
        if (refs.length && refs.every((match) => variables.has(match[1].split(/[.\[]/)[0]))) continue
        let variable = `template_literal_${index++}`
        while (variables.has(variable)) variable = `template_literal_${index++}`
        inputs[variable] = value
        variables.add(variable)
        step.params![key] = `\${${variable}}`
      }
      protect(step.then ?? [])
      protect(step.else ?? [])
      protect(step.loop ?? [])
    }
  }
  protect(result.script)
  return encodeWorkflowInputNames({ ...result, inputs })
}

// 编辑器 Workflow 视图允许直接改 JSON，测试导出时用它替代重新编译的结果。
export function parseWorkflowOverride(workflowJson: string): TemplateWorkflow {
  let parsed: unknown
  try { parsed = JSON.parse(workflowJson) } catch { throw new Error('Workflow 内容不是合法 JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Workflow 内容必须是 JSON 对象')
  const workflow = parsed as TemplateWorkflow
  if (!Array.isArray(workflow.script)) throw new Error('Workflow 缺少 script 数组')
  if (workflow.inputs !== undefined && (typeof workflow.inputs !== 'object' || workflow.inputs === null ||
    Array.isArray(workflow.inputs))) throw new Error('Workflow inputs 必须是对象')
  return { ...workflow, inputs: workflow.inputs ?? {} }
}

export class TemplateTestExporter {
  private pending = new Set<number>()
  private completedExecution = new Map<number, { fingerprint: string; draftId: string; warnings: string[] }>()

  constructor(private dependencies: Dependencies) {}

  forget(owner: number) { this.completedExecution.delete(owner) }

  async run(owner: number, payload: EditorPayload, workflowJson?: string) {
    if (this.pending.has(owner)) throw new Error('测试导出正在进行，请勿重复提交')
    this.pending.add(owner)
    try {
      const compiled = compileEditorDocument(payload)
      if (!compiled.timeline.some((item) => item.visible && item.type !== 'composition')) {
        throw new Error('模版没有可见内容，不能测试导出')
      }
      const workflow = workflowJson === undefined ? compiled.workflow : parseWorkflowOverride(workflowJson)
      const fingerprint = JSON.stringify(workflow)
      let execution = this.completedExecution.get(owner)
      if (!execution || execution.fingerprint !== fingerprint) {
        this.completedExecution.delete(owner)
        const response = readResult(await this.dependencies.execute(prepareExecutionWorkflow(workflow)), 'Workflow 执行')
        let output = response.output
        if (typeof output === 'string') {
          try { output = JSON.parse(output) } catch { output = null }
        }
        const draftId = output?.draft_id ?? response.draft_id
        if (typeof draftId !== 'string' || !draftId.trim()) throw new Error('执行结果缺少草稿 ID，未提交导出')
        execution = { fingerprint, draftId: draftId.trim(), warnings: compiled.warnings }
        this.completedExecution.set(owner, execution)
      }
      try {
        const exported = readResult(await this.dependencies.exportDraft({
          draft_id: execution.draftId, draft_name: `模版测试-${execution.draftId}`
        }), '草稿导出')
        if (!(typeof exported.accepted === 'number' && exported.accepted > 0)) throw new Error('草稿导出未确认入队')
      } catch (error) {
        throw new Error(`草稿 ${execution.draftId} 已生成，但导出入队失败。再次点击将只重试导出：${error instanceof Error ? error.message : error}`)
      }
      this.completedExecution.delete(owner)
      return { draftId: execution.draftId, status: 'queued', warnings: execution.warnings }
    } finally {
      this.pending.delete(owner)
    }
  }
}
