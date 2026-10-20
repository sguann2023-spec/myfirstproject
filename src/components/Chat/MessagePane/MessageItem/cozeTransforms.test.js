import { describe, expect, it } from 'vitest';
import {
  buildDigitalHumanRequestCozeClipboardData,
  buildImageAddRequestCozeClipboardData,
  isDigitalHumanRequestCozeSupported
} from './cozeTransforms';

const findParameter = (parameters, name) => (
  parameters.find((parameter) => parameter.name === name)
);

describe('buildDigitalHumanRequestCozeClipboardData', () => {
  it('only enables the Coze view for lip-sync requests', () => {
    expect(isDigitalHumanRequestCozeSupported({ mode: 'lip_sync' })).toBe(true);
    expect(isDigitalHumanRequestCozeSupported({ mode: 'omni' })).toBe(false);
    expect(isDigitalHumanRequestCozeSupported({ mode: 'seedance' })).toBe(false);
    expect(isDigitalHumanRequestCozeSupported(null)).toBe(false);
  });

  it('builds the lip-sync create node and polling loop', () => {
    const clipboard = JSON.parse(buildDigitalHumanRequestCozeClipboardData({
      mode: 'lip_sync',
      video_url: 'https://example.com/person.mp4'
    }));

    expect(clipboard.source).toMatchObject({
      workflowId: '7668682150007488554',
      flowMode: 0,
      spaceId: '7472683780642258985',
      host: 'www.coze.cn'
    });

    const createNode = clipboard.json.nodes.find((node) => node.id === '101578');
    expect(createNode.data.nodeMeta.title).toBe('create_digital_human');
    expect(findParameter(createNode.data.inputs.apiParam, 'apiID').input.value.content)
      .toBe('7594783961818349611');
    expect(findParameter(createNode.data.inputs.inputParameters, 'audio_url').input.value.content)
      .toBe('<generated_audio_url>');
    expect(findParameter(createNode.data.inputs.inputParameters, 'video_url').input.value.content)
      .toBe('https://example.com/person.mp4');

    const loopNode = clipboard.json.nodes.find((node) => node.id === '101579');
    expect(loopNode.data.inputs.loopCount.value.content).toBe(150);
    const delayNode = loopNode.blocks.find((node) => node.id === '134580');
    expect(findParameter(delayNode.data.inputs.inputParameters, 'seconds').input.value.content).toBe(10);

    const statusNode = loopNode.blocks.find((node) => node.id === '134581');
    expect(statusNode.data.nodeMeta.title).toBe('digital_human_task_status');
    expect(findParameter(statusNode.data.inputs.apiParam, 'apiID').input.value.content)
      .toBe('7594783961818365995');
    expect(findParameter(statusNode.data.inputs.inputParameters, 'task_id').input.value.content)
      .toMatchObject({
        source: 'block-output',
        blockID: '101578',
        name: 'task_id'
      });

    const conditionNode = loopNode.blocks.find((node) => node.id === '134582');
    const condition = conditionNode.data.inputs.branches[0].condition.conditions[0];
    expect(condition.operator).toBe(10);
    expect(condition.left.input.value.content).toMatchObject({
      source: 'block-output',
      blockID: '134581',
      name: 'digital_human_url'
    });
    expect(condition).not.toHaveProperty('right');
    expect(loopNode.edges).toContainEqual({
      sourceNodeID: '134582',
      targetNodeID: '134583',
      sourcePortID: 'true'
    });
    expect(loopNode.edges).toContainEqual({
      sourceNodeID: '134582',
      targetNodeID: '101579',
      sourcePortID: 'false',
      targetPortID: 'loop-function-inline-input'
    });

    const setResultNode = loopNode.blocks.find((node) => node.id === '134583');
    expect(setResultNode.data.inputs.inputParameters[0].right.value.content).toMatchObject({
      source: 'block-output',
      blockID: '134581',
      name: 'digital_human_url'
    });
    expect(clipboard.json.edges).toContainEqual({
      sourceNodeID: '101578',
      targetNodeID: '101579'
    });
  });

  it('uses an explicit audio URL when one is available', () => {
    const clipboard = JSON.parse(buildDigitalHumanRequestCozeClipboardData({
      mode: 'lip_sync',
      audio_url: 'https://example.com/speech.mp3',
      video_url: 'https://example.com/person.mp4'
    }));
    const createNode = clipboard.json.nodes.find((node) => node.id === '101578');

    expect(findParameter(createNode.data.inputs.inputParameters, 'audio_url').input.value.content)
      .toBe('https://example.com/speech.mp3');
  });
});

