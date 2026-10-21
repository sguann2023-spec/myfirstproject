import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { compileDraftTemplate, type DraftScene, type DraftSceneSegment, type DraftTemplate } from './draftTemplate'
import { prepareExecutionWorkflow } from './testExport'
import type { TemplateWorkflow, WorkflowStep } from './workflowTypes'
import { inputName } from './inputNames'

const key = (label: string) => inputName(label, new Set())

function batch(id: string, duration: number, items: unknown[], tracks: DraftScene['tracks']): DraftSceneSegment {
  return {
    id, type: 'scene', name: id === 'outer' ? '音画同步' : id === 'inner' ? '文案配音' : id, target_timerange: { start: 0, duration },
    batch_scene: { source: 'items', mode: 'repeat', items }, dynamic: ['batch_scene.items'],
    tracks: [], scenes: [{ id: `${id}-body`, target_timerange: { start: 0, duration }, tracks }]
  }
}

function fixture() {
  const inner = batch('inner', 5_000_000, [{ title: '默认文案', image: '' }], [
    { id: 'caption-track', type: 'text', segments: [{ id: 'caption', name: '文案', material_id: 'text', target_timerange: { start: 0 } }] },
    { id: 'voice-track', type: 'audio', segments: [{ id: 'voice', name: '配音', material_id: 'audio', target_timerange: { start: 0 } }] }
  ])
  const outer = batch('outer', 10_000_000, [
    { 文案配音: [{ 文案: { text: '甲一' }, 配音: { music_url: '/tmp/a1.mp3' } }, { 文案: { text: '甲二' }, 配音: { music_url: '/tmp/a2.mp3' } }],
      背景视频: { video_url: '/tmp/a.mp4' } },
    { 文案配音: [{ 文案: { text: '乙一' }, 配音: { music_url: '/tmp/b1.mp3' } }], 背景视频: { video_url: '/tmp/b.mp4' } }
  ], [
    { id: 'inner-track', type: 'scene', track_relative_index: 0, segments: [inner] },
    { id: 'background-track', type: 'video', track_relative_index: 1,
      segments: [{ id: 'background', name: '背景视频', material_id: 'video', target_timerange: { start: 0 } }] }
  ])
  const draft: DraftTemplate = {
    canvas_config: { width: 720, height: 1280 },
    materials: {
      texts: [{ id: 'text', type: 'text', content: JSON.stringify({ text: '文字默认值' }) }],
      audios: [{ id: 'audio', type: 'audio', path: '/tmp/default.mp3' }],
      videos: [{ id: 'video', type: 'video', path: '/tmp/default.mp4' }]
    },
    scenes: [{ id: 'root', auto_duration: true, target_timerange: { start: 0 },
      tracks: [{ id: 'outer-track', type: 'scene', segments: [outer] }] }]
  }
  return { draft, outer, inner }
}

function autoFixture() {
  const result = fixture()
  const { outer, inner } = result
  outer.auto_duration = true
  outer.scenes![0].auto_duration = true
  inner.auto_duration = true
  inner.scenes![0].auto_duration = true
  inner.scenes![0].tracks[1].segments[0].target_timerange.duration = 5_000_000
  outer.scenes![0].tracks[1].segments[0].auto_timing = {
    start: { target: 'parent', anchor: 'start' },
    end: { target: 'parent', anchor: 'end' }
  }
  return result
}

function loops(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.flatMap(step => [
    ...(step.type === 'for' ? [step] : []),
    ...loops(step.loop ?? []), ...loops(step.then ?? []), ...loops(step.else ?? [])
  ])
}

