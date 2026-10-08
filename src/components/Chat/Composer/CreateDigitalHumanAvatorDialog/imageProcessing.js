const LANDSCAPE_MAX_WIDTH = 1920;
const LANDSCAPE_MAX_HEIGHT = 1080;
const PORTRAIT_MAX_WIDTH = 1080;
const PORTRAIT_MAX_HEIGHT = 1920;
const SQUARE_MAX_SIZE = 1080;

export const fitDigitalHumanAvatarResolution = (width, height) => {
  const sourceWidth = Math.max(0, Number(width) || 0);
  const sourceHeight = Math.max(0, Number(height) || 0);
  if (!sourceWidth || !sourceHeight) {
    return { width: sourceWidth, height: sourceHeight, resized: false };
  }

  const isSquare = sourceWidth === sourceHeight;
  const maxWidth = isSquare
    ? SQUARE_MAX_SIZE
    : sourceWidth > sourceHeight
      ? LANDSCAPE_MAX_WIDTH
      : PORTRAIT_MAX_WIDTH;
  const maxHeight = isSquare
    ? SQUARE_MAX_SIZE
    : sourceWidth > sourceHeight
      ? LANDSCAPE_MAX_HEIGHT
      : PORTRAIT_MAX_HEIGHT;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    resized: scale < 1,
  };
};

const loadImageSource = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall through to an HTMLImageElement for formats unsupported by createImageBitmap.
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取图片分辨率'));
    };
    image.src = objectUrl;
  });
};

const getOutputFormat = (file) => {
  const sourceType = String(file?.type || '').toLowerCase();
  if (sourceType === 'image/jpeg' || sourceType === 'image/jpg') {
    return { type: 'image/jpeg', extension: '.jpg', quality: 0.92 };
  }
  if (sourceType === 'image/webp') {
    return { type: 'image/webp', extension: '.webp', quality: 0.92 };
  }
  return { type: 'image/png', extension: '.png', quality: undefined };
};

const replaceFileExtension = (name, extension) => {
  const baseName = String(name || 'digital-human-avatar').replace(/\.[^./\\]+$/, '');
  return `${baseName}${extension}`;
};

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }
    reject(new Error('图片自动压缩失败'));
  }, type, quality);
});

export const resizeDigitalHumanAvatarImage = async (file) => {
  const image = await loadImageSource(file);
  try {
    const fitted = fitDigitalHumanAvatarResolution(image.width, image.height);
    if (!fitted.resized) {
      return {
        file,
        resized: false,
        originalWidth: image.width,
        originalHeight: image.height,
        width: image.width,
        height: image.height,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片自动压缩失败');
    context.drawImage(image.source, 0, 0, fitted.width, fitted.height);

    const output = getOutputFormat(file);
    const blob = await canvasToBlob(canvas, output.type, output.quality);
    const resizedFile = new File(
      [blob],
      replaceFileExtension(file?.name, output.extension),
      { type: output.type, lastModified: Date.now() }
    );

    return {
      file: resizedFile,
      resized: true,
      originalWidth: image.width,
      originalHeight: image.height,
      width: fitted.width,
      height: fitted.height,
    };
  } finally {
    image.cleanup();
  }
};
