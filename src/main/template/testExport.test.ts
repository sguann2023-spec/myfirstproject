import { describe, expect, it, vi } from 'vitest'
import { editorInitialTemplate } from './editorModel'
import { prepareExecutionWorkflow, TemplateTestExporter } from './testExport'
import { createEditorPreset } from './editorPresets'
import { compileDraftTemplate } from './draftTemplate'
import { workflowActions } from './workflowTestUtils'
import { encodeWorkflowInputNames, executionInputName, inputName } from './inputNames'
import type { TemplateWorkflow } from './workflowTypes'

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
    expect(executed.inputs[executionInputName('第_1_句话')]).toEqual({ text: '清晨，阳光洒进安静的房间。' })
    expect(workflowActions(executed).find(({ id }) => id === 'text-1')!.params.text)
      .toBe(`\${${executionInputName('第_1_句话')}.text}`)
  })

  it('中文嵌套输入在执行边界转换为 ASCII，避开已有编码名，重复转换保持不变', () => {
    const collision = executionInputName('音画同步')
    const workflow = {
      inputs: {
        音画同步: [{ 文案配音: [{ 文案: { text: '1+2 ${price}' }, 配音: { music_url: '/tmp/voice.mp3' } }],
          背景视频: { video_url: '/tmp/background.mp4' } }],
        [collision]: '现有变量'
      },
      script: [{
        type: 'for', id: 'outer', index: 0, in: '${音画同步}', loop: [
          { type: 'set_var', id: 'parent', index: 0, name: 'parent', value: '${item}' },
          { type: 'for', id: 'inner', index: 1, in: '${parent.文案配音}', loop: [
            { type: 'action', id: 'caption', index: 0, action_type: 'add_text', params: { text: '${item.文案.text}' } }
          ] },
          { type: 'action', id: 'video', index: 2, action_type: 'add_video', params: { video_url: '${parent.背景视频.video_url}' } }
        ]
      }]
    }
    const original = structuredClone(workflow)
    const prepared = prepareExecutionWorkflow(workflow as any)
    expect(prepared.inputs[collision]).toBe('现有变量')
    expect(Object.keys(prepared.inputs).every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))).toBe(true)
    expect(prepared.script[0].in).not.toBe(`\${${collision}}`)
    expect(JSON.stringify(prepared.script)).not.toMatch(/[音画同步文案配背景视]/u)
    expect(prepareExecutionWorkflow(prepared)).toEqual(prepared)
    expect(workflow).toEqual(original)
    expect(JSON.stringify(prepared.inputs)).toContain('1+2 ${price}')
  })

  it('执行失败或缺少草稿 ID 时不提交导出', async () => {
    for (const response of [{ success: false, error: 'failed' }, { success: true, output: {} }]) {
      const deps = dependencies()
      deps.execute.mockResolvedValue(result(response))
      await expect(new TemplateTestExporter(deps).run(1, payload())).rejects.toThrow()
      expect(deps.exportDraft).not.toHaveBeenCalled()
    }
  })

  it('旧中文标签路径同步转换，保留展示名且转换幂等', () => {
    const workflow = {
      width: 720, height: 1280,
      inputs: { 分镜: [{ 文案: { text: '中文内容' } }] },
      input_labels: [{ path: ['分镜', '*', '文案'], label: '展示文案' }],
      script: []
    }
    const original = structuredClone(workflow)
    const encoded = encodeWorkflowInputNames(workflow)
    expect(encoded.input_labels).toContainEqual({
      path: [executionInputName('分镜'), '*', executionInputName('文案')], label: '展示文案'
    })
    expect(encodeWorkflowInputNames(encoded)).toEqual(encoded)
    expect(workflow).toEqual(original)
    const reserved = executionInputName('文案')
    expect(inputName('文案', new Set(), new Set([reserved]))).not.toBe(reserved)
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

  it('传入编辑后的 workflowJson 优先于重新编译执行', async () => {
    const template = createEditorPreset('sentence-image')
    const compiled = compileDraftTemplate(template)
    const edited = { ...compiled.workflow, inputs: { ...compiled.workflow.inputs, input_text_material_1_content: { text: '手工改过的文案' } } }
    const deps = dependencies()
    const exporter = new TemplateTestExporter(deps)
    await exporter.run(1, { templateJson: JSON.stringify(template) }, JSON.stringify(edited))
    expect(deps.execute.mock.calls[0][0].inputs.input_text_material_1_content).toEqual({ text: '手工改过的文案' })
    await expect(exporter.run(1, { templateJson: JSON.stringify(template) }, '{')).rejects.toThrow('不是合法 JSON')
    await expect(exporter.run(1, { templateJson: JSON.stringify(template) }, JSON.stringify({ width: 720 }))).rejects.toThrow('缺少 script')
    await expect(exporter.run(1, { templateJson: JSON.stringify(template) }, JSON.stringify({ script: [], inputs: [] }))).rejects.toThrow('inputs 必须是对象')
    expect(deps.execute).toHaveBeenCalledTimes(1)
  })

  it('数字循环次数引用随旧中文输入编码，不保留失效路径', () => {
    const workflow: TemplateWorkflow = {
      width: 720, height: 1280, inputs: { 循环次数: 2 },
      script: [{ type: 'for', id: 'media-loop', index: 0, loopCount: '${循环次数}', loop: [] }]
    }
    const encoded = prepareExecutionWorkflow(workflow)
    expect(encoded.script[0].loopCount).toBe(`\${${executionInputName('循环次数')}}`)
    expect(prepareExecutionWorkflow(encoded)).toEqual(encoded)
    expect(workflow.script[0].loopCount).toBe('${循环次数}')
  })
})
