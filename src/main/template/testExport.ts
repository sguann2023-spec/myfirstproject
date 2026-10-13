import { compileEditorDocument, type EditorPayload } from './editorModel'

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
export function prepareExecutionWorkflow(workflow: ReturnType<typeof compileEditorDocument>['workflow']) {
  const result = structuredClone(workflow)
  const inputs: Record<string, unknown> = { ...result.inputs }
  let index = 0
  for (const step of result.script) {
    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value !== 'string') continue
      const variable = `template_literal_${index++}`
      inputs[variable] = value
      ;(step.params as Record<string, unknown>)[key] = `\${${variable}}`
    }
  }
  return { ...result, inputs }
}

export class TemplateTestExporter {
  private pending = new Set<number>()
  private completedExecution = new Map<number, { fingerprint: string; draftId: string; warnings: string[] }>()

  constructor(private dependencies: Dependencies) {}

  forget(owner: number) { this.completedExecution.delete(owner) }

  async run(owner: number, payload: EditorPayload) {
    if (this.pending.has(owner)) throw new Error('测试导出正在进行，请勿重复提交')
    this.pending.add(owner)
    try {
      const compiled = compileEditorDocument(payload)
      if (!compiled.workflow.script.length) throw new Error('模版没有可见内容，不能测试导出')
      const fingerprint = JSON.stringify(compiled.workflow)
      let execution = this.completedExecution.get(owner)
      if (!execution || execution.fingerprint !== fingerprint) {
        this.completedExecution.delete(owner)
        const response = readResult(await this.dependencies.execute(prepareExecutionWorkflow(compiled.workflow)), 'Workflow 执行')
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