// Model the documented primitives without restoring `item` after a nested loop.
// This verifies the compiler's context isolation, not the real backend/media integration.
function simulate(workflow: TemplateWorkflow) {
  const program = String.raw`
import json, re, sys
workflow = json.load(sys.stdin)
variables = dict(workflow['inputs'])
actions = []
def resolve(path):
    parts = path.split('.')
    value = variables[parts[0]]
    for part in parts[1:]:
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value
def evaluate(value):
    if isinstance(value, dict): return {key: evaluate(item) for key, item in value.items()}
    if isinstance(value, list): return [evaluate(item) for item in value]
    if not isinstance(value, str): return value
    refs = []
    def substitute(match):
        refs.append(resolve(match.group(1)))
        return '__refs[%d]' % (len(refs) - 1)
    expression = re.sub(r'\$\{([^}]+)\}', substitute, value)
    try: return eval(expression, {'__builtins__': {}}, {'__refs': refs})
    except (NameError, SyntaxError): return value
def run(steps):
    for step in steps:
        if step['type'] == 'set_var': variables[step['name']] = evaluate(step['value'])
        elif step['type'] == 'for':
            values = evaluate(step['in']) if 'in' in step else range(int(evaluate(step['loopCount'])))
            for index, item in enumerate(values):
                variables['index'], variables['item'] = index, item
                run(step['loop'])
        elif step['type'] == 'if': run(step.get('then', []) if evaluate(step['condition']) else step.get('else', []))
        elif step['type'] == 'action': actions.append({'id': step['id'], 'params': evaluate(step['params'])})
run(workflow['script'])
print(json.dumps(actions))
`
  const result = spawnSync('python3', ['-c', program], {
    input: JSON.stringify(prepareExecutionWorkflow(workflow)), encoding: 'utf8', timeout: 10_000
  })
  if (result.status !== 0) throw new Error(`${result.error?.message ?? ''}\n${result.stderr}`)
  return JSON.parse(result.stdout) as Array<{ id: string; params: Record<string, any> }>
}

