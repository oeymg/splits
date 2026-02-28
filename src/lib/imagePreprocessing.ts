import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Preprocesses a receipt image for OCR.
 * Handles JPEG, PNG, WEBP, and HEIC (iPhone default format).
 * Always outputs JPEG — ImageManipulator converts HEIC transparently on iOS.
 * Resizes to 720px wide at 0.65 quality — small enough for fast upload, large enough for clear text.
 */
export async function preprocessImageForOcr(uri: string): Promise<{
  base64: string | null;
  uri: string;
  mimeType: string;
}> {
  // On iOS, HEIC URIs may look like "ph://..." or end in ".heic".
  // ImageManipulator handles HEIC natively on iOS and converts to JPEG.
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 720 } }],
      {
        compress: 0.65,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true
      }
    );

    return {
      base64: result.base64 ?? null,
      uri: result.uri,
      mimeType: 'image/jpeg'
    };
  } catch (error) {
    console.error('Image preprocessing failed:', error);

    // Fallback 1: try without resize — some HEIC URIs need a direct encode step first
    try {
      const fallback = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      return { base64: fallback.base64 ?? null, uri: fallback.uri, mimeType: 'image/jpeg' };
    } catch (fallbackError) {
      console.error('Image preprocessing fallback also failed:', fallbackError);
    }

    // Fallback 2: fetch raw bytes and send as-is.
    // Last resort for formats that ImageManipulator cannot handle (e.g. HEIC on web).
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const detectedMime = blob.type || 'image/heic';
      const buf = await blob.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      // Build base64 in small chunks to avoid call stack overflow on large files
      const CHUNK = 4096;
      let binary = '';
      for (let i = 0; i < uint8.length; i += CHUNK) {
        binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
      }
      return { base64: btoa(binary), uri, mimeType: detectedMime };
    } catch (rawError) {
      console.error('Raw byte fallback also failed:', rawError);
      return { base64: null, uri, mimeType: 'image/jpeg' };
    }
  }
}

/**
 * Checks if an image URI looks processable before sending to OCR.
 */
export function validateImageQuality(uri: string): {
  isValid: boolean;
  warnings: string[];
} {
  if (!uri) {
    return { isValid: false, warnings: ['No image provided'] };
  }

  // ph:// URIs are iOS photo library references (often HEIC) — valid
  if (uri.startsWith('ph://') || uri.startsWith('assets-library://')) {
    return { isValid: true, warnings: [] };
  }

  const ext = uri.split('.').pop()?.toLowerCase().split('?')[0];
  if (ext && !['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'].includes(ext)) {
    return { isValid: true, warnings: ['Unexpected image format — results may vary.'] };
  }

  return { isValid: true, warnings: [] };
}
