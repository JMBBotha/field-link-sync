/**
 * Client-side canvas image enhancement for PDF pages.
 * Applies sharpening, contrast boost, upscaling, and noise reduction
 * to improve text readability and OCR quality.
 */

interface EnhanceOptions {
  /** Upscale factor (default 1.5) */
  upscale?: number;
  /** Sharpen strength 0-1 (default 0.4) */
  sharpenAmount?: number;
  /** Contrast boost 0-1 (default 0.25) */
  contrastBoost?: number;
  /** Noise reduction passes 0-3 (default 1) */
  noiseReductionPasses?: number;
}

/**
 * Enhance a canvas in-place: sharpen, boost contrast, reduce noise.
 * Returns a NEW canvas at (width*upscale) x (height*upscale).
 */
export function enhanceCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: EnhanceOptions = {}
): HTMLCanvasElement {
  const {
    upscale = 1.5,
    sharpenAmount = 0.4,
    contrastBoost = 0.25,
    noiseReductionPasses = 1,
  } = options;

  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const outW = Math.round(srcW * upscale);
  const outH = Math.round(srcH * upscale);

  // Step 1: Upscale with high-quality interpolation
  const upscaled = document.createElement("canvas");
  upscaled.width = outW;
  upscaled.height = outH;
  const upCtx = upscaled.getContext("2d")!;
  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = "high";
  upCtx.drawImage(sourceCanvas, 0, 0, outW, outH);

  // Step 2: Get pixel data for processing
  const imageData = upCtx.getImageData(0, 0, outW, outH);
  // Use any[] workaround for Uint8ClampedArray buffer type issues
  let pixels: any = new Uint8ClampedArray(imageData.data);

  // Step 3: Noise reduction (simple box blur on small differences)
  for (let pass = 0; pass < noiseReductionPasses; pass++) {
    pixels = applyNoiseReduction(pixels, outW, outH);
  }

  // Step 4: Contrast boost – push pixels away from mid-gray
  if (contrastBoost > 0) {
    applyContrast(pixels, contrastBoost);
  }

  // Step 5: Unsharp mask (sharpen)
  if (sharpenAmount > 0) {
    applyUnsharpMask(pixels, outW, outH, sharpenAmount);
  }

  // Write back
  const outData = upCtx.createImageData(outW, outH);
  outData.data.set(pixels);
  
  upCtx.putImageData(outData, 0, 0);

  return upscaled;
}

/** Simple 3×3 median-like noise reduction: average only near-similar neighbours */
function applyNoiseReduction(
  data: Uint8ClampedArray,
  w: number,
  h: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const threshold = 30; // only blend if difference < threshold

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = data[idx + c];
        let sum = center;
        let count = 1;

        // Sample 4 direct neighbours
        const neighbours = [
          ((y - 1) * w + x) * 4 + c,
          ((y + 1) * w + x) * 4 + c,
          (y * w + x - 1) * 4 + c,
          (y * w + x + 1) * 4 + c,
        ];

        for (const ni of neighbours) {
          if (Math.abs(data[ni] - center) < threshold) {
            sum += data[ni];
            count++;
          }
        }
        out[idx + c] = Math.round(sum / count);
      }
    }
  }
  return out;
}

/** Boost contrast by pushing values away from 128 */
function applyContrast(data: Uint8ClampedArray, amount: number): void {
  const factor = 1 + amount; // e.g. 1.25
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const val = data[i + c];
      data[i + c] = Math.max(0, Math.min(255, Math.round((val - 128) * factor + 128)));
    }
  }
}

/** Unsharp mask: sharpen by subtracting blurred version */
function applyUnsharpMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number
): void {
  // Create a blurred copy (simple 3×3 box blur)
  const blurred = new Uint8ClampedArray(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += data[((y + dy) * w + (x + dx)) * 4 + c];
          }
        }
        blurred[idx + c] = Math.round(sum / 9);
      }
    }
  }

  // Sharpen: original + amount * (original - blurred)
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - blurred[i + c];
      data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] + amount * diff)));
    }
  }
}

/**
 * Enhance a JPEG blob: decode → enhance → re-encode.
 * Returns a new enhanced Blob.
 */
export async function enhanceImageBlob(
  blob: Blob,
  options: EnhanceOptions = {}
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = bitmap.width;
  srcCanvas.height = bitmap.height;
  const ctx = srcCanvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const enhanced = enhanceCanvas(srcCanvas, options);

  // Cleanup source
  srcCanvas.width = 0;
  srcCanvas.height = 0;

  const outBlob = await new Promise<Blob>((resolve) => {
    enhanced.toBlob((b) => resolve(b!), "image/jpeg", 0.88);
  });

  // Cleanup enhanced
  enhanced.width = 0;
  enhanced.height = 0;

  return outBlob;
}
