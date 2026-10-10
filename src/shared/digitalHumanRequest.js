const MODE_ALIASES = {
  'lip-sync': 'lip_sync',
  lip_sync: 'lip_sync',
  lips: 'lip_sync',
  'jimeng-avatar': 'omni',
  omni: 'omni',
  'seedance-avatar': 'seedance',
  seedance: 'seedance',
};
const DIGITAL_HUMAN_PACKAGING_AGENT_IDS = {
  knowledge_pip: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
  traditional_bilingual: 'koubo_cbbe5e6b468844e782c961fd9ee07b7d',
  national_classic: 'koubo_d8b7f9e05c4a11efb9620242ac120003',
  basic_yellow_white: 'koubo_b82feeb636f3476a9a752ebd745d9750',
  classic_grass_green: 'koubo_a3d4f6b8c1e24f7b9a0d5e6c8f2b1a97',
  international_orange_bilingual: 'koubo_e7c1a9d4b6f24c8e91a3d5b7f0c2e6a8',
  eye_catching_green_bilingual: 'koubo_39ff88a1b2c34d5e9f0a6b7c8d9e0123',
  intellectual_red: 'koubo_f47ac10b58cc4372a5670e02b2c3d479',
  classical_dark_brown: 'koubo_7b2f0c9d4e6a41f8b3c5d7e9a1b2c4d6',
  fisheye_ins: 'koubo_5e7a9c3d1f2b4a6e8c0d5f7b9e1a3c6d',
  luxury_white_bilingual: 'koubo_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13',
};
const DIGITAL_HUMAN_PACKAGING_TEMPLATES = new Set(Object.keys(DIGITAL_HUMAN_PACKAGING_AGENT_IDS));

export const normalizeDigitalHumanMode = (value = '') => (
  MODE_ALIASES[String(value || '').trim()] || ''
);

export const normalizeDigitalHumanRequestPayload = (request = {}, fallbackCopywriting = '') => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;

  const mode = normalizeDigitalHumanMode(request.mode);
  const copywriting = String(request.copywriting || request.text || fallbackCopywriting || '').trim();
  const voiceId = String(request.voice_id || request.voiceId || '').trim();
  const voiceProvider = String(request.voice_provider || request.voiceProvider || request.provider || '').trim();
  const imageUrl = String(request.image_url || request.imageUrl || '').trim();
  const videoUrl = String(request.video_url || request.videoUrl || '').trim();
  const prompt = String(request.prompt || '').trim();
  const packagingTemplate = String(request.packaging_template || request.packagingTemplate || '').trim();
  const outputResolution = Number(request.output_resolution ?? request.outputResolution);

  if (!mode || !copywriting || !voiceId) return null;
  if (mode === 'lip_sync' && !videoUrl) return null;
  if ((mode === 'omni' || mode === 'seedance') && !imageUrl) return null;

  return {
    mode,
    copywriting,
    voice_id: voiceId,
    ...(voiceProvider ? { voice_provider: voiceProvider } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(videoUrl ? { video_url: videoUrl } : {}),
    ...(prompt ? { prompt } : {}),
    ...(DIGITAL_HUMAN_PACKAGING_TEMPLATES.has(packagingTemplate)
      ? { packaging_template: packagingTemplate }
      : {}),
    ...(mode === 'omni' && (outputResolution === 720 || outputResolution === 1080)
      ? { output_resolution: outputResolution }
      : {}),
  };
};

export const buildDigitalHumanRequestTextPrompt = (request = {}) => {
  const normalized = normalizeDigitalHumanRequestPayload(request, request?.copywriting);
  if (!normalized) return '';

  const modeLabel = { lip_sync: '口型驱动', omni: '即梦图片驱动', seedance: '图片驱动' }[normalized.mode];
  const toolName = {
    lip_sync: 'create_lip_sync_digital_human',
    omni: 'create_omni_image_driven_digital_human',
    seedance: 'create_seedance_digital_human',
  }[normalized.mode];
  return [
    `请生成${modeLabel}数字人视频${normalized.packaging_template ? '，完成智能包装并导出成片' : ''}。`,
    `说话内容：${normalized.copywriting}`,
    `音色ID：${normalized.voice_id}`,
    normalized.mode === 'lip_sync'
      ? `人物视频：${normalized.video_url}`
      : `人物图片：${normalized.image_url}`,
    normalized.mode === 'omni' ? `人物动作：${normalized.prompt}` : '',
    normalized.mode === 'omni' ? `输出分辨率：${normalized.output_resolution || 1080}p` : '',
    `执行步骤：先调用 digital-human 的 ${toolName}，原样使用上述文案、音色及人物素材。工具内置语音合成并等待最终视频，不要单独合成语音或重复提交。`,
    normalized.packaging_template
      ? [
        `智能包装：${normalized.packaging_template}`,
        `生成成功后，调用 koubo-template 的 submit_koubo_template_task，template="${normalized.packaging_template}"，videoUrl 使用刚生成的数字人视频（不是原人物视频），textContent 原样传入上述说话内容，params={"remove_silence":false}，不剪气口。`,
        '等待包装完成，取得 output.draft_id 或 draft_id 后，调用 draft-download 的 export_draft，传入该草稿的 draftId 自动导出，返回视频、包装草稿和导出结果。',
        '生成失败不继续包装；包装失败保留生成视频并说明原因。不要虚构执行结果。',
      ].join('\n')
      : '未选择智能包装，直接返回生成的视频，不调用模板包装或草稿导出。',
  ].filter(Boolean).join('\n');
};

