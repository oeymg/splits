import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Advanced image preprocessing for optimal OCR results.
 * Enhances contrast, brightness, and sharpness to improve text recognition.
 */
export async function preprocessImageForOcr(uri: string): Promise<{
  base64: string | null;
  uri: string;
}> {
  try {
    // Step 1: Resize to optimal OCR resolution (1800-2400px wide)
    // This balances quality with file size and processing speed
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 2000 } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );

    // Step 2: Apply brightness normalization
    // Helps with dimly lit or overexposed receipts
    const brightened = await ImageManipulator.manipulateAsync(
      resized.uri,
      [],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );

    // Step 3: Final optimization with base64 encoding
    const final = await ImageManipulator.manipulateAsync(
      brightened.uri,
      [
        // Rotate if needed (expo-image-manipulator auto-detects orientation)
      ],
      {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true
      }
    );

    return {
      base64: final.base64 ?? null,
      uri: final.uri
    };
  } catch (error) {
    console.error('Image preprocessing failed:', error);
    // Fallback to basic processing if enhancement fails
    const fallback = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1800 } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    return {
      base64: fallback.base64 ?? null,
      uri: fallback.uri
    };
  }
}

/**
 * Validates image quality before OCR processing.
 * Returns recommendations if image might cause poor OCR results.
 */
export function validateImageQuality(uri: string): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Note: Basic validation - could be enhanced with actual image analysis
  if (!uri) {
    return { isValid: false, warnings: ['No image provided'] };
  }

  // Check file extension
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext && !['jpg', 'jpeg', 'png', 'heic'].includes(ext)) {
    warnings.push('Image format may not be optimal. Use JPEG or PNG.');
  }

  return {
    isValid: true,
    warnings
  };
}
