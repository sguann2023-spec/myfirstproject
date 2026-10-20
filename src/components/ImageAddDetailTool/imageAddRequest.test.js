import { describe, expect, it } from 'vitest';
import { normalizeImageAddRequestPayload } from '../../shared/imageAddRequest';
import { normalizeDirectImageAddRequest } from '../../main/services/agents/services/channels/imageAddRequest';

const base = { draft_id: 'draft-1', image_url: '/tmp/image.png' };
const effects = {
  intro_animation: 'fade-in',
  intro_animation_duration: 0.7,
  outro_animation: 'fade-out',
  outro_animation_duration: 1.2,
  combo_animation: 'stack-up',
  combo_animation_duration: 0.6,
  transition: 'dissolve',
  transition_duration: 0.5,
};
const camelEffects = {
  introAnimation: ' fade-in ',
  introAnimationDuration: '0.7',
  outroAnimation: ' fade-out ',
  outroAnimationDuration: '1.2',
  comboAnimation: ' stack-up ',
  comboAnimationDuration: '0.6',
  transition: ' dissolve ',
  transitionDuration: '0.5',
};

describe.each([
  ['shared payload', normalizeImageAddRequestPayload],
  ['main channel', normalizeDirectImageAddRequest],
])('%s image effects', (_name, normalize) => {
  it('preserves snake_case effect names and durations', () => {
    expect(normalize({ ...base, ...effects })).toEqual({ ...base, ...effects });
  });

  it('normalizes camelCase aliases, trimmed names and numeric strings', () => {
    expect(normalize({ ...base, ...camelEffects })).toEqual({ ...base, ...effects });
  });

  it('prefers snake_case values and preserves zero durations', () => {
    expect(normalize({
      ...base,
      ...camelEffects,
      intro_animation: 'slide-in',
      outro_animation: 'slide-out',
      intro_animation_duration: 0,
      outro_animation_duration: 0,
      transition_duration: 0,
    })).toEqual({
      ...base,
      intro_animation: 'slide-in',
      outro_animation: 'slide-out',
      combo_animation: 'stack-up',
      transition: 'dissolve',
      intro_animation_duration: 0,
      outro_animation_duration: 0,
      combo_animation_duration: 0.6,
      transition_duration: 0,
    });
  });

  it.each([null, undefined, '', 'invalid', NaN, Infinity, -Infinity])(
    'omits invalid or absent durations (%s) without dropping names', (duration) => {
      expect(normalize({
        ...base,
        ...effects,
        intro_animation_duration: duration,
        outro_animation_duration: duration,
        combo_animation_duration: duration,
        transition_duration: duration,
      })).toEqual({
        ...base,
        intro_animation: effects.intro_animation,
        outro_animation: effects.outro_animation,
        combo_animation: effects.combo_animation,
        transition: effects.transition,
      });
    },
  );

  it.each([null, undefined, '', '   '])('omits empty names (%s)', (name) => {
    expect(normalize({
      ...base, intro_animation: name, outro_animation: name, combo_animation: name, transition: name,
    })).toEqual(base);
  });

  it('does not add effects when omitted or change existing image parameters', () => {
    expect(normalize({
      draftId: ' draft-1 ', imageUrl: ' /tmp/image.png ', trackName: ' images ',
      start: '0', end: '3', width: '1920', height: '1080',
      transformXPx: '-20', transformYPx: '30', rotation: '90',
      scaleX: '1.2', scaleY: '0.8', relativeIndex: '0', alpha: '0',
    })).toEqual({
      ...base, track_name: 'images', start: 0, end: 3, width: 1920, height: 1080,
      transform_x_px: -20, transform_y_px: 30, rotation: 90,
      scale_x: 1.2, scale_y: 0.8, relative_index: 0, alpha: 0,
    });
  });
});

it('preserves effects through shared payload and main channel normalization', () => {
  const payload = normalizeImageAddRequestPayload({ ...base, ...camelEffects });
  expect(normalizeDirectImageAddRequest(payload)).toEqual({ ...base, ...effects });
});

it('retains the existing required-field validation at each boundary', () => {
  expect(normalizeImageAddRequestPayload({ image_url: base.image_url })).toBeNull();
  expect(normalizeImageAddRequestPayload({ draft_id: base.draft_id })).toBeNull();
  expect(() => normalizeDirectImageAddRequest({ draft_id: base.draft_id }))
    .toThrow('image_url is required for image add request');
  expect(normalizeDirectImageAddRequest({ image_url: base.image_url, ...effects }))
    .toEqual({ image_url: base.image_url, ...effects });
});