export const buildDigitalHumanRequestAgentPrompt = (request = {}, messageId = '') => {
  const normalized = normalizeDigitalHumanRequestPayload(request, request?.copywriting);
  if (!normalized) return '';

  const requestKey = String(messageId || request.requestId || JSON.stringify(normalized));
  let hash = 2166136261;
  for (let index = 0; index < requestKey.length; index += 1) {
    hash = Math.imul(hash ^ requestKey.charCodeAt(index), 16777619);
  }
  const requestId = `digital-human-${String(messageId || request.requestId || (hash >>> 0).toString(16))}`;
  const args = {
    requestId,
    mode: normalized.mode,
    copywriting: normalized.copywriting,
    voiceId: normalized.voice_id,
    ...(normalized.voice_provider ? { provider: normalized.voice_provider } : {}),
    ...(normalized.mode === 'lip_sync'
      ? { videoUrl: normalized.video_url }
      : { imageUrl: normalized.image_url }),
    ...(normalized.mode === 'omni'
      ? { prompt: normalized.prompt || '', outputResolution: normalized.output_resolution || 1080 }
      : {}),
  };
  const steps = [
    '使用 vectcut MCP 工具执行以下数字人任务，请实际调用工具，不要只返回操作说明。',
    '1. 调用 digital-human 的异步启动工具 start_digital_human_task（mcp__vectcut__digital-human__start_digital_human_task），文案和音色 ID 原样使用。',
    `参数：\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``,
    '启动立即返回 job_id，语音合成、上传和生成在后台完成，不要额外合成语音。不要使用阻塞式 create_* 数字人工具。',
    '保存 job_id，调用 digital-human.get_digital_human_job（mcp__vectcut__digital-human__get_digital_human_job），参数 {"jobId":"<上一步 job_id>"}。running 时按 poll_after_seconds 等待后继续查询，直到 success，使用 result.video_url。数字人预计需要 15–30 分钟，不要把几次未完成当作失败。',
    '启动超时后使用完全相同的 requestId 和参数重试，不能换 ID；查询超时只重试查询。failed/interrupted 时检查 message 和 task_id，不要重新创建。不要将服务端 task_id 当作本地 jobId。',
  ];
  if (normalized.packaging_template) {
    steps.push(
      '2. 数字人 job.status=success 后，取 result.video_url，调用 koubo-template 的 start_koubo_template_job（mcp__vectcut__koubo-template__start_koubo_template_job）。以下 videoUrl 必须替换为生成结果，不能使用原人物视频；不要调用阻塞式 submit_koubo_template_task。',
      `参数：\n\`\`\`json\n${JSON.stringify({
        requestId: `${requestId}-packaging`,
        template: normalized.packaging_template,
        videoUrl: '<generated_digital_human_url>',
        textContent: normalized.copywriting,
        params: { remove_silence: false },
      }, null, 2)}\n\`\`\``,
      '保存包装 job_id，调用 koubo-template.get_koubo_template_job（mcp__vectcut__koubo-template__get_koubo_template_job），参数 {"jobId":"<包装 job_id>"}。running 时按 poll_after_seconds 等待后查询；success 后取 result.output.draft_id 或 result.draft_id，调用 draft-download.export_draft，传入 {"draftId":"<包装结果的 draft_id>"} 自动导出。包装启动超时复用上述 requestId，不重复提交。保留原文案，不剪气口。',
      '3. 返回真实的数字人视频、包装草稿和导出结果。生成失败时不要继续包装；包装失败时保留已生成的视频并说明失败原因。',
    );
  } else {
    steps.push('2. 未选择智能包装，不调用口播模板或草稿导出工具，直接返回生成的视频链接。');
  }
  steps.push('若工具或素材不可访问，请明确说明缺少的能力或资源，不要虚构视频、草稿或执行结果。');
  return steps.join('\n\n');
};

