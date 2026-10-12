import { describe, expect, it } from 'vitest';
import {
  buildVideoUnderstandRequest, buildVideoUnderstandBlocks, getVideoUnderstandSendState,
  normalizeVideoUnderstandRequest, parseVideoUnderstandResult, VIDEO_UNDERSTAND_TOOL,
} from './videoUnderstand';

describe('逐帧拉片请求', () => {
  it('保留本地视频路径，不传 blob 预览地址', () => {
    expect(buildVideoUnderstandRequest({ uploadedFiles: [
      { uid: 'v', name: 'video.mp4', fileType: 'video/mp4', sourcePath: '/tmp/video.mp4', previewUrl: 'blob:preview' },
      { uid: 'i', name: 'image.png', fileType: 'image/png', sourcePath: '/tmp/image.png' },
    ] })).toEqual({ videoUrls: ['/tmp/video.mp4'], prompt: '' });
  });
  it('接受直接视频链接和分享文案，去除中文句末标点', () => {
    expect(buildVideoUnderstandRequest({ input: '分析镜头 https://v.douyin.com/abc/。' }))
      .toEqual({ videoUrls: ['https://v.douyin.com/abc/'], prompt: '分析镜头' });
  });
  it('支持无原生路径附件落盘占位和 Windows 路径', () => {
    expect(buildVideoUnderstandRequest({ uploadedFiles: [{ uid: 'v', name: 'video.mp4' }] }).videoUrls)
      .toEqual(['local-attachment:v']);
    expect(normalizeVideoUnderstandRequest({ videoUrl: 'C:\\videos\\a.mp4' }).videoUrls)
      .toEqual(['C:\\videos\\a.mp4']);
  });
  it('拒绝空输入、纯文字或图片附件', () => {
    for (const context of [{}, { input: '分析一下' }, { uploadedFiles: [{ fileType: 'image/png' }] }]) {
      expect(getVideoUnderstandSendState(context).canSend).toBe(false);
    }
  });
  it('进度卡片使用实际视频理解工具及稳定 ID', () => {
    const block = buildVideoUnderstandBlocks({ assistantMessageId: 'a', requestId: 'r', request: {} })[0];
    expect(block.toolName).toBe(VIDEO_UNDERSTAND_TOOL);
    expect(block.toolId).toBe('video_understand_request_r');
    expect(block.metadata.rawMcpToolResponse.tool.name).toBe(VIDEO_UNDERSTAND_TOOL);
  });
  it('仅输出摘要和文件路径，不展开时间线详情', () => {
    const response = { billing: { total_consumed_points: 1.2 },
      result_files: [{ kind: 'aggregate_result', file_path: '/workspace/all.md' }], videos: [
      { analysis: { title: '镜头', summary: '摘要', details: '0~0.3秒的内容：人物走动' } },
    ] };
    const parsed = parseVideoUnderstandResult({ content: [{ type: 'text', text: JSON.stringify(response) }] });
    expect(parsed.assistantText).not.toContain('0~0.3秒的内容：人物走动');
    expect(parsed.assistantText).toContain('摘要');
    expect(parsed.assistantText).toContain('/workspace/all.md');
    expect(parsed.response).toEqual({ billing: response.billing, result_files: response.result_files });
  });
  it('100 个视频只展示前 5 个精简摘要和汇总文件', () => {
    const response = {
      total_video_count: 100,
      video_summaries: Array.from({ length: 100 }, (_, index) => ({
        video_index: index + 1, title: `镜头 ${index + 1}`, summary: '摘要'.repeat(500),
      })),
      result_files: [
        { kind: 'result_index', file_path: '/workspace/index.md' },
        { kind: 'aggregate_result', file_path: '/workspace/all.md' },
        ...Array.from({ length: 100 }, (_, index) => ({
          kind: 'video_result', file_path: `/workspace/video-${index + 1}.md`,
        })),
      ],
      artifact: { file_path: '/workspace/result.json' },
    };
    const parsed = parseVideoUnderstandResult({ content: [{ type: 'text', text: JSON.stringify(response) }] });
    expect(parsed.assistantText).toContain('已完成 100 个视频');
    expect(parsed.assistantText).toContain('视频 5：');
    expect(parsed.assistantText).not.toContain('视频 6：');
    expect(parsed.assistantText).not.toContain('/workspace/video-');
    expect(parsed.assistantText).toContain('/workspace/index.md');
    expect(parsed.assistantText).toContain('/workspace/result.json');
    expect(parsed.assistantText.length).toBeLessThan(2100);
  });
  it('仅返回文件索引也能正常展示', () => {
    const parsed = parseVideoUnderstandResult({ content: [{ type: 'text', text: JSON.stringify({
      total_video_count: 100,
      result_files: [{ kind: 'result_index', file_path: '/workspace/index.md' }],
    }) }] });
    expect(parsed.assistantText).toContain('已完成 100 个视频');
    expect(parsed.assistantText).toContain('/workspace/index.md');
  });
  it('对话显示无人声标注但不展开识别文本', () => {
    const parsed = parseVideoUnderstandResult({ content: [{ type: 'text', text: JSON.stringify({
      total_video_count: 1,
      video_summaries: [{
        video_index: 1, summary: '画面摘要', speech_status: 'no_speech',
        speech_message: '未检测到可识别的人声（对白或画外音）',
      }],
      result_files: [{ kind: 'result_index', file_path: '/workspace/index.md' }],
    }) }] });
    expect(parsed.assistantText).toContain('语音字幕：未检测到可识别的人声');
  });
  it('失败保留已经发生的计费', () => {
    try {
      parseVideoUnderstandResult({ isError: true, content: [
        { type: 'text', text: '{"error":"分析失败","billing":{"total_consumed_points":0.1}}' },
      ] });
      throw new Error('Expected failure');
    } catch (error) {
      expect(error.toolResponse.billing.total_consumed_points).toBe(0.1);
    }
  });
});