it('外层和内层输入名称对应目录，中文元素下只保留一个属性', () => {
  const { draft } = fixture()
  const compiled = compileDraftTemplate(draft)
  expect(Object.keys(compiled.workflow.inputs)).toEqual([key('音画同步')])
  const values = (compiled.workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  expect(values.map(item => Object.keys(item))).toEqual([[key('文案配音'), key('背景视频')], [key('文案配音'), key('背景视频')]])
  expect(values[0][key('文案配音')]).toEqual([
    { [key('文案')]: { text: '甲一' }, [key('配音')]: { music_url: '/tmp/a1.mp3' } },
    { [key('文案')]: { text: '甲二' }, [key('配音')]: { music_url: '/tmp/a2.mp3' } }
  ])
  expect(values[1][key('文案配音')][0][key('文案')].text).toBe('乙一')
  expect(compiled.workflowInputBindings.find(binding => binding.key === 'inner.batch_scene.items'))
    .toMatchObject({ variable: key('音画同步'), inputPath: ['*', key('文案配音')], runtime: true })
  const inner = loops(compiled.workflow.script).find(loop => loop.id === 'inner_batch_loop')!
  expect(inner.in).toContain(`.${key('文案配音')}}`)
  expect(compiled.warnings.some(warning => warning.includes('inner.batch_scene.items'))).toBe(false)
})

it('模拟执行各外层独立子列表，背景在内层循环之后也不串数据，外层索引仍递增', () => {
  const actions = simulate(compileDraftTemplate(fixture().draft).workflow)
  expect(actions.filter(action => action.id === 'caption').map(action => action.params.text)).toEqual(['甲一', '甲二', '乙一'])
  expect(actions.filter(action => action.id === 'voice').map(action => action.params.audio_url))
    .toEqual(['/tmp/a1.mp3', '/tmp/a2.mp3', '/tmp/b1.mp3'])
  const backgrounds = actions.filter(action => action.id === 'background')
  expect(backgrounds.map(action => action.params.video_url)).toEqual(['/tmp/a.mp4', '/tmp/b.mp4'])
  expect(backgrounds.map(action => action.params.target_start)).toEqual([0, 10])
  expect(actions.filter(action => action.id === 'caption').map(action => [action.params.start, action.params.end]))
    .toEqual([[0, 5], [5, 10], [10, 15]])
})

it('Auto 背景覆盖当前内层全部分镜，修改列表后重新累计外层起点', () => {
  const { draft } = autoFixture()
  const workflow = compileDraftTemplate(draft).workflow
  const values = (workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  // Change cardinalities without recompiling; each parent has its own child list.
  values[1][key('文案配音')].push(structuredClone(values[1][key('文案配音')][0]))
  values.push(structuredClone(values[0]))
  values[2][key('文案配音')].splice(1)
  const actions = simulate(workflow)
  expect(actions.filter(action => action.id === 'background').map(action =>
    [action.params.target_start, action.params.duration])).toEqual([[0, 10], [10, 10], [20, 5]])
  expect(actions.filter(action => action.id === 'caption').map(action =>
    [action.params.start, action.params.end])).toEqual([[0, 5], [5, 10], [10, 15], [15, 20], [20, 25]])
})

it('空 Auto 子列表不产生背景占位或时间间隙，空外层列表不执行素材', () => {
  const workflow = compileDraftTemplate(autoFixture().draft).workflow
  const values = (workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  values[0][key('文案配音')] = []
  const actions = simulate(workflow)
  expect(actions.filter(action => action.id === 'background').map(action =>
    [action.params.video_url, action.params.target_start, action.params.duration])).toEqual([['/tmp/b.mp4', 0, 5]])
  values.splice(0)
  expect(simulate(workflow)).toEqual([])
})

it('三层 Auto 批量分镜递归累计，结束关联的普通分镜跟随完整批次', () => {
  const { draft, outer } = autoFixture()
  const wrapper = batch('wrapper', 5_000_000, [{}, {}], [
    { id: 'wrapper-track', type: 'scene', segments: [outer] }
  ])
  wrapper.auto_duration = true
  wrapper.scenes![0].auto_duration = true
  draft.scenes[0].tracks[0].segments = [wrapper]
  draft.scenes[0].tracks.push({
    id: 'tail-track', type: 'text', segments: [{
      id: 'tail', material_id: 'text', target_timerange: { duration: 2_000_000 },
      auto_timing: { start: { target: 'wrapper', anchor: 'end' } }
    }]
  })
  const actions = simulate(compileDraftTemplate(draft).workflow)
  expect(actions.filter(action => action.id === 'background').map(action =>
    [action.params.target_start, action.params.duration])).toEqual([[0, 10], [10, 5], [15, 10], [25, 5]])
  expect(actions.find(action => action.id === 'tail')?.params).toMatchObject({ start: 30, end: 32 })
})

it('展开后的完整批次仍遵守固定根时长裁切', () => {
  const { draft } = autoFixture()
  draft.duration = 7_000_000
  const actions = simulate(compileDraftTemplate(draft).workflow)
  expect(actions.filter(action => action.id === 'background').map(action =>
    [action.params.target_start, action.params.duration])).toEqual([[0, 7]])
  expect(actions.filter(action => action.id === 'caption').map(action =>
    [action.params.start, action.params.end])).toEqual([[0, 5], [5, 7]])
})

it('批量内音频与背景视频都可循环，内层循环不会覆盖后续背景和外层起点', () => {
  const { draft, outer, inner } = autoFixture()
  inner.scenes![0].tracks[1].segments[0].loop = true
  outer.scenes![0].tracks[1].segments[0].loop = true
  draft.materials.audios[0].duration = 2_000_000
  draft.materials.videos[0].duration = 4_000_000
  const actions = simulate(compileDraftTemplate(draft).workflow)
  expect(actions.filter(action => action.id === 'voice').map(action =>
    [action.params.target_start, action.params.start, action.params.end, action.params.duration]))
    .toEqual([[0, 0, 2, 2], [2, 0, 2, 2], [4, 0, 1, 1],
      [5, 0, 2, 2], [7, 0, 2, 2], [9, 0, 1, 1], [10, 0, 2, 2], [12, 0, 2, 2], [14, 0, 1, 1]])
  expect(actions.filter(action => action.id === 'background').map(action =>
    [action.params.video_url, action.params.target_start, action.params.duration]))
    .toEqual([['/tmp/a.mp4', 0, 4], ['/tmp/a.mp4', 4, 4], ['/tmp/a.mp4', 8, 2], ['/tmp/b.mp4', 10, 4], ['/tmp/b.mp4', 14, 1]])
})

it('动态源区间长度改变循环次数，浮点整轮边界不多生成一轮', () => {
  const { draft, inner } = autoFixture()
  const voice = inner.scenes![0].tracks[1].segments[0]
  voice.loop = true
  voice.target_timerange.duration = 600_000
  voice.source_timerange = { start: 1_000_000, duration: 200_000 }
  voice.dynamic = ['source_timerange.duration']
  const result = compileDraftTemplate(draft)
  const binding = result.workflowInputBindings.find(item => item.key === 'voice.source_timerange.duration')!
  const actions = simulate(result.workflow).filter(action => action.id === 'voice')
  expect(actions).toHaveLength(9)
  expect(actions.slice(0, 3).map(action => [action.params.start, action.params.end, action.params.duration]))
    .toEqual([[1, 1.2, .2], [1, 1.2, .2], [1, 1.2, .2]])
  ;(result.workflow.inputs as Record<string, unknown>)[binding.variable] = 300_000
  expect(simulate(result.workflow).filter(action => action.id === 'voice')).toHaveLength(6)
  ;(result.workflow.inputs as Record<string, unknown>)[binding.variable] = 0
  expect(() => simulate(result.workflow)).toThrow('媒体循环源时长无效')
})

it('动态左裁切的视频保留源循环相位', () => {
  const draft = {
    canvas_config: { width: 720, height: 1280 },
    materials: { videos: [{ id: 'movie', type: 'video', path: '/tmp/movie.mp4', duration: 8_000_000, dynamic: ['path'] }] },
    scenes: [{ id: 'scene', target_timerange: { duration: 4_000_000 }, tracks: [{
      id: 'track', type: 'video', segments: [{
        id: 'movie-clip', material_id: 'movie', loop: true, target_timerange: { duration: 9_000_000 },
        source_timerange: { start: 1_000_000, duration: 2_000_000 },
        auto_timing: { end: { target: 'parent', anchor: 'end' as const } }
      }]
    }] }]
  }
  expect(simulate(compileDraftTemplate(draft).workflow).map(action => [
    action.params.target_start, action.params.start, action.params.end, action.params.duration
  ])).toEqual([[0, 2, 3, 1], [1, 1, 3, 2], [3, 1, 2, 1]])
})

it('默认子列表递归补全，各外层对象独立；不再保留外层无效的默认 title/image', () => {
  const { draft, outer } = fixture()
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{ title: '过时字段', image: '' }, {}] }
  const values = (compileDraftTemplate(draft).workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  expect(Object.keys(values[0])).toEqual([key('文案配音'), key('背景视频')])
  expect(values[0][key('文案配音')][0][key('文案')].text).toBe('默认文案')
  values[0][key('文案配音')][0][key('文案')].text = '只改第一组'
  expect(values[1][key('文案配音')][0][key('文案')].text).toBe('默认文案')
})

it('多个兄弟批量分镜同名时追加 _2，各自绑定当前外层条目', () => {
  const { draft, outer, inner } = fixture()
  const second = structuredClone(inner)
  second.id = 'second'
  second.scenes![0].id = 'second-body'
  second.scenes![0].tracks = [{ id: 'second-text-track', type: 'text',
    segments: [{ id: 'second-text', material_id: 'text', target_timerange: { start: 0 } }] }]
  outer.scenes![0].tracks.push({ id: 'second-track', type: 'scene', track_relative_index: 2, segments: [second] })
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{
    scenes: [{ title: '第一列表' }], scenes_2: [{ title: '第二列表' }], video: { url: '/tmp/a.mp4' }
  }] }
  const workflow = compileDraftTemplate(draft).workflow
  expect(Object.keys(workflow.inputs)).toEqual([key('音画同步')])
  expect(loops(workflow.script).find(loop => loop.id === 'second_batch_loop')!.in).toContain(`.${key('文案配音')}_2}`)
  expect(simulate(workflow).filter(action => ['caption', 'second-text'].includes(action.id)).map(action => action.params.text))
    .toEqual(['第一列表', '第二列表'])
})