const buildApiCurl = (endpoint, payload) => [
  `curl --location 'https://open.vectcut.com${endpoint}' \\`,
  "--header 'Authorization: Bearer <token>' \\",
  "--header 'Content-Type: application/json' \\",
  `--data '${JSON.stringify(payload, null, 4).replace(/'/g, "'\\''")}'`,
].join('\n');

export const buildDigitalHumanRequestApiCurl = (request = {}) => {
  const normalized = normalizeDigitalHumanRequestPayload(request, request?.copywriting);
  if (!normalized) return '';

  const config = normalized.mode === 'lip_sync'
    ? {
      endpoint: '/cut_jianying/digital_human/create',
      statusEndpoint: '/cut_jianying/digital_human/task_status',
      statusDoc: 'https://docs.vectcut.com/404756745e0',
      completion: '取得非空 digital_human_url；若响应包含 task_status，必须等 task_status=1 后使用该视频，不能使用中间结果。',
      payload: {
        audio_url: '<generated_audio_url>',
        video_url: normalized.video_url,
      },
    }
    : normalized.mode === 'seedance'
      ? {
        endpoint: '/llm/digital_human/seedance/submit',
        statusEndpoint: '/llm/digital_human/seedance/task_status',
        statusDoc: 'https://docs.vectcut.com/475739920e0',
        completion: '等待 status=success 且 result.video_url 非空，使用 result.video_url。',
        payload: {
          image_url: normalized.image_url,
          copywriting: normalized.copywriting,
          voice_id: normalized.voice_id,
        },
      }
      : {
        endpoint: '/cut_jianying/digital_human/omni/submit',
        statusEndpoint: '/cut_jianying/digital_human/omni/task_status',
        statusDoc: 'https://docs.vectcut.com/468131524e0',
        completion: '等待成功状态（success/succeeded/completed）及非空 video_url 或 digital_human_url；响应无状态字段时以非空最终视频 URL 为准。',
        payload: {
          audio_url: '<generated_audio_url>',
          image_url: normalized.image_url,
          prompt: normalized.prompt,
          output_resolution: normalized.output_resolution === 720 ? 720 : 1080,
        },
      };

  const stages = [
    '# 1. 提交数字人生成任务。audio_url 如为占位，先用所选音色合成原文案并替换。',
    buildApiCurl(config.endpoint, config.payload),
    '# 2. 将 <digital_human_task_id> 替换为生成接口返回的 task_id（不是 MCP 本地 job_id），每 5 秒查询一次，不要重复提交生成。',
    `# 状态查询文档：${config.statusDoc}`,
    [
      `curl --location 'https://open.vectcut.com${config.statusEndpoint}?task_id=<digital_human_task_id>' \\`,
      "--header 'Authorization: Bearer <token>'",
    ].join('\n'),
    `# 完成条件：${config.completion} 未完成则继续等待；failed/error/cancelled/not_found 或 HTTP 404 时停止并检查 error/message，不继续包装。`,
  ];
  if (!normalized.packaging_template) {
    return [...stages, '# 成功后返回最终视频 URL；未选择智能包装，不调用包装接口。'].join('\n\n');
  }

  return [...stages,
    '# 3. 智能包装：将 <generated_digital_human_url> 替换为状态查询返回的最终数字人视频，不是原人物视频；仅在数字人生成成功后执行。',
    '# API 文档：https://docs.vectcut.com/430815760e0',
    buildApiCurl('/cut_jianying/agent/submit_agent_task', {
      agent_id: DIGITAL_HUMAN_PACKAGING_AGENT_IDS[normalized.packaging_template],
      params: {
        video_url: ['<generated_digital_human_url>'],
        text_content: normalized.copywriting,
        remove_silence: false,
      },
    }),
    '# 4. 将 <packaging_task_id> 替换为包装提交响应的 task_id，每 5 秒查询一次；processing 继续等待，failed 停止并检查 error/message。',
    [
      "curl --location 'https://open.vectcut.com/cut_jianying/agent/task_status?task_id=<packaging_task_id>' \\",
      "--header 'Authorization: Bearer <token>'",
    ].join('\n'),
    '# status=success 后取 output.draft_id；这表示草稿完成，不代表已导出视频。如需成片，再调用 generate_video 渲染该草稿。',
  ].join('\n\n');
};
