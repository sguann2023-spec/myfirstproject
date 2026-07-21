import { describe, expect, it } from 'vitest'

import { CapabilityRouter, buildToolGuidanceOptions } from '../capability-router'
import { buildToolSurface } from '../tool-surface'

describe('CapabilityRouter', () => {
  it('keeps casual chat in the chat domain with no runtime capabilities', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '你好',
      sessionId: 'session-chat',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('chat')
    expect(decision.subdomains).toEqual([])
    expect(decision.activeDomains).toEqual([])
    expect(decision.toolLayer).toBe('chat')
    expect(Array.from(decision.selected)).toEqual([])
  })

  it('routes file creation requests to workspace.write', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '在当前工程里创建 test.txt，内容是 hello',
      sessionId: 'session-write',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('workspace')
    expect(decision.subdomains).toContain('write')
    expect(decision.toolLayer).toBe('workspace-write')
  })

  it('routes direct document filename reads to workspace.read', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '看下index123.html这个文档里的内容',
      sessionId: 'session-html-read',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('workspace')
    expect(decision.subdomains).toContain('read')
    expect(decision.toolLayer).toBe('workspace-read')
  })

  it('does not treat plain domains or version numbers as workspace files', () => {
    const router = new CapabilityRouter()

    const domain = router.select({
      prompt: '你知道 openai.com 吗',
      sessionId: 'session-domain',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const version = router.select({
      prompt: '版本 1.2.3 有什么变化',
      sessionId: 'session-version',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(domain.primaryDomain).toBe('chat')
    expect(version.primaryDomain).toBe('chat')
  })

  it('routes hot topic requests to web.search', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '看下今天热点',
      sessionId: 'session-hot-topics',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('web')
    expect(decision.subdomains).toContain('search')
    expect(decision.toolLayer).toBe('web')
    expect(decision.selected.has('search')).toBe(true)
  })

  it('routes page opening requests to web.browser', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '打开网页 https://example.com',
      sessionId: 'session-open-page',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('web')
    expect(decision.subdomains).toContain('browser')
    expect(decision.activeDomains).toEqual([
      expect.objectContaining({
        domain: 'web',
        role: 'primary',
        subdomains: expect.arrayContaining(['browser'])
      })
    ])
    expect(decision.preferredMcpTools).toContain('mcp__browser__open')
    expect(decision.toolLayer).toBe('web')
    expect(decision.selected.has('browser')).toBe(true)
  })

  it('does not let draft download requests with URLs fall into browser intent', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '下载这个草稿 https://vectcut.com/draft/downloader?draft_id=dfd_test_123',
      sessionId: 'session-draft-download-url',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('cut')
    expect(decision.subdomains).toEqual(['draft_download'])
    expect(decision.selected.has('draftDownload')).toBe(true)
    expect(decision.selected.has('browser')).toBe(false)
    expect(decision.preferredMcpTools).toContain('mcp__draft-download__download_draft')
    expect(decision.preferredMcpTools).not.toContain('mcp__browser__open')
  })

  it('treats open website phrasing as browser intent', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '打开一下百度网页',
      sessionId: 'session-open-baidu',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('web')
    expect(decision.subdomains).toContain('browser')
    expect(decision.selected.has('browser')).toBe(true)
    expect(decision.preferredMcpTools).toContain('mcp__browser__open')
  })

  it('keeps multiple active domains for mixed workspace and web tasks', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '查一下 React 19 的官方变更，再看下我们项目哪里要改',
      sessionId: 'session-mixed-domains',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.activeDomains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'web',
          subdomains: expect.arrayContaining(['search'])
        }),
        expect.objectContaining({
          domain: 'workspace',
          subdomains: expect.arrayContaining(['read'])
        })
      ])
    )
    expect(decision.companionDomains).toContain('web')
    expect(decision.toolLayer).toBe('workspace-read')
  })

  it('routes reverse prompt requests to scrapt instead of plain chat', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '反推这个链接的提示词：https://www.douyin.com/video/123',
      sessionId: 'session-copylab-link',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('scrapt')
    expect(decision.subdomains).toEqual(['derive_prompt'])
    expect(decision.selected.has('copylab')).toBe(true)
  })

  it('keeps plain copywriting requests in chat', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '写文案',
      sessionId: 'session-copywriting-chat',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('chat')
    expect(decision.selected.has('copylab')).toBe(false)
  })

  it('routes workspace lookup requests to workspace.find + workspace.read', () => {
    const router = new CapabilityRouter()

    const fileDecision = router.select({
      prompt: '看看有没有文件',
      sessionId: 'session-find-file',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const textDecision = router.select({
      prompt: '查一下有没有 xxx 文字',
      sessionId: 'session-find-text',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(fileDecision.primaryDomain).toBe('workspace')
    expect(fileDecision.subdomains).toEqual(expect.arrayContaining(['find', 'read']))
    expect(fileDecision.toolLayer).toBe('workspace-read')
    expect(textDecision.primaryDomain).toBe('workspace')
    expect(textDecision.subdomains).toEqual(expect.arrayContaining(['find', 'read']))
  })

  it('routes webpage generation to workspace.write instead of web.browser', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '写网页',
      sessionId: 'session-build-page',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('workspace')
    expect(decision.subdomains).toContain('write')
    expect(decision.selected.has('browser')).toBe(false)
    expect(decision.toolLayer).toBe('workspace-write')
  })

  it('routes file upload requests to workspace.upload', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '把 /tmp/demo.mp3 上传到 oss',
      sessionId: 'session-upload-file',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('workspace')
    expect(decision.subdomains).toEqual(expect.arrayContaining(['upload', 'read']))
    expect(decision.toolLayer).toBe('workspace-read')
    expect(decision.selected.has('uploadFile')).toBe(true)
    expect(decision.preferredMcpTools).toContain('mcp__file-upload__upload_file_to_oss')
  })

  it('routes speech, seed audio, image, and digital human requests to ai_media', () => {
    const router = new CapabilityRouter()

    const speechDecision = router.select({
      prompt: '将一段声音合成语音',
      sessionId: 'session-speech',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const seedAudioDecision = router.select({
      prompt: '用豆包语音生成一段带多人对白、背景音乐和音效的音频，参考这张图和一段音频',
      sessionId: 'session-seed-audio',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const digitalHumanDecision = router.select({
      prompt: '生成数字人',
      sessionId: 'session-digital-human',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const imageDecision = router.select({
      prompt: '生成图片',
      sessionId: 'session-image',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(speechDecision.primaryDomain).toBe('ai_media')
    expect(speechDecision.subdomains).toEqual(['speech'])
    expect(speechDecision.selected.has('speech')).toBe(true)
    expect(seedAudioDecision.primaryDomain).toBe('ai_media')
    expect(seedAudioDecision.subdomains).toEqual(['seed_audio'])
    expect(seedAudioDecision.selected.has('seedAudio')).toBe(true)
    expect(seedAudioDecision.selected.has('speech')).toBe(false)
    expect(seedAudioDecision.preferredMcpTools).toContain('mcp__seed-audio__generate_seed_audio')
    expect(digitalHumanDecision.primaryDomain).toBe('ai_media')
    expect(digitalHumanDecision.subdomains).toEqual(['digital_human'])
    expect(digitalHumanDecision.selected.has('digitalHuman')).toBe(true)
    expect(imageDecision.primaryDomain).toBe('ai_media')
    expect(imageDecision.subdomains).toEqual(['image'])
    expect(imageDecision.selected.has('image')).toBe(true)
  })

  it('routes cut tasks into the cut domain', () => {
    const router = new CapabilityRouter()

    const createDecision = router.select({
      prompt: '创建一个草稿',
      sessionId: 'session-draft-create',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const updateMetaDecision = router.select({
      prompt: '把这个草稿的封面和名称改一下',
      sessionId: 'session-draft-update-meta',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const inspectDecision = router.select({
      prompt: '看下这个草稿内容对不对',
      sessionId: 'session-draft-inspect',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const visualInspectDecision = router.select({
      prompt: '检查一下这个草稿 dfd_cat_1784472467_83a33e4a，文字有右上弹入的动画吗',
      sessionId: 'session-draft-visual-inspect',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const draftDecision = router.select({
      prompt: '下载草稿',
      sessionId: 'session-draft-download',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const subtitleTemplateDecision = router.select({
      prompt: '给这段视频添加字幕模板，默认样式就行',
      sessionId: 'session-subtitle-template',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const templateDecision = router.select({
      prompt: '模版剪辑',
      sessionId: 'session-template-cut',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(createDecision.primaryDomain).toBe('cut')
    expect(createDecision.subdomains).toEqual(['draft_create'])
    expect(createDecision.selected.has('draftCreate')).toBe(true)
    expect(updateMetaDecision.primaryDomain).toBe('cut')
    expect(updateMetaDecision.subdomains).toEqual(['draft_update_meta'])
    expect(updateMetaDecision.selected.has('draftUpdateMeta')).toBe(true)
    expect(updateMetaDecision.selected.has('image')).toBe(false)
    expect(inspectDecision.primaryDomain).toBe('cut')
    expect(inspectDecision.subdomains).toEqual(['draft_inspect'])
    expect(inspectDecision.selected.has('draftInspect')).toBe(true)
    expect(visualInspectDecision.primaryDomain).toBe('cut')
    expect(visualInspectDecision.subdomains).toEqual(['draft_inspect'])
    expect(visualInspectDecision.selected.has('draftInspect')).toBe(true)
    expect(draftDecision.primaryDomain).toBe('cut')
    expect(draftDecision.subdomains).toEqual(['draft_download'])
    expect(draftDecision.selected.has('draftDownload')).toBe(true)
    expect(draftDecision.preferredMcpTools).toContain('mcp__draft-download__download_draft')
    expect(subtitleTemplateDecision.primaryDomain).toBe('cut')
    expect(subtitleTemplateDecision.subdomains).toEqual(['subtitle_template'])
    expect(subtitleTemplateDecision.selected.has('subtitleTemplate')).toBe(true)
    expect(subtitleTemplateDecision.selected.has('kouboTemplate')).toBe(false)
    expect(subtitleTemplateDecision.preferredMcpTools).toContain('mcp__subtitle-template__generate_smart_subtitle')
    expect(templateDecision.primaryDomain).toBe('cut')
    expect(templateDecision.subdomains).toEqual(['template'])
    expect(templateDecision.selected.has('kouboTemplate')).toBe(true)
    expect(templateDecision.preferredMcpTools).toContain('mcp__koubo-template__submit_koubo_template_task')
  })

  it('routes skill and auxiliary requests to their own domains', () => {
    const router = new CapabilityRouter()

    const skillsDecision = router.select({
      prompt: '新建成员',
      sessionId: 'session-skills',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const memoryDecision = router.select({
      prompt: '记住这个偏好',
      sessionId: 'session-memory',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(skillsDecision.primaryDomain).toBe('skills')
    expect(skillsDecision.subdomains).toEqual(['create_skill'])
    expect(skillsDecision.selected.has('skills')).toBe(true)
    expect(skillsDecision.selected.has('browser')).toBe(true)
    expect(skillsDecision.selected.has('image')).toBe(true)
    expect(skillsDecision.selected.has('draftCreate')).toBe(true)
    expect(skillsDecision.selected.has('agentMemory')).toBe(true)
    expect(skillsDecision.selected.has('system')).toBe(true)
    expect(skillsDecision.selected.has('claw')).toBe(false)
    expect(memoryDecision.primaryDomain).toBe('auxiliary')
    expect(memoryDecision.subdomains).toEqual(['memory'])
    expect(memoryDecision.selected.has('agentMemory')).toBe(true)
    expect(memoryDecision.toolLayer).toBe('agentic')
    expect(buildToolSurface({ decision: skillsDecision, isAssistant: false }).builtinTools).toEqual(
      expect.arrayContaining(['Read', 'Write', 'Bash', 'Task', 'WebSearch', 'WebFetch'])
    )
    expect(buildToolSurface({ decision: memoryDecision, isAssistant: false }).builtinTools).toEqual([])
  })

  it('routes prompts matching workspace skill metadata into the skills domain', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '生成一个儿童绘本',
      sessionId: 'session-skill-workspace-match',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false,
      workspaceSkills: [{ name: '儿童绘本', filename: '儿童绘本', description: '生成儿童绘本故事。用户提到创作儿童绘本、睡前故事时触发。' }]
    })

    expect(decision.primaryDomain).toBe('skills')
    expect(decision.subdomains).toEqual(['invoke_skill'])
    expect(decision.selected.has('skills')).toBe(true)
    expect(decision.selected.has('image')).toBe(true)
    expect(decision.toolLayer).toBe('agentic')
    expect(decision.preferredLocalSkillFilename).toBe('儿童绘本')
    expect(decision.preferredLocalSkillTriggerMode).toBe('implicit')
    expect(decision.preferredLocalSkillMatchedBy).toEqual(expect.arrayContaining(['name', 'filename']))
    expect(decision.preferredLocalSkillMatchedEvidence).toEqual(expect.arrayContaining(['儿童绘本']))
  })

  it('treats @mentioned workspace skills as explicit invocation targets', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '@儿童绘本 做一个司马光砸缸的故事',
      sessionId: 'session-skill-workspace-explicit',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false,
      workspaceSkills: [{ name: '儿童绘本', filename: '儿童绘本', description: '生成分页故事。' }]
    })

    expect(decision.primaryDomain).toBe('skills')
    expect(decision.subdomains).toEqual(['invoke_skill'])
    expect(decision.preferredLocalSkillFilename).toBe('儿童绘本')
    expect(decision.preferredLocalSkillTriggerMode).toBe('explicit')
    expect(decision.preferredLocalSkillMatchedBy).toEqual(expect.arrayContaining(['name', 'filename']))
    expect(decision.preferredLocalSkillMatchedEvidence).toEqual(['儿童绘本'])
  })

  it('backfills capability selection from non-web routed domains', () => {
    const router = new CapabilityRouter()

    const scraptDecision = router.select({
      prompt: '反推这个爆款视频链接的提示词',
      sessionId: 'session-sync-scrapt',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const imageDecision = router.select({
      prompt: '帮我生成一张海报图',
      sessionId: 'session-sync-image',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(scraptDecision.activeDomains).toEqual([
      expect.objectContaining({
        domain: 'scrapt',
        subdomains: ['derive_prompt']
      })
    ])
    expect(scraptDecision.selected.has('copylab')).toBe(true)
    expect(imageDecision.activeDomains).toEqual([
      expect.objectContaining({
        domain: 'ai_media',
        subdomains: ['image']
      })
    ])
    expect(imageDecision.selected.has('image')).toBe(true)
  })

  it('routes from bounded conversation context instead of only the latest short prompt', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '继续',
      intentPrompt: [
        '用户: 帮我生成一张海报图',
        'AI: 我先帮你整理海报需求和风格。',
        '用户: 主题改成混剪视频制作流程',
        'AI: 好的，我会按竖版信息图方向继续。',
        '用户: 继续'
      ].join('\n'),
      sessionId: 'session-retry-image',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('ai_media')
    expect(decision.subdomains).toEqual(['image'])
    expect(decision.activeDomains).toEqual([
      expect.objectContaining({
        domain: 'ai_media',
        subdomains: ['image']
      })
    ])
    expect(decision.selected.has('image')).toBe(true)
  })

  it('derives tool guidance from the selected intent surface', () => {
    const router = new CapabilityRouter()
    const webDecision = router.select({
      prompt: '看下今天热点',
      sessionId: 'session-guidance-web',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const workspaceDecision = router.select({
      prompt: '写文件',
      sessionId: 'session-guidance-workspace',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    const webGuidance = buildToolGuidanceOptions({ decision: webDecision, autonomousEnabled: false })
    const workspaceGuidance = buildToolGuidanceOptions({ decision: workspaceDecision, autonomousEnabled: false })

    expect(webGuidance.hasWeb).toBe(true)
    expect(webGuidance.hasWorkspaceTools).toBe(false)
    expect(webGuidance.hasAgenticTools).toBe(false)
    expect(workspaceGuidance.hasWorkspaceTools).toBe(true)
    expect(workspaceGuidance.hasWriteTools).toBe(true)
  })

  it('builds builtin tool surfaces from routed domains', () => {
    const router = new CapabilityRouter()
    const webDecision = router.select({
      prompt: '看下今天热点',
      sessionId: 'session-tools-web',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const workspaceDecision = router.select({
      prompt: '写文件',
      sessionId: 'session-tools-workspace',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const mixedDecision = router.select({
      prompt: '查一下 React 19 的官方变更，再看下我们项目哪里要改',
      sessionId: 'session-tools-mixed',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    const webSurface = buildToolSurface({ decision: webDecision, isAssistant: false })
    const workspaceSurface = buildToolSurface({ decision: workspaceDecision, isAssistant: false })
    const mixedSurface = buildToolSurface({ decision: mixedDecision, isAssistant: false })

    expect(webSurface.builtinTools).toEqual(['WebSearch'])
    expect(workspaceSurface.builtinTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit']))
    expect(mixedSurface.builtinTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'WebSearch']))
  })
})