it('三层批量分镜保持嵌套数组与路径，普通组合不额外产生列表', () => {
  const { draft, outer } = fixture()
  const wrapper = batch('wrapper', 10_000_000, [{ scenes: [{}] }], [
    { id: 'wrapper-track', type: 'scene', segments: [outer] }
  ])
  draft.scenes[0].tracks[0].segments = [wrapper]
  const compiled = compileDraftTemplate(draft)
  expect(Object.keys(compiled.workflow.inputs)).toEqual(['input_wrapper'])
  expect(compiled.workflowInputBindings.find(binding => binding.key === 'inner.batch_scene.items')?.inputPath)
    .toEqual(['*', key('音画同步'), '*', key('文案配音')])
  expect(simulate(compiled.workflow).filter(action => action.id === 'caption').map(action => action.params.text))
    .toEqual(['默认文案'])
})

it('明确的空子列表不被默认值填充，背景视频仍执行；非法子列表拒绝编译', () => {
  const { draft, outer } = fixture()
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{ scenes: [], video: { url: '/tmp/empty.mp4' } }] }
  expect(simulate(compileDraftTemplate(draft).workflow).map(action => action.id)).toEqual(['background'])
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{ scenes: { text: '非法' } }] }
  expect(() => compileDraftTemplate(draft)).toThrow('文案配音 必须是数组')
})

