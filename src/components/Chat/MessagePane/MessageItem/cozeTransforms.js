const COZE_WORKFLOW_SOURCE = {
  workflowId: '7668682150007488554',
  flowMode: 0,
  spaceId: '7472683780642258985',
  isDouyin: false,
  host: 'www.coze.cn'
};

const COZE_CREATE_DRAFT_PLUGIN_META = {
  apiID: '7579582015465537536',
  apiName: 'create_draft',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_CREATE_DRAFT_NODE_META = {
  title: 'create_draft',
  icon: 'https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/f9322fc2b09d43909b6cf1d9af1fd4c4~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1791638762&x-signature=qWXAQDZ7A1uUbERLe9BSCpaXHpc%3D',
  subtitle: '流光剪辑_剪映草稿助手(会员版):create_draft',
  description: '创建一个剪映草稿'
};

const COZE_CREATE_DRAFT_EXTERNAL_DATA = {
  icon: '`https://lf9-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1791639443&x-signature=hXnFhPi4f1BdMaWjzHSE4zSpjR8%3D`',
  apiName: 'create_draft',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '封面图', input: {}, name: 'cover', required: false, type: 'string' },
    { defaultValue: 1920, description: '画布高度，像素值, default value is 1920', input: {}, name: 'height', required: false, type: 'integer' },
    { description: '草稿名称', input: {}, name: 'name', required: false, type: 'string' },
    { defaultValue: 1080, description: '画布宽度，像素值, default value is 1080', input: {}, name: 'width', required: false, type: 'integer' }
  ],
  outputs: [
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { description: '草稿id，基于这个草稿继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
        { description: '草稿链接，复制到浏览器里打开可以预览', input: {}, name: 'draft_url', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' },
    { input: {}, name: 'success', required: false, type: 'boolean' },
    { input: {}, name: 'error', required: false, type: 'string' }
  ],
  updateTime: 1788775427,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '创建一个剪映草稿',
  title: 'create_draft',
  mainColor: '#CA61FF'
};

const COZE_MODIFY_DRAFT_PLUGIN_META = {
  apiID: '7647446239436423204',
  apiName: 'modify_draft',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_MODIFY_DRAFT_NODE_META = {
  title: 'modify_draft',
  icon: '`https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/f9322fc2b09d43909b6cf1d9af1fd4c4~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1791638762&x-signature=qWXAQDZ7A1uUbERLe9BSCpaXHpc%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):modify_draft',
  description: '修改已有草稿'
};

const COZE_MODIFY_DRAFT_EXTERNAL_DATA = {
  icon: '`https://lf26-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1791640107&x-signature=pEYSsx8omskxrL2vd2DIH8y2%2FWo%3D`',
  apiName: 'modify_draft',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '草稿名', input: {}, name: 'name', required: false, type: 'string' },
    { description: '封面图', input: {}, name: 'cover', required: false, type: 'string' },
    { description: '草稿id', input: {}, name: 'draft_id', required: true, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'error', required: false, type: 'string' },
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { input: {}, name: 'draft_url', required: false, type: 'string' },
        { input: {}, name: 'draft_id', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' },
    { input: {}, name: 'success', required: false, type: 'boolean' }
  ],
  updateTime: 1788775427,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '修改已有草稿',
  title: 'modify_draft',
  mainColor: '#CA61FF'
};

const COZE_ADD_TEXT_PLUGIN_META = {
  apiID: '7579582015465472000',
  apiName: 'add_text',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_ADD_TEXT_NODE_META = {
  title: 'add_text',
  icon: '`https://p6-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/f9322fc2b09d43909b6cf1d9af1fd4c4~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1792118381&x-signature=s0yOYPrnva15unvuNjypf4tacwc%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):add_text',
  description: '添加文字'
};

const COZE_ADD_TEXT_EXTERNAL_DATA = {
  icon: '`https://lf9-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1792119479&x-signature=x5Gdzmeygetf0b6mMVtJB6N%2BrAI%3D`',
  apiName: 'add_text',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '草稿id，可以继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '文本', input: {}, name: 'text', required: true, type: 'string' },
    { description: '开始时间', input: {}, name: 'start', required: true, type: 'float' },
    { description: '结束时间', input: {}, name: 'end', required: true, type: 'float' },
    { description: '字体', input: {}, name: 'font', required: false, type: 'string' },
    { description: '字体大小', input: {}, name: 'font_size', required: false, type: 'float' },
    { description: '字体颜色', input: {}, name: 'font_color', required: false, type: 'string' },
    { description: '字间距', input: {}, name: 'letter_spacing', required: false, type: 'float' },
    { description: '行间距', input: {}, name: 'line_spacing', required: false, type: 'float' },
    { description: '是否加粗', input: {}, name: 'bold', required: false, type: 'boolean' },
    { description: '是否斜体', input: {}, name: 'italic', required: false, type: 'boolean' },
    { description: '是否下划线', input: {}, name: 'underline', required: false, type: 'boolean' },
    { description: '是否竖排', input: {}, name: 'vertical', required: false, type: 'boolean' },
    { description: '对齐方式', input: {}, name: 'align', required: false, type: 'integer' },
    { description: 'X 方向缩放', input: {}, name: 'scale_x', required: false, type: 'float' },
    { description: 'Y 方向缩放', input: {}, name: 'scale_y', required: false, type: 'float' },
    { description: 'X 方向像素位移', input: {}, name: 'transform_x_px', required: false, type: 'integer' },
    { description: 'Y 方向像素位移', input: {}, name: 'transform_y_px', required: false, type: 'integer' },
    { description: '固定宽度像素值', input: {}, name: 'fixed_width_px', required: false, type: 'integer' },
    { description: '固定高度像素值', input: {}, name: 'fixed_height_px', required: false, type: 'integer' },
    { description: '旋转角度', input: {}, name: 'rotation', required: false, type: 'float' },
    { description: '轨道名', input: {}, name: 'track_name', required: false, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'success', required: false, type: 'boolean' },
    { input: {}, name: 'error', required: false, type: 'string' },
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { description: '草稿id，可以继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
        { description: '草稿链接，在浏览器里打开可以预览', input: {}, name: 'draft_url', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' }
  ],
  updateTime: 1789520259,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '添加文字',
  title: 'add_text',
  mainColor: '#CA61FF'
};

const createLiteralValue = (content) => ({
  type: 'literal',
  content,
  rawMeta: {
    type: 1
  }
});

const createInputParameter = (name, type, content) => ({
  name,
  input: {
    type,
    value: createLiteralValue(content)
  }
});

const createApiParamEntries = (pluginMeta) => (
  Object.entries(pluginMeta).map(([name, content]) => (
    createInputParameter(name, 'string', content)
  ))
);

const createDraftRequestInputParameters = (draftRequest = {}) => {
  const width = Number(draftRequest?.width || 1080) || 1080;
  const height = Number(draftRequest?.height || 1920) || 1920;
  const name = String(draftRequest?.name || '').trim();
  const cover = String(draftRequest?.cover || '').trim();

  return [
    createInputParameter('cover', 'string', cover),
    createInputParameter('height', 'integer', height),
    createInputParameter('name', 'string', name),
    createInputParameter('width', 'integer', width)
  ];
};

export const buildDraftRequestCozeClipboardData = (draftRequest = {}) => {
  const inputParameters = createDraftRequestInputParameters(draftRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      ...COZE_WORKFLOW_SOURCE
    },
    json: {
      nodes: [
        {
          id: '127143',
          type: '4',
          meta: {
            position: {
              x: 340.53846153846155,
              y: -227.5
            }
          },
          data: {
            nodeMeta: {
              ...COZE_CREATE_DRAFT_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_CREATE_DRAFT_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_id', required: false, description: '草稿id，基于这个草稿继续编辑' },
                  { type: 'string', name: 'draft_url', required: false, description: '草稿链接，复制到浏览器里打开可以预览' }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false },
              { type: 'boolean', name: 'success', required: false },
              { type: 'string', name: 'error', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: 160.53846153846155,
              y: -227.5,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_CREATE_DRAFT_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 160.53846153846155,
      y: -227.5,
      width: 360,
      height: 112
    }
  }, null, 2);
};

const createDraftModifyRequestInputParameters = (draftModifyRequest = {}) => {
  const draftId = String(draftModifyRequest?.draftId || draftModifyRequest?.draft_id || '').trim();
  const name = String(draftModifyRequest?.name || '').trim();
  const cover = String(draftModifyRequest?.cover || '').trim();
  const parameters = [createInputParameter('draft_id', 'string', draftId)];

  if (name) {
    parameters.push(createInputParameter('name', 'string', name));
  }
  if (cover) {
    parameters.push(createInputParameter('cover', 'string', cover));
  }

  return parameters;
};

const createTextAddRequestInputParameters = (textAddRequest = {}) => {
  const draftId = String(textAddRequest?.draft_id || textAddRequest?.draftId || '').trim();
  const text = String(textAddRequest?.text || '').trim();
  const start = Number(textAddRequest?.start || 0) || 0;
  const end = Number(textAddRequest?.end || 3) || 3;
  const font = String(textAddRequest?.font || '').trim();
  const fontSize = Number(textAddRequest?.font_size ?? textAddRequest?.fontSize);
  const fontColor = String(textAddRequest?.font_color || textAddRequest?.fontColor || '').trim();
  const letterSpacing = Number(textAddRequest?.letter_spacing ?? textAddRequest?.letterSpacing);
  const lineSpacing = Number(textAddRequest?.line_spacing ?? textAddRequest?.lineSpacing);
  const scaleX = Number(textAddRequest?.scale_x ?? textAddRequest?.scaleX);
  const scaleY = Number(textAddRequest?.scale_y ?? textAddRequest?.scaleY);
  const transformXPx = Number(textAddRequest?.transform_x_px ?? textAddRequest?.transformXPx);
  const transformYPx = Number(textAddRequest?.transform_y_px ?? textAddRequest?.transformYPx);
  const fixedWidthPx = Number(textAddRequest?.fixed_width_px ?? textAddRequest?.fixedWidthPx ?? textAddRequest?.fixed_width ?? textAddRequest?.fixedWidth);
  const fixedHeightPx = Number(textAddRequest?.fixed_height_px ?? textAddRequest?.fixedHeightPx ?? textAddRequest?.fixed_height ?? textAddRequest?.fixedHeight);
  const rotation = Number(textAddRequest?.rotation);
  const trackName = String(textAddRequest?.track_name || textAddRequest?.trackName || '').trim();
  const parameters = [
    createInputParameter('draft_id', 'string', draftId),
    createInputParameter('text', 'string', text),
    createInputParameter('start', 'float', start),
    createInputParameter('end', 'float', end)
  ];
  if (font) parameters.push(createInputParameter('font', 'string', font));
  if (Number.isFinite(fontSize) && fontSize > 0) parameters.push(createInputParameter('font_size', 'float', fontSize));
  if (fontColor) parameters.push(createInputParameter('font_color', 'string', fontColor));
  if (Number.isFinite(letterSpacing)) parameters.push(createInputParameter('letter_spacing', 'float', letterSpacing));
  if (Number.isFinite(lineSpacing)) parameters.push(createInputParameter('line_spacing', 'float', lineSpacing));
  if (typeof textAddRequest?.bold === 'boolean') parameters.push(createInputParameter('bold', 'boolean', textAddRequest.bold));
  if (typeof textAddRequest?.italic === 'boolean') parameters.push(createInputParameter('italic', 'boolean', textAddRequest.italic));
  if (typeof textAddRequest?.underline === 'boolean') parameters.push(createInputParameter('underline', 'boolean', textAddRequest.underline));
  if (typeof textAddRequest?.vertical === 'boolean') parameters.push(createInputParameter('vertical', 'boolean', textAddRequest.vertical));
  if (Number.isInteger(Number(textAddRequest?.align))) parameters.push(createInputParameter('align', 'integer', Number(textAddRequest.align)));
  if (Number.isFinite(scaleX)) parameters.push(createInputParameter('scale_x', 'float', scaleX));
  if (Number.isFinite(scaleY)) parameters.push(createInputParameter('scale_y', 'float', scaleY));
  if (Number.isFinite(transformXPx)) parameters.push(createInputParameter('transform_x_px', 'integer', transformXPx));
  if (Number.isFinite(transformYPx)) parameters.push(createInputParameter('transform_y_px', 'integer', transformYPx));
  if (Number.isFinite(fixedWidthPx)) parameters.push(createInputParameter('fixed_width_px', 'integer', fixedWidthPx));
  if (Number.isFinite(fixedHeightPx)) parameters.push(createInputParameter('fixed_height_px', 'integer', fixedHeightPx));
  if (Number.isFinite(rotation)) parameters.push(createInputParameter('rotation', 'float', rotation));
  if (trackName) parameters.push(createInputParameter('track_name', 'string', trackName));
  return parameters;
};

export const buildDraftModifyRequestCozeClipboardData = (draftModifyRequest = {}) => {
  const inputParameters = createDraftModifyRequestInputParameters(draftModifyRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      ...COZE_WORKFLOW_SOURCE
    },
    json: {
      nodes: [
        {
          id: '199017',
          type: '4',
          meta: {
            position: {
              x: 1020.0388069319126,
              y: 112.86787670007338
            }
          },
          data: {
            nodeMeta: {
              ...COZE_MODIFY_DRAFT_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_MODIFY_DRAFT_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              { type: 'string', name: 'error', required: false },
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_url', required: false },
                  { type: 'string', name: 'draft_id', required: false }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false },
              { type: 'boolean', name: 'success', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: 840.0388069319126,
              y: 112.86787670007338,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_MODIFY_DRAFT_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 840.0388069319126,
      y: 112.86787670007338,
      width: 360,
      height: 112.00000000000001
    }
  }, null, 2);
};

export const buildTextAddRequestCozeClipboardData = (textAddRequest = {}) => {
  const inputParameters = createTextAddRequestInputParameters(textAddRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7684115562197712911',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '197345',
          type: '4',
          meta: {
            position: {
              x: 1072.2094926350246,
              y: 143.43815504513285
            }
          },
          data: {
            nodeMeta: {
              ...COZE_ADD_TEXT_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_ADD_TEXT_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              { type: 'boolean', name: 'success', required: false },
              { type: 'string', name: 'error', required: false },
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_id', required: false, description: '草稿id，可以继续编辑' },
                  { type: 'string', name: 'draft_url', required: false, description: '草稿链接，在浏览器里打开可以预览' }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: 892.2094926350246,
              y: 143.43815504513285,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_ADD_TEXT_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 892.2094926350246,
      y: 143.43815504513285,
      width: 360,
      height: 112
    }
  }, null, 2);
};
