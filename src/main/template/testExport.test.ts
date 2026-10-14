import { describe, expect, it, vi } from 'vitest'
import { editorInitialTemplate } from './editorModel'
import { prepareExecutionWorkflow, TemplateTestExporter } from './testExport'
import { createEditorPreset } from './editorPresets'
import { compileDraftTemplate } from './draftTemplate'
import { workflowActions } from './workflowTestUtils'

const payload = () => ({ templateJson: JSON.stringify(editorInitialTemplate), configJson: '{}' })
const result = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })
const dependencies = () => ({
  execute: vi.fn().mockResolvedValue(result({ success: true, output: { draft_id: 'draft-1' } })),
  exportDraft: vi.fn().mockResolvedValue(result({ accepted: 1 }))
})

describe('测试执行与草稿导出', () => {
  it('执行当前文档后导出返回的草稿，保留编译警告', async () => {
    const deps = dependencies()
    const output = await new TemplateTestExporter(deps).run(1, payload())
    expect(output).toMatchObject({ draftId: 'draft-1', status: 'queued' })
    expect(output.warnings.length).toBeGreaterThan(0)
    expect(deps.exportDraft).toHaveBeenCalledWith({ draft_id: 'draft-1', draft_name: '模版测试-draft-1' })
    expect(deps.execute.mock.invocationCallOrder[0]).toBeLessThan(deps.exportDraft.mock.invocationCallOrder[0])
  })

  it('执行适配使用变量保护普通字符串，不修改界面 workflow', () => {
    const workflow = { width: 720, height: 1280, inputs: {}, script: [{
      type: 'action' as const, id: 'text', index: 0, action_type: 'add_text' as const,
      params: { text: '1 + 2 ${name}', start: 0, end: 5, width: 720, height: 1280,
        track_name: 'template_text', relative_index: 0 }
    }] }
    const prepared = prepareExecutionWorkflow(workflow)
    expect(prepared.inputs.template_literal_0).toBe('1 + 2 ${name}')
    expect(prepared.script[0].params.text).toBe('${template_literal_0}')
    expect(workflow.script[0].params.text).toBe('1 + 2 ${name}')
  })

  it('动态输入完整传到执行端，重复适配不把表达式包成字面量', async () => {
    const template = createEditorPreset('sentence-image')
    const workflow = compileDraftTemplate(template).workflow
    const prepared = prepareExecutionWorkflow(workflow)
    expect(prepareExecutionWorkflow(prepared)).toEqual(prepared)
    const deps = dependencies()
    await new TemplateTestExporter(deps).run(1, { templateJson: JSON.stringify(template) })
    const executed = deps.execute.mock.calls[0][0]
    expect(executed.inputs.input_text_material_1_content).toEqual({ text: '清晨，阳光洒进安静的房间。' })
    expect(workflowActions(executed).find(({ id }) => id === 'text-1')!.params.text)
      .toBe('${input_text_material_1_content.text}')
  })

  it('执行失败或缺少草稿 ID 时不提交导出', async () => {
    for (const response of [{ success: false, error: 'failed' }, { success: true, output: {} }]) {
      const deps = dependencies()
      deps.execute.mockResolvedValue(result(response))
      await expect(new TemplateTestExporter(deps).run(1, payload())).rejects.toThrow()
      expect(deps.exportDraft).not.toHaveBeenCalled()
    }
  })

  it('导出失败后重试只导出原草稿，成功后可执行新的测试', async () => {
    const deps = dependencies()
    deps.exportDraft.mockRejectedValueOnce(new Error('main window unavailable'))
    const exporter = new TemplateTestExporter(deps)
    await expect(exporter.run(1, payload())).rejects.toThrow('draft-1')
    await exporter.run(1, payload())
    expect(deps.execute).toHaveBeenCalledTimes(1)
    await exporter.run(1, payload())
    expect(deps.execute).toHaveBeenCalledTimes(2)
  })

  it('拒绝同一窗口并发提交', async () => {
    const deps = dependencies()
    let resolve!: (value: ReturnType<typeof result>) => void
    deps.execute.mockImplementation(() => new Promise((done) => { resolve = done }))
    const exporter = new TemplateTestExporter(deps)
    const running = exporter.run(1, payload())
    await expect(exporter.run(1, payload())).rejects.toThrow('请勿重复提交')
    resolve(result({ output: JSON.stringify({ draft_id: 'draft-2' }) }))
    await expect(running).resolves.toMatchObject({ draftId: 'draft-2' })
  })

  it('无效文档和空可见内容不会执行', async () => {
    const deps = dependencies()
    const exporter = new TemplateTestExporter(deps)
    await expect(exporter.run(1, { templateJson: '{', configJson: '{}' })).rejects.toThrow()
    await expect(exporter.run(1, {
      templateJson: JSON.stringify({ width: 720, height: 1280, duration: 5, elements: [] }), configJson: '{}'
    })).rejects.toThrow('没有可见内容')
    expect(deps.execute).not.toHaveBeenCalled()
  })
})
