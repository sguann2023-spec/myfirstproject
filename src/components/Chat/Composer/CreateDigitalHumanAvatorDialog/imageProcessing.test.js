import { describe, expect, it } from 'vitest';
import { fitDigitalHumanAvatarResolution } from './imageProcessing';

describe('fitDigitalHumanAvatarResolution', () => {
  it('keeps images within 1080P bounds unchanged', () => {
    expect(fitDigitalHumanAvatarResolution(1280, 720)).toEqual({
      width: 1280,
      height: 720,
      resized: false,
    });
  });

  it('fits landscape images within 1920x1080', () => {
    expect(fitDigitalHumanAvatarResolution(3840, 2160)).toEqual({
      width: 1920,
      height: 1080,
      resized: true,
    });
    expect(fitDigitalHumanAvatarResolution(1920, 1600)).toEqual({
      width: 1296,
      height: 1080,
      resized: true,
    });
  });

  it('fits portrait images within 1080x1920', () => {
    expect(fitDigitalHumanAvatarResolution(2160, 3840)).toEqual({
      width: 1080,
      height: 1920,
      resized: true,
    });
  });

  it('fits square images within 1080x1080', () => {
    expect(fitDigitalHumanAvatarResolution(2048, 2048)).toEqual({
      width: 1080,
      height: 1080,
      resized: true,
    });
  });
});