it('不重新编译即可修改纯文本和媒体 URL，旧版文字/URL 对象也可重新编译', () => {
  const { draft, outer } = fixture()
  const workflow = compileDraftTemplate(draft).workflow
  const values = (workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  values[0][key('文案配音')][0][key('文案')].text = '1+2 ${price}'
  values[0][key('文案配音')][0][key('配音')].music_url = '/tmp/changed.mp3'
  values[0][key('背景视频')].video_url = '/tmp/changed.mp4'
  const actions = simulate(workflow)
  expect(actions.find(action => action.id === 'caption')?.params.text).toBe('1+2 ${price}')
  expect(actions.find(action => action.id === 'voice')?.params.audio_url).toBe('/tmp/changed.mp3')
  expect(actions.find(action => action.id === 'background')?.params.video_url).toBe('/tmp/changed.mp4')
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{
    scenes: [{ text: { text: '旧版文案', font_color: '#ffffff' }, audio: { url: '/tmp/legacy.mp3' } }],
    video: { url: '/tmp/legacy.mp4' }
  }] }
  expect((compileDraftTemplate(draft).workflow.inputs as Record<string, unknown>)[key('音画同步')])
    .toEqual([{ [key('文案配音')]: [{ [key('文案')]: { text: '旧版文案' }, [key('配音')]: { music_url: '/tmp/legacy.mp3' } }], [key('背景视频')]: { video_url: '/tmp/legacy.mp4' } }])
})

it.each(['', '/tmp/ghost.png'])('没有图片元素时不导出历史 image 占位 %s', image => {
  const { draft, outer } = fixture()
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{
    scenes: [{ title: '文案', image, image_url: image }], image, video_url: '/tmp/background.mp4'
  }] }
  const compiled = compileDraftTemplate(draft)
  const values = (compiled.workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  expect(Object.keys(values[0])).toEqual([key('文案配音'), key('背景视频')])
  expect(Object.keys(values[0][key('文案配音')][0])).toEqual([key('文案'), key('配音')])
  expect(JSON.stringify(values)).not.toContain('image')
  expect((outer.batch_scene as any).items[0].image).toBe(image)
})

it('同名叶子元素和标点名称安全规范化，中文保留，多个 text 输入不会互相覆盖', () => {
  const { draft, outer, inner } = fixture()
  inner.scenes![0].tracks[0].segments[0].name = '中文.文案 [一]'
  inner.scenes![0].tracks.push({ id: 'extra', type: 'text', segments: [
    { id: 'extra-caption', name: '中文.文案 [一]', material_id: 'text', target_timerange: { start: 0 } }
  ] })
  outer.batch_scene = { source: 'items', mode: 'repeat', items: [{
    scenes: [{ text: '第一句', text_2: '第二句' }], video_url: '/tmp/changed.mp4'
  }] }
  const compiled = compileDraftTemplate(draft)
  const values = (compiled.workflow.inputs as Record<string, unknown>)[key('音画同步')] as any[]
  expect(Object.keys(values[0][key('文案配音')][0])).toEqual([key('中文.文案 [一]'), key('配音'), `${key('中文.文案 [一]')}_2`])
  expect(simulate(compiled.workflow).filter(action => ['caption', 'extra-caption'].includes(action.id)).map(action => action.params.text))
    .toEqual(['第一句', '第二句'])
})

it('重命名单个批量分镜和文案后 input 名称同步，原来的命名数据仍保留', () => {
  const { draft, outer, inner } = fixture()
  outer.name = '新的音画同步'
  inner.name = '新的文案配音'
  inner.scenes![0].tracks[0].segments[0].name = '新的文案'
  const compiled = compileDraftTemplate(draft)
  expect(Object.keys(compiled.workflow.inputs)).toEqual([key('新的音画同步')])
  const values = (compiled.workflow.inputs as Record<string, unknown>)[key('新的音画同步')] as any[]
  expect(values[0][key('新的文案配音')][0][key('新的文案')]).toEqual({ text: '甲一' })
  expect(simulate(compiled.workflow).filter(action => action.id === 'caption').map(action => action.params.text))
    .toEqual(['甲一', '甲二', '乙一'])
})
