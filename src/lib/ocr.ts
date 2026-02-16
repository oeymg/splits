import { isSupabaseConfigured, supabase } from './supabase';
import { ReceiptDraft } from '../types';


type OcrResponse = {
  merchant?: string;
  date?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  lineItems?: Array<{ name: string; price: number; quantity?: number }>;
  rawOcrText?: string;
  confidence?: number;
  method?: string;
  validationWarnings?: string[];
};

export async function runOcr({
  imagePath,
  imageUrl,
  imageBase64
}: {
  imagePath?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
}): Promise<ReceiptDraft> {
  if (!imagePath && !imageUrl && !imageBase64) {
    throw new Error('No image provided. Please snap or pick a photo.');
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Check your .env file has EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  // REMOVED TRY/CATCH to allow errors to be seen by the caller (App.tsx)
  const { data, error } = await supabase.functions.invoke<OcrResponse>('ocr-receipt', {
    body: { imagePath, imageUrl, imageBase64 }
  });

  if (error) {
    console.error('OCR Function Error:', error);
    throw new Error(`OCR Failed: ${error.message || JSON.stringify(error)}`);
  }

  if (!data) {
    throw new Error('OCR returned no data');
  }

  // Log OCR metrics for debugging
  console.log('OCR Result:', {
    method: data.method,
    confidence: data.confidence,
    itemCount: data.lineItems?.length ?? 0,
    warnings: data.validationWarnings?.length ?? 0
  });

  // Show validation warnings if present
  if (data.validationWarnings && data.validationWarnings.length > 0) {
    console.warn('OCR Validation Warnings:', data.validationWarnings);
  }

  const lineItems =
    data.lineItems?.map((item) => ({
      id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: (item.quantity && item.quantity > 1) ? `${item.quantity}x ${item.name}` : item.name,
      price: item.price,
      allocatedTo: []
    })) ?? [];

  return {
    merchant: data.merchant ?? '',
    date: data.date ?? new Date().toISOString().slice(0, 10),
    total: Number.isFinite(data.total) ? (data.total as number) : 0,
    subtotal: data.subtotal,
    tax: data.tax,
    imageUri: imageUrl ?? undefined,
    rawOcrText: data.rawOcrText,
    confidence: data.confidence,
    method: data.method,
    validationWarnings: data.validationWarnings,
    lineItems
  };
}

export function coerceNumber(value: string, fallback = 0): number {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}
