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
    expect(guidance.hasWorkspaceTools).toBe(false)
    expect(guidance.hasAgenticTools).toBe(false)
  })
})
