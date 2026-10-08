import { describe, expect, it } from 'vitest';
import {
  buildDigitalHumanRequestCozeClipboardData,
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
