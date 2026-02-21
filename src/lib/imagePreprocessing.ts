import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Preprocesses a receipt image for OCR.
 * Resizes to an optimal width for text recognition and encodes as base64.
 * 1200px wide is sufficient for receipt OCR and keeps the payload small.
 */
export async function preprocessImageForOcr(uri: string): Promise<{
  base64: string | null;
  uri: string;
}> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      {
        compress: 0.88,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true
      }
    );

    return {
      base64: result.base64 ?? null,
      uri: result.uri
    };
  } catch (error) {
    console.error('Image preprocessing failed:', error);
    // Fallback: try without resize in case the image URI format is unusual
    try {
      const fallback = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      return { base64: fallback.base64 ?? null, uri: fallback.uri };
    } catch {
      return { base64: null, uri };
    }
  }
}

/**
 * Checks if an image URI looks valid before sending to OCR.
 */
export function validateImageQuality(uri: string): {
  isValid: boolean;
  warnings: string[];
} {
  if (!uri) {
    return { isValid: false, warnings: ['No image provided'] };
  }

  const ext = uri.split('.').pop()?.toLowerCase();
  const warnings: string[] = [];
  if (ext && !['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) {
    warnings.push('Unexpected image format. JPEG or PNG works best.');
  }

  return { isValid: true, warnings };
}
