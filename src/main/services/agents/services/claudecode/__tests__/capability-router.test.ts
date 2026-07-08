import { describe, expect, it } from 'vitest'

import { CapabilityRouter, buildToolGuidanceOptions } from '../capability-router'

describe('CapabilityRouter', () => {
  it('keeps casual chat in the chat layer with no runtime capabilities', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '你好',
      sessionId: 'session-chat',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('chat')
    expect(Array.from(decision.selected)).toEqual([])
    expect(decision.toolLayerReasons).toEqual(['prompt:chat'])
  })

  it('promotes file creation requests to the workspace-write layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '在当前工程里创建 test.txt，内容是 hello',
      sessionId: 'session-write',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('workspace-write')
    expect(decision.toolLayerReasons).toContain('prompt:workspace-write')
  })

  it('promotes direct document filename reads to the workspace-read layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '看下index123.html这个文档里的内容',
      sessionId: 'session-html-read',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('workspace-read')
    expect(decision.toolLayerReasons).toContain('prompt:workspace-read')
  })

  it('promotes unknown dotted document filenames when the user asks to read them', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '查看 notes.customdoc 里的内容',
      sessionId: 'session-customdoc-read',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('workspace-read')
    expect(decision.toolLayerReasons).toContain('prompt:workspace-read')
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

    expect(domain.toolLayer).toBe('chat')
    expect(version.toolLayer).toBe('chat')
  })

  it('routes pure web search requests into the agentic layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '搜索一下最新资料并总结',
      sessionId: 'session-web-search',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('agentic')
    expect(decision.toolLayerReasons).toContain('prompt:agentic-execution')
    expect(decision.selected.has('search')).toBe(true)
  })

  it('routes pure browser tasks into the web layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '打开 https://example.com 看看页面结构',
      sessionId: 'session-web-browser',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('web')
    expect(decision.toolLayerReasons).toContain('capability:web')
    expect(decision.selected.has('browser')).toBe(true)
  })

  it('promotes test/build requests to the agentic layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '运行测试并修复失败',
      sessionId: 'session-agentic',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('agentic')
    expect(decision.toolLayerReasons).toContain('prompt:agentic-execution')
  })

  it('promotes analysis-style requests to the agentic layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '深入分析这个工作流并反推实现思路',
      sessionId: 'session-agentic-analysis',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('agentic')
    expect(decision.toolLayerReasons).toContain('prompt:agentic-execution')
  })

  it('promotes creation-style requests to the agentic layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '帮我制作一个网页工作流，并做视频和画图',
      sessionId: 'session-agentic-creation',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('agentic')
    expect(decision.toolLayerReasons).toContain('prompt:agentic-execution')
  })

  it('promotes English workflow and reverse engineering requests to the agentic layer', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: 'Search and reverse engineer this workflow, then develop the web page',
      sessionId: 'session-agentic-english',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.toolLayer).toBe('agentic')
    expect(decision.toolLayerReasons).toContain('prompt:agentic-execution')
  })

  it('enables copylab for reverse-engineering prompt requests from share links', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '根据这个抖音链接反推提示词：https://www.douyin.com/video/123',
      sessionId: 'session-copylab-link',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.selected.has('copylab')).toBe(true)
    expect(decision.reasons.copylab).toContain('prompt:copywriting')
  })

  it('enables copylab for English prompt derivation requests', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: 'Derive prompt from this TikTok share link and imitate the viral copy style',
      sessionId: 'session-copylab-english',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.selected.has('copylab')).toBe(true)
    expect(decision.reasons.copylab).toContain('prompt:copywriting')
  })

  it('only enables autonomous claw capability when the agent is autonomous', () => {
    const router = new CapabilityRouter()

    const disabled = router.select({
      prompt: '明天提醒我复查日志',
      sessionId: 'session-claw-disabled',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const enabled = router.select({
      prompt: '明天提醒我复查日志',
      sessionId: 'session-claw-enabled',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: true,
      hasCustomMcpServers: false
    })

    expect(disabled.selected.has('claw')).toBe(false)
    expect(enabled.selected.has('claw')).toBe(true)
    expect(enabled.toolLayer).toBe('agentic')
  })

  it('derives capability-scoped prompt guidance from the selected layer', () => {
    const router = new CapabilityRouter()
    const decision = router.select({
      prompt: '搜索一下最新资料并总结',
      sessionId: 'session-guidance',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    const guidance = buildToolGuidanceOptions({ decision, autonomousEnabled: false })

    expect(guidance.hasWeb).toBe(true)
    expect(decision.toolLayer).toBe('agentic')
    expect(guidance.hasWorkspaceTools).toBe(true)
    expect(guidance.hasAgenticTools).toBe(true)
  })
})
