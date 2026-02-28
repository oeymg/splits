import { isSupabaseConfigured, supabase } from './supabase';
import { ReceiptDraft } from '../types';

type OcrResponse = {
  merchant?: string;
  date?: string;
  time?: string;
  total?: number;
  subtotal?: number;
  surcharge?: number;
  lineItems?: Array<{ name: string; price: number; quantity?: number; category?: string }>;
  rawOcrText?: string;
  confidence?: number;
  method?: string;
  validationWarnings?: string[];
  error?: string;
};

export async function runOcr({
  imagePath,
  imageUrl,
  imageBase64,
  mimeType
}: {
  imagePath?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  mimeType?: string;
}): Promise<ReceiptDraft> {
  if (!imagePath && !imageUrl && !imageBase64) {
    throw new Error('No image provided. Please snap or pick a photo.');
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('OCR is not configured. Check your environment variables.');
  }

  const { data, error } = await supabase.functions.invoke<OcrResponse>('ocr-receipt', {
    body: { imagePath, imageUrl, imageBase64, mimeType: mimeType ?? 'image/jpeg' }
  });

  if (error) {
    // Surface user-friendly messages from the function if available
    const msg = (error as any)?.context?.error || error.message || JSON.stringify(error);
    throw new Error(msg);
  }

  if (!data) {
    throw new Error('OCR returned no data. Try again with a clearer photo.');
  }

  // If the function returned an error field, surface it
  if (data.error) {
    throw new Error(data.error);
  }

  console.log('OCR Result:', {
    method: data.method,
    confidence: data.confidence,
    itemCount: data.lineItems?.length ?? 0,
    surcharge: data.surcharge ?? 0,
    warnings: data.validationWarnings?.length ?? 0
  });

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Deduplicate: if OCR returns two identical rows (same name + same unit price),
  // merge them into one entry with an incremented quantity so that downstream
  // expansion still produces the correct number of individual cards.
  const rawItems = data.lineItems ?? [];
  const dedupMap = new Map<string, typeof rawItems[0]>();
  for (const item of rawItems) {
    const unitPrice = item.quantity && item.quantity > 1
      ? round2(item.price / item.quantity)
      : item.price;
    const key = `${item.name.toLowerCase().trim()}|${unitPrice}`;
    const existing = dedupMap.get(key);
    if (existing && !item.quantity && !existing.quantity) {
      // Same item name and unit price, no explicit quantity on either — combine
      const existingQty = existing.quantity ?? 1;
      dedupMap.set(key, {
        ...existing,
        price: round2(existing.price + item.price),
        quantity: existingQty + 1
      });
    } else {
      dedupMap.set(key, { ...item });
    }
  }

  // Expand multi-quantity items into individual line items so each can be
  // assigned to a different person on the items screen.
  // e.g. "2x Flat White $8.00" → two separate "Flat White $4.00" items.
  const lineItems = [...dedupMap.values()].flatMap((item) => {
    const qty = item.quantity && item.quantity > 1 ? item.quantity : 1;
    const priceEach = round2(item.price / qty);
    return Array.from({ length: qty }, () => ({
      id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: item.name,
      price: priceEach,
      allocatedTo: [] as string[],
      ...(item.category ? { category: item.category } : {})
    }));
  });

  const itemsSum = round2(lineItems.reduce((sum, item) => sum + item.price, 0));
  const surcharge = Number.isFinite(data.surcharge) && (data.surcharge as number) > 0
    ? round2(data.surcharge as number)
    : undefined;

  const printedTotal = Number.isFinite(data.total) && (data.total as number) > 0
    ? round2(data.total as number)
    : undefined;

  return {
    merchant: data.merchant ?? '',
    date: data.date ?? new Date().toISOString().slice(0, 10),
    time: data.time,
    total: round2(itemsSum + (surcharge ?? 0)),
    receiptTotal: printedTotal,
    subtotal: data.subtotal,
    surcharge,
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