describe('buildImageAddRequestCozeClipboardData', () => {
  it('builds the add_image plugin node with request parameters', () => {
    const clipboard = JSON.parse(buildImageAddRequestCozeClipboardData({
      image_url: '/tmp/cat.png',
      draft_id: 'dfd_cat_1790262858_ffe2180c',
      start: 0,
      end: 3,
      track_name: 'image_track',
      transform_x_px: 0,
      transform_y_px: 0,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
      alpha: 1,
      relative_index: 2,
      intro_animation: '放大',
      intro_animation_duration: 0.5,
      outro_animation: '向下滑动',
      outro_animation_duration: 0.5,
      combo_animation: '叠叠乐',
      combo_animation_duration: 0.5,
      transition: '叠化',
      transition_duration: 0.5
    }));

    expect(clipboard.type).toBe('coze-workflow-clipboard-data');
    expect(clipboard.source).toMatchObject({
      workflowId: '7668682150007488554',
      spaceId: '7472683780642258985',
      host: 'www.coze.cn'
    });

    const node = clipboard.json.nodes.find((item) => item.id === '152017');
    expect(node.data.nodeMeta).toMatchObject({
      title: 'add_image',
      subtitle: '流光剪辑_剪映草稿助手(会员版):add_image'
    });
    expect(findParameter(node.data.inputs.apiParam, 'apiID').input.value.content)
      .toBe('7579582015465406464');
    expect(findParameter(node.data.inputs.apiParam, 'apiName').input.value.content)
      .toBe('add_image');
    expect(findParameter(node.data.inputs.apiParam, 'pluginAuthMode').input.value.content).toBe(0);

    const parameters = node.data.inputs.inputParameters;
    expect(findParameter(parameters, 'image_url').input.value.content).toBe('/tmp/cat.png');
    expect(findParameter(parameters, 'draft_id').input.value.content)
      .toBe('dfd_cat_1790262858_ffe2180c');
    expect(findParameter(parameters, 'start').input.value.content).toBe(0);
    expect(findParameter(parameters, 'end').input.value.content).toBe(3);
    expect(findParameter(parameters, 'track_name').input.value.content).toBe('image_track');
    expect(findParameter(parameters, 'transform_x_px').input.type).toBe('integer');
    expect(findParameter(parameters, 'relative_index').input.type).toBe('integer');
    expect(findParameter(parameters, 'combo_animation').input.value.content).toBe('叠叠乐');
    expect(findParameter(parameters, 'combo_animation_duration').input.value.content).toBe(0.5);
    expect(findParameter(parameters, 'transition').input.value.content).toBe('叠化');
    expect(parameters.find((parameter) => parameter.name === 'mask_type')).toBeUndefined();

    const output = node.data.outputs.find((item) => item.name === 'output');
    expect(output.schema.map((field) => field.name)).toEqual(['draft_id', 'draft_url', 'material_id']);
    expect(node._temp.externalData.apiName).toBe('add_image');
    expect(clipboard.json.edges).toEqual([]);
  });

  it('omits optional parameters that are not set', () => {
    const clipboard = JSON.parse(buildImageAddRequestCozeClipboardData({
      image_url: '/tmp/cat.png',
      draft_id: 'draft-1'
    }));
    const node = clipboard.json.nodes.find((item) => item.id === '152017');
    const names = node.data.inputs.inputParameters.map((parameter) => parameter.name);
    expect(names).toEqual(['image_url', 'draft_id', 'start', 'end']);
  });
});
