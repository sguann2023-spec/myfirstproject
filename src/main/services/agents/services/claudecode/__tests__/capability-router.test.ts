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

  it('routes explicit bash requests to chat.bash', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '帮我执行这个 bash 命令：ffmpeg -i input.mp4 output.mp3',
      sessionId: 'session-chat-bash',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('chat')
    expect(decision.subdomains).toEqual(['bash'])
    expect(decision.selected.has('bash')).toBe(true)
    expect(decision.toolLayer).toBe('chat')
    expect(decision.activeDomains).toEqual([
      expect.objectContaining({
        domain: 'chat',
        role: 'primary',
        subdomains: ['bash']
      })
    ])
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
    expect(decision.subdomains).toEqual(['draft'])
    expect(decision.selected.has('draftDownload')).toBe(true)
    expect(decision.selected.has('browser')).toBe(false)
    expect(decision.preferredMcpTools).toContain('mcp__draft-download__download_draft')
    expect(decision.preferredMcpTools).not.toContain('mcp__browser__open')
  })

  it('routes multi media url downloads to cut.media_download instead of browser', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt:
        '下载这几个音频链接到本地再合并 https://player.install-ai-guider.top/a.wav https://player.install-ai-guider.top/b.wav https://player.install-ai-guider.top/c.wav',
      sessionId: 'session-media-download-urls',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('cut')
    expect(decision.subdomains).toEqual(expect.arrayContaining(['media']))
    expect(decision.selected.has('mediaDownload')).toBe(true)
    expect(decision.selected.has('browser')).toBe(false)
    expect(decision.preferredMcpTools).toContain('mcp__filesystem-server__download')
    expect(decision.preferredMcpTools).not.toContain('mcp__browser__open')
  })

  it('routes generic url download requests to web.download instead of browser', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '把这个网页上的音频链接下载下来 https://example.com/demo.wav',
      sessionId: 'session-web-download',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('web')
    expect(decision.subdomains).toEqual(expect.arrayContaining(['download']))
    expect(decision.selected.has('webDownload')).toBe(true)
    expect(decision.selected.has('browser')).toBe(false)
    expect(decision.preferredMcpTools).toContain('mcp__filesystem-server__download')
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

  it('treats open site-name phrasing as browser intent', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '打开淘宝网',
      sessionId: 'session-open-taobao',
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

  it('does not treat site-name mentions alone as web search intent', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '淘宝网',
      sessionId: 'session-taobao-name-only',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.selected.has('search')).toBe(false)
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
    const voiceConversionDecision = router.select({
      prompt: '将这段音频进行变声，变为音色 gv_3，并保持语速和情绪不变',
      sessionId: 'session-voice-conversion',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const seedAudioDecision = router.select({
      prompt: '豆包生成语音，做一段带多人对白、背景音乐和音效的音频，参考这张图和一段音频',
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
    expect(speechDecision.preferredMcpTools).toContain('mcp__speech__generate_speech')
    expect(voiceConversionDecision.primaryDomain).toBe('ai_media')
    expect(voiceConversionDecision.subdomains).toEqual(['voice_conversion'])
    expect(voiceConversionDecision.selected.has('voiceConversion')).toBe(true)
    expect(voiceConversionDecision.selected.has('speech')).toBe(false)
    expect(voiceConversionDecision.preferredMcpTools).toContain('mcp__voice-conversion__submit_voice_conversion_task')
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

  it('keeps near-match doubao speech prompts on speech instead of seed audio', () => {
    const router = new CapabilityRouter()

    const nearMatchDecision = router.select({
      prompt: '用豆包语音生成一段多人对话音频',
      sessionId: 'session-seed-audio-near-match',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(nearMatchDecision.primaryDomain).toBe('ai_media')
    expect(nearMatchDecision.subdomains).toEqual(['speech'])
    expect(nearMatchDecision.selected.has('speech')).toBe(true)
    expect(nearMatchDecision.selected.has('seedAudio')).toBe(false)
    expect(nearMatchDecision.preferredMcpTools).not.toContain('mcp__seed-audio__generate_seed_audio')
  })

  it('keeps voice-based TTS prompts on speech instead of voice conversion', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '利用音色 gv_ec3174bf08434ccd8da59eb8988df1f1 合成语音',
      sessionId: 'session-speech-not-voice-conversion',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('ai_media')
    expect(decision.subdomains).toEqual(['speech'])
    expect(decision.selected.has('speech')).toBe(true)
    expect(decision.selected.has('voiceConversion')).toBe(false)
    expect(decision.preferredMcpTools).toContain('mcp__speech__generate_speech')
    expect(decision.preferredMcpTools).not.toContain('mcp__voice-conversion__submit_voice_conversion_task')
  })

  it('routes changing the previous voice into a target voice id to voice conversion', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '把刚才的声音变为音色：gv_2e601fae38484816adf8bf5c38b79393',
      sessionId: 'session-voice-conversion-change-previous-voice',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('ai_media')
    expect(decision.subdomains).toEqual(['voice_conversion'])
    expect(decision.selected.has('voiceConversion')).toBe(true)
    expect(decision.selected.has('speech')).toBe(false)
    expect(decision.preferredMcpTools).toContain('mcp__voice-conversion__submit_voice_conversion_task')
  })

  it('routes the alternate exact phrase 豆包语言生成 to seed audio', () => {
    const router = new CapabilityRouter()

    const alternatePhraseDecision = router.select({
      prompt: '豆包语言生成，一段多人对话音频',
      sessionId: 'session-seed-audio-alt-phrase',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(alternatePhraseDecision.primaryDomain).toBe('ai_media')
    expect(alternatePhraseDecision.subdomains).toEqual(['seed_audio'])
    expect(alternatePhraseDecision.selected.has('seedAudio')).toBe(true)
    expect(alternatePhraseDecision.selected.has('speech')).toBe(false)
    expect(alternatePhraseDecision.preferredMcpTools).toContain('mcp__seed-audio__generate_seed_audio')
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
    const subtitleRecognitionDecision = router.select({
      prompt: '识别这个视频链接里的字幕，不要上屏 https://example.com/source.mp4',
      sessionId: 'session-subtitle-recognition',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const localSubtitleRecognitionDecision = router.select({
      prompt: '把这个本地音频文件 sample.wav 识别成字幕',
      sessionId: 'session-local-subtitle-recognition',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const videoUnderstandDecision = router.select({
      prompt: '分析这个视频画面内容 https://example.com/source.mp4',
      sessionId: 'session-video-understand',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const localVideoUnderstandDecision = router.select({
      prompt: '理解这个本地视频 sample.mp4 里都有什么画面',
      sessionId: 'session-local-video-understand',
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
    expect(createDecision.subdomains).toEqual(['draft'])
    expect(createDecision.selected.has('draftCreate')).toBe(true)
    expect(updateMetaDecision.primaryDomain).toBe('cut')
    expect(updateMetaDecision.subdomains).toEqual(['draft'])
    expect(updateMetaDecision.selected.has('draftUpdateMeta')).toBe(true)
    expect(updateMetaDecision.selected.has('image')).toBe(false)
    expect(inspectDecision.primaryDomain).toBe('cut')
    expect(inspectDecision.subdomains).toEqual(['draft'])
    expect(inspectDecision.selected.has('draftInspect')).toBe(true)
    expect(visualInspectDecision.primaryDomain).toBe('cut')
    expect(visualInspectDecision.subdomains).toEqual(['draft'])
    expect(visualInspectDecision.selected.has('draftInspect')).toBe(true)
    expect(draftDecision.primaryDomain).toBe('cut')
    expect(draftDecision.subdomains).toEqual(['draft'])
    expect(draftDecision.selected.has('draftDownload')).toBe(true)
    expect(draftDecision.preferredMcpTools).toContain('mcp__draft-download__download_draft')
    expect(subtitleTemplateDecision.primaryDomain).toBe('cut')
    expect(subtitleTemplateDecision.subdomains).toEqual(['template'])
    expect(subtitleTemplateDecision.selected.has('subtitleTemplate')).toBe(true)
    expect(subtitleTemplateDecision.selected.has('kouboTemplate')).toBe(false)
    expect(subtitleTemplateDecision.preferredMcpTools).toContain('mcp__subtitle-template__generate_smart_subtitle')
    expect(subtitleRecognitionDecision.primaryDomain).toBe('cut')
    expect(subtitleRecognitionDecision.subdomains).toEqual(['analysis'])
    expect(subtitleRecognitionDecision.selected.has('subtitleRecognition')).toBe(true)
    expect(subtitleRecognitionDecision.selected.has('subtitleTemplate')).toBe(false)
    expect(subtitleRecognitionDecision.selected.has('kouboTemplate')).toBe(false)
    expect(subtitleRecognitionDecision.preferredMcpTools).toContain(
      'mcp__subtitle-recognition__submit_subtitle_recognition_task'
    )
    expect(localSubtitleRecognitionDecision.primaryDomain).toBe('cut')
    expect(localSubtitleRecognitionDecision.subdomains).toEqual(['analysis'])
    expect(localSubtitleRecognitionDecision.selected.has('subtitleRecognition')).toBe(true)
    expect(localSubtitleRecognitionDecision.selected.has('uploadFile')).toBe(true)
    expect(localSubtitleRecognitionDecision.preferredMcpTools).toContain(
      'mcp__subtitle-recognition__submit_subtitle_recognition_task'
    )
    expect(videoUnderstandDecision.primaryDomain).toBe('cut')
    expect(videoUnderstandDecision.subdomains).toEqual(['analysis'])
    expect(videoUnderstandDecision.selected.has('videoUnderstand')).toBe(true)
    expect(videoUnderstandDecision.preferredMcpTools).toContain('mcp__video-understand__submit_video_detail_task')
    expect(localVideoUnderstandDecision.primaryDomain).toBe('cut')
    expect(localVideoUnderstandDecision.subdomains).toEqual(['analysis'])
    expect(localVideoUnderstandDecision.selected.has('videoUnderstand')).toBe(true)
    expect(localVideoUnderstandDecision.selected.has('uploadFile')).toBe(true)
    expect(localVideoUnderstandDecision.preferredMcpTools).toContain('mcp__video-understand__submit_video_detail_task')
    expect(templateDecision.primaryDomain).toBe('cut')
    expect(templateDecision.subdomains).toEqual(['template'])
    expect(templateDecision.selected.has('kouboTemplate')).toBe(true)
    expect(templateDecision.preferredMcpTools).toContain('mcp__koubo-template__submit_koubo_template_task')
  })

  it('allows cut and ai_media domains to combine in the same request', () => {
    const router = new CapabilityRouter()

    const decision = router.select({
      prompt: '创建一个草稿，再把这段文案合成语音，并向草稿里添加一段音频',
      sessionId: 'session-cut-ai-media-combined',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(decision.primaryDomain).toBe('cut')
    expect(decision.subdomains).toEqual(['draft', 'edit'])
    expect(decision.selected.has('draftCreate')).toBe(true)
    expect(decision.selected.has('audioAdd')).toBe(true)
    expect(decision.selected.has('speech')).toBe(true)
    expect(decision.preferredMcpTools).toContain('mcp__draft-management__create_draft')
    expect(decision.preferredMcpTools).toContain('mcp__draft-elements__add_audio')
    expect(decision.preferredMcpTools).toContain('mcp__speech__generate_speech')
    expect(decision.companionDomains).toContain('ai_media')
    expect(decision.activeDomains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'cut',
          role: 'primary',
          subdomains: ['audio_add', 'draft_create']
        }),
        expect.objectContaining({
          domain: 'ai_media',
          role: 'support',
          subdomains: ['speech']
        })
      ])
    )
  })

  it('routes draft element editing and lookup tasks into dedicated cut subdomains', () => {
    const router = new CapabilityRouter()

    const textAddDecision = router.select({
      prompt: '向草稿里添加一段文字',
      sessionId: 'session-text-add',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const textBatchDecision = router.select({
      prompt: '向草稿批量添加多段文字',
      sessionId: 'session-text-add-batch',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const subtitleSrtDecision = router.select({
      prompt: '给这个草稿添加 srt 字幕',
      sessionId: 'session-subtitle-srt',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const fontListDecision = router.select({
      prompt: '查看可用的字体',
      sessionId: 'session-font-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const imageUpdateDecision = router.select({
      prompt: '修改草稿里的图片位置和透明度',
      sessionId: 'session-image-update',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const imageLoopAnimationDecision = router.select({
      prompt: '查看可用的图片循环动画',
      sessionId: 'session-image-loop-animation-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const videoAddDecision = router.select({
      prompt: '向草稿里添加一个视频',
      sessionId: 'session-video-add',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const videoUpdateDecision = router.select({
      prompt: '修改草稿里的一个视频片段',
      sessionId: 'session-video-update',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const videoIntroAnimationDecision = router.select({
      prompt: '查看可用的视频入场动画',
      sessionId: 'session-video-intro-animation-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const transitionTypeDecision = router.select({
      prompt: '查看可用的转场类型',
      sessionId: 'session-transition-type-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const audioAddDecision = router.select({
      prompt: '向草稿里添加一段音频',
      sessionId: 'session-audio-add',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const audioEffectTypeDecision = router.select({
      prompt: '获取可用的音频特效',
      sessionId: 'session-audio-effect-type-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const audioExtractDecision = router.select({
      prompt: '分离视频里的音频',
      sessionId: 'session-audio-extract',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const fileAudioExtractDecision = router.select({
      prompt: '提取直播回放-07月21日.mp4的音频',
      sessionId: 'session-file-audio-extract',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const frameCaptureDecision = router.select({
      prompt: '截取 12.5 秒的帧图片',
      sessionId: 'session-frame-capture',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const mediaDurationDecision = router.select({
      prompt: '获取这个视频的时长',
      sessionId: 'session-media-duration',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const mediaTrimDecision = router.select({
      prompt: '截取 10 秒到 25 秒的视频片段',
      sessionId: 'session-media-trim',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const keyframeAddDecision = router.select({
      prompt: '给这个草稿添加关键帧',
      sessionId: 'session-keyframe-add',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const sceneEffectTypeDecision = router.select({
      prompt: '查看可用的场景特效',
      sessionId: 'session-scene-effect-type-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const filterTypeDecision = router.select({
      prompt: '获取可用的滤镜类型',
      sessionId: 'session-filter-type-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(textAddDecision.primaryDomain).toBe('cut')
    expect(textAddDecision.subdomains).toEqual(['edit'])
    expect(textAddDecision.preferredMcpTools).toContain('mcp__draft-elements__add_text')
    expect(textBatchDecision.primaryDomain).toBe('cut')
    expect(textBatchDecision.subdomains).toEqual(['edit'])
    expect(textBatchDecision.preferredMcpTools).toContain('mcp__draft-elements__add_batch_text')
    expect(subtitleSrtDecision.primaryDomain).toBe('cut')
    expect(subtitleSrtDecision.subdomains).toEqual(['edit'])
    expect(subtitleSrtDecision.preferredMcpTools).toContain('mcp__draft-elements__add_subtitle')
    expect(fontListDecision.primaryDomain).toBe('cut')
    expect(fontListDecision.subdomains).toEqual(['edit'])
    expect(fontListDecision.preferredMcpTools).toContain('mcp__draft-elements__get_font_types')
    expect(imageUpdateDecision.primaryDomain).toBe('cut')
    expect(imageUpdateDecision.subdomains).toEqual(['edit'])
    expect(imageUpdateDecision.preferredMcpTools).toContain('mcp__draft-elements__modify_image')
    expect(imageLoopAnimationDecision.primaryDomain).toBe('cut')
    expect(imageLoopAnimationDecision.subdomains).toEqual(['edit'])
    expect(imageLoopAnimationDecision.preferredMcpTools).toContain('mcp__draft-elements__get_combo_animation_types')
    expect(videoAddDecision.primaryDomain).toBe('cut')
    expect(videoAddDecision.subdomains).toEqual(['edit'])
    expect(videoAddDecision.preferredMcpTools).toContain('mcp__draft-elements__add_video')
    expect(videoUpdateDecision.primaryDomain).toBe('cut')
    expect(videoUpdateDecision.subdomains).toEqual(['edit'])
    expect(videoUpdateDecision.preferredMcpTools).toContain('mcp__draft-elements__modify_video')
    expect(videoIntroAnimationDecision.primaryDomain).toBe('cut')
    expect(videoIntroAnimationDecision.subdomains).toEqual(['edit'])
    expect(videoIntroAnimationDecision.preferredMcpTools).toContain('mcp__draft-elements__get_intro_animation_types')
    expect(transitionTypeDecision.primaryDomain).toBe('cut')
    expect(transitionTypeDecision.subdomains).toEqual(['edit'])
    expect(transitionTypeDecision.preferredMcpTools).toContain('mcp__draft-elements__get_transition_types')
    expect(audioAddDecision.primaryDomain).toBe('cut')
    expect(audioAddDecision.subdomains).toEqual(['edit'])
    expect(audioAddDecision.preferredMcpTools).toContain('mcp__draft-elements__add_audio')
    expect(audioEffectTypeDecision.primaryDomain).toBe('cut')
    expect(audioEffectTypeDecision.subdomains).toEqual(['edit'])
    expect(audioEffectTypeDecision.preferredMcpTools).toContain('mcp__draft-elements__get_audio_effect_types')
    expect(audioExtractDecision.primaryDomain).toBe('cut')
    expect(audioExtractDecision.subdomains).toEqual(['media'])
    expect(audioExtractDecision.preferredMcpTools).toContain('mcp__ffmpeg-media__extract_audio_from_video')
    expect(fileAudioExtractDecision.primaryDomain).toBe('cut')
    expect(fileAudioExtractDecision.subdomains).toEqual(['media'])
    expect(fileAudioExtractDecision.companionDomains).toContain('workspace')
    expect(fileAudioExtractDecision.activeDomains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'cut',
          role: 'primary',
          subdomains: ['audio_extract']
        }),
        expect.objectContaining({
          domain: 'workspace',
          role: 'support',
          subdomains: expect.arrayContaining(['read'])
        })
      ])
    )
    expect(fileAudioExtractDecision.preferredMcpTools).toContain('mcp__ffmpeg-media__extract_audio_from_video')
    expect(frameCaptureDecision.primaryDomain).toBe('cut')
    expect(frameCaptureDecision.subdomains).toEqual(['media'])
    expect(frameCaptureDecision.preferredMcpTools).toContain('mcp__ffmpeg-media__capture_frame_at_timestamp')
    expect(mediaDurationDecision.primaryDomain).toBe('cut')
    expect(mediaDurationDecision.subdomains).toEqual(['media'])
    expect(mediaDurationDecision.preferredMcpTools).toContain('mcp__ffmpeg-media__get_media_duration')
    expect(mediaTrimDecision.primaryDomain).toBe('cut')
    expect(mediaTrimDecision.subdomains).toEqual(['media'])
    expect(mediaTrimDecision.preferredMcpTools).toContain('mcp__ffmpeg-media__trim_media_segment')
    expect(keyframeAddDecision.primaryDomain).toBe('cut')
    expect(keyframeAddDecision.subdomains).toEqual(['edit'])
    expect(keyframeAddDecision.preferredMcpTools).toContain('mcp__draft-elements__add_video_keyframe')
    expect(sceneEffectTypeDecision.primaryDomain).toBe('cut')
    expect(sceneEffectTypeDecision.subdomains).toEqual(['edit'])
    expect(sceneEffectTypeDecision.preferredMcpTools).toContain('mcp__draft-elements__get_video_scene_effect_types')
    expect(filterTypeDecision.primaryDomain).toBe('cut')
    expect(filterTypeDecision.subdomains).toEqual(['edit'])
    expect(filterTypeDecision.preferredMcpTools).toContain('mcp__draft-elements__get_filter_types')
    expect(imageUpdateDecision.selected.has('image')).toBe(false)
    expect(audioAddDecision.selected.has('speech')).toBe(false)
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
    expect(buildToolSurface({ decision: memoryDecision, isAssistant: false }).builtinTools).toEqual([
      'InspectImage',
      'AskUserQuestion'
    ])
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

  it('routes skill management prompts into search/list/register subdomains', () => {
    const router = new CapabilityRouter()

    const searchDecision = router.select({
      prompt: '搜索现成技能看看有没有儿童绘本',
      sessionId: 'session-skill-search',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const listDecision = router.select({
      prompt: '查看当前有哪些技能',
      sessionId: 'session-skill-list',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })
    const registerDecision = router.select({
      prompt: '帮我注册这个技能',
      sessionId: 'session-skill-register',
      imageCount: 0,
      isAssistant: false,
      autonomousEnabled: false,
      hasCustomMcpServers: false
    })

    expect(searchDecision.primaryDomain).toBe('skills')
    expect(searchDecision.subdomains).toEqual(['search_skill'])
    expect(listDecision.primaryDomain).toBe('skills')
    expect(listDecision.subdomains).toEqual(['list_skill'])
    expect(registerDecision.primaryDomain).toBe('skills')
    expect(registerDecision.subdomains).toEqual(['register_skill'])
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

    expect(webSurface.builtinTools).toEqual(expect.arrayContaining(['InspectImage', 'AskUserQuestion', 'WebSearch']))
    expect(workspaceSurface.builtinTools).toEqual(
      expect.arrayContaining(['InspectImage', 'AskUserQuestion', 'Read', 'Bash', 'Write', 'Edit', 'MultiEdit'])
    )
    expect(mixedSurface.builtinTools).toEqual(
      expect.arrayContaining(['InspectImage', 'AskUserQuestion', 'Read', 'Bash', 'WebSearch'])
    )
  })
})
