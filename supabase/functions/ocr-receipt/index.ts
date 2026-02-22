import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ──────────────────────────────────────────────────────────
type ParsedLineItem = { name: string; price: number; quantity?: number };

type ParsedReceipt = {
  merchant: string;
  date: string;
  time?: string;
  subtotal?: number;
  surcharge?: number;
  total: number;
  lineItems: ParsedLineItem[];
  rawOcrText: string;
  confidence?: number;
  method?: string;
  validationWarnings?: string[];
};

// ─── Config ─────────────────────────────────────────────────────────
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const visionApiKey = Deno.env.get('VISION_API_KEY') ?? '';
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? visionApiKey;
const bucket = Deno.env.get('RECEIPTS_BUCKET') ?? 'receipts';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

// ─── Structured Output Schema ─────────────────────────────────────────
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING' },
    date: { type: 'STRING' },
    time: { type: 'STRING', nullable: true },
    lineItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          price: { type: 'NUMBER' },
          quantity: { type: 'INTEGER', nullable: true }
        },
        required: ['name', 'price']
      }
    },
    subtotal: { type: 'NUMBER', nullable: true },
    surcharge: { type: 'NUMBER', nullable: true },
    total: { type: 'NUMBER' }
  },
  required: ['merchant', 'date', 'lineItems', 'total']
};

// ─── Prompt ──────────────────────────────────────────────────────────
const RECEIPT_PROMPT = `You are a precise Australian receipt parser for a bill-splitting app.

YOUR JOB: Extract only the ordered food/drink/products and the final amounts. Nothing else.

══ NEVER EXTRACT THESE (skip the entire line) ══
• Payment: EFTPOS, Visa, Mastercard, PayWave, Contactless, Tap & Go, Cash, Change, Refund, APPROVED, Signature
• AUD lines: anything that is just "AUD", "AUD $XX.XX", or starts with "AUD " without a product name
• Card details: Auth:, Approval:, Reference:, Transaction ID:, Receipt #, Account: ****XXXX, RRN:
• GST lines: "Incl. GST", "GST $X.XX", "GST Component", "Tax Invoice" header, "ABN XX XXX XXX XXX"
• Rounding: "Cash rounding", "Rounding adjustment" (AU rounds to 5c)
• Loyalty/savings: "You saved", "Member savings", "Points earned", "Rewards", "Member price", "Special", "Discount applied"
• Receipt metadata: store address, phone, website URL, "Thank you", "Please come again", "Guest copy", "Duplicate", "VOID", "NO SALE"
• Order info: table number, seat, server name, order number, docket number, covers, terminal ID
• Duplicate totals: receipts sometimes print TOTAL twice — use only the final/largest value

══ EXTRACTION RULES ══

merchant: The business trading name — usually the LARGEST text at the very top. Skip if it is an address, ABN, phone number, or "TAX INVOICE".

date: Output YYYY-MM-DD. AU receipts write DD/MM/YYYY — convert carefully (e.g. "15/03/2025" → "2025-03-15").

time: 24-hour HH:MM. Null if absent.

lineItems — EVERY ordered item with a price > 0:
  name: Clean, human-readable name only.
    • Strip leading barcode/article codes: "30482355 KALLAX Shelf 77x147cm" → "KALLAX Shelf 77x147cm"
    • Strip leading product codes: "516268 Doritos" → "Doritos"
    • Keep IKEA dimensions (e.g. "77x147cm").
    • Strip trailing dot leaders: "Flat White ......... 4.50" → "Flat White"
    • $0 modifier lines (e.g. "  No sugar", "  Extra ice"): APPEND to the previous item name; do NOT add as a separate item.
    • Modifiers WITH a price (e.g. "+ Extra shot $1.00"): include in the parent item name and ADD to the parent price. Do not list as a separate line item.
  price: The TOTAL price for the line as printed.
    • "2x Flat White $8.00" → price=8.00, quantity=2 (do NOT divide — $8.00 is already the line total)
    • "Flat White $4.50 × 3" → price=13.50 (multiply: 4.50×3), quantity=3
    • "Chips 3.00" → price=3.00 (no quantity)
    • "Unleaded 30.5L @ $1.89/L $57.65" → name="Unleaded 30.5L", price=57.65 (use the dollar total, not the per-litre rate)
  quantity: Integer > 1 only when quantity is EXPLICITLY printed (e.g. "2x", "Qty 3", "× 2"). Omit if 1.
    • "Nuggets (6 piece)" → this is a portion description, NOT a quantity. Omit quantity.
    • "Family Serve" → NOT a quantity.

MULTI-LINE ITEMS: If item name is on one line and its price is on the very next line alone, merge them into a single item.

subtotal: Pre-surcharge item total, if explicitly labelled "Subtotal" or "Sub-total". Null otherwise.

surcharge: Dollar amount of any merchant-added surcharge (weekend, public holiday, service fee, credit card fee).
  • "15% weekend surcharge $6.75" → surcharge=6.75
  • "Service fee 10% $4.50" → surcharge=4.50
  • Null if no surcharge.

total: The FINAL amount the customer paid. If printed multiple times, use the last occurrence or the largest value that is less than double the item sum.

SELF-CHECK: Sum your lineItem prices. If the sum is more than 25% away from subtotal (or total if no surcharge), you missed items or misread a price — look again before finalising.

VENUE HINTS:
• Café / restaurant: every food and drink line with a price is a line item.
• Woolworths / Coles / Aldi / IGA: skip "Savings", "Specials", "Points earned", "Member price" lines.
• IKEA: strip 8-digit article codes; keep product name with dimensions.
• Bottle shop / pub: alcohol and snacks are valid items.
• Petrol station: fuel lines are items — use the dollar total (not the per-litre rate).`;

// ─── Helpers ────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Classify whether an error is transient and worth retrying
function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('429') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('unavailable') ||
    msg.toLowerCase().includes('timeout') ||
    msg.toLowerCase().includes('network')
  );
}

function classifyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
    return 'OCR is busy right now — wait a moment and try again.';
  }
  if (msg.includes('503') || msg.includes('502') || msg.toLowerCase().includes('unavailable')) {
    return 'OCR service is temporarily unavailable. Try again shortly.';
  }
  if (msg.includes('413') || msg.toLowerCase().includes('too large')) {
    return 'Image is too large to process. Try a closer, cropped photo of just the receipt.';
  }
  if (msg.includes('400') && msg.toLowerCase().includes('image')) {
    return 'Could not read the image. Make sure the receipt is well-lit and in focus.';
  }
  return msg;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelay = 800
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      // Don't retry permanent errors (bad request, too large, etc.)
      if (!isTransientError(error)) throw error;
      if (attempt === maxRetries - 1) break;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1} failed (transient), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('All retry attempts failed');
}

// ─── Gemini Vision (PRIMARY) ─────────────────────────────────────────
async function parseWithGeminiVision(base64Image: string, mimeType = 'image/jpeg'): Promise<ParsedReceipt | null> {
  if (!geminiApiKey) return null;

  // Rough size guard: base64 of ~3.5 MB raw image ≈ 4.7 MB string. Gemini limit is ~20MB inline but
  // very large images slow down processing significantly.
  if (base64Image.length > 6_000_000) {
    console.warn(`Image is large (${(base64Image.length / 1_000_000).toFixed(1)}MB base64) — may be slow`);
  }

  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: RECEIPT_PROMPT },
                { inlineData: { mimeType, data: base64Image } }
              ]
            }],
            generationConfig: {
              temperature: 0,        // Zero temperature for deterministic extraction
              maxOutputTokens: 2048, // Sufficient for any realistic receipt
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA
            }
          }),
          signal: AbortSignal.timeout(35000)
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Gemini Vision error:', res.status, errorText);
        throw new Error(`Gemini Vision API error: ${res.status} — ${errorText.slice(0, 200)}`);
      }
      return res;
    });

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return null;

    const parsed = JSON.parse(text);
    const result = validateAndBuild(parsed, '');
    if (result) {
      result.confidence = 0.95;
      result.method = 'gemini-vision';
    }
    return result;
  } catch (error) {
    console.error('Gemini Vision failed:', classifyError(error));
    return null;
  }
}

// ─── Gemini Text Parser (FALLBACK 1) ─────────────────────────────────
async function parseWithGeminiText(ocrText: string): Promise<ParsedReceipt | null> {
  if (!geminiApiKey) return null;

  const prompt = `${RECEIPT_PROMPT}\n\nRECEIPT TEXT:\n${ocrText}`;

  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1536,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA
            }
          }),
          signal: AbortSignal.timeout(25000)
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini Text API error: ${res.status} — ${errorText.slice(0, 200)}`);
      }
      return res;
    });

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return null;

    const parsed = JSON.parse(text);
    const result = validateAndBuild(parsed, ocrText);
    if (result) {
      result.confidence = 0.75;
      result.method = 'gemini-text';
    }
    return result;
  } catch (error) {
    console.error('Gemini text failed:', classifyError(error));
    return null;
  }
}

// ─── Validation & Builder ────────────────────────────────────────────
function validateAndBuild(parsed: any, rawOcrText: string): ParsedReceipt | null {
  const validationWarnings: string[] = [];

  const lineItems: ParsedLineItem[] = (parsed.lineItems ?? [])
    .map((item: any) => {
      let price = typeof item.price === 'string'
        ? parseFloat(item.price.replace(/[^0-9.-]/g, ''))
        : item.price;

      let quantity = item.quantity ?? undefined;
      if (typeof quantity === 'string') {
        quantity = parseFloat(quantity.replace(/[^0-9.]/g, '')) || undefined;
      }
      // Guard: quantity must be a reasonable positive integer
      if (quantity != null && (!Number.isInteger(quantity) || quantity < 2 || quantity > 99)) {
        quantity = undefined;
      }

      // Clean up item name — strip trailing dots and extra whitespace
      const name = typeof item.name === 'string'
        ? item.name.trim().replace(/[.\-_]{3,}$/, '').replace(/\s{2,}/g, ' ').trim()
        : '';

      return {
        name,
        price: Number.isFinite(price) ? Math.round(price * 100) / 100 : 0,
        ...(quantity != null && { quantity })
      };
    })
    .filter((item: ParsedLineItem) => item.name.length > 0 && item.price > 0);

  if (lineItems.length === 0) return null;

  const computedTotal = lineItems.reduce((sum: number, i: ParsedLineItem) => sum + i.price, 0);
  const reportedTotal = typeof parsed.total === 'number' && parsed.total > 0
    ? Math.round(parsed.total * 100) / 100
    : Math.round(computedTotal * 100) / 100;

  const surcharge = typeof parsed.surcharge === 'number' && parsed.surcharge > 0
    ? Math.round(parsed.surcharge * 100) / 100
    : undefined;

  // Expected subtotal (items only, before surcharge)
  const expectedSubtotal = typeof parsed.subtotal === 'number' && parsed.subtotal > 0
    ? parsed.subtotal
    : surcharge
      ? Math.round((reportedTotal - surcharge) * 100) / 100
      : reportedTotal;

  // Validate item sum vs expected subtotal
  if (expectedSubtotal > 0 && computedTotal > 0) {
    const ratio = computedTotal / expectedSubtotal;
    if (ratio < 0.4 || ratio > 2.5) {
      validationWarnings.push(`Item sum (${formatAud(computedTotal)}) differs significantly from receipt total (${formatAud(expectedSubtotal)}) — some items may be missing or mispriced`);
    } else if (ratio < 0.75 || ratio > 1.25) {
      validationWarnings.push('Minor discrepancy between item sum and total — worth double-checking');
    }
  }

  // Sanity: no single item should cost more than the total
  const overpriced = lineItems.filter(item => item.price > reportedTotal * 1.05);
  if (overpriced.length > 0) {
    validationWarnings.push(`${overpriced.length} item(s) have prices larger than the bill total — please review`);
  }

  if (!parsed.merchant || String(parsed.merchant).trim().length < 2) {
    validationWarnings.push('Merchant name unclear — check the receipt');
  }

  if (!parsed.date) {
    validationWarnings.push('Date not detected');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    validationWarnings.push('Date format may be incorrect');
  }

  if (reportedTotal > 10000) {
    validationWarnings.push('Unusually high total — please verify');
  }

  // Validate time format
  let time: string | undefined;
  if (parsed.time && typeof parsed.time === 'string') {
    const match = parsed.time.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
  }

  return {
    merchant: String(parsed.merchant || 'Receipt').trim(),
    date: parsed.date || '',
    time,
    subtotal: typeof parsed.subtotal === 'number' && parsed.subtotal > 0
      ? Math.round(parsed.subtotal * 100) / 100
      : undefined,
    surcharge,
    total: reportedTotal,
    lineItems,
    rawOcrText,
    validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
  };
}

function formatAud(n: number) {
  return `$${n.toFixed(2)}`;
}

// ─── Regex Fallback (FALLBACK 2) ─────────────────────────────────────
const totalKeywords = ['total', 'amount due', 'balance due', 'grand total', 'amount paid'];
const subtotalKeywords = ['subtotal', 'sub total', 'sub-total'];
const surchargeKeywords = ['surcharge', 'holiday surcharge', 'weekend surcharge', 'service charge', 'service fee', 'credit card fee'];
const skipKeywords = [
  'visa', 'mastercard', 'eftpos', 'paywave', 'payid', 'cash', 'change', 'card', 'payment', 'refund',
  'approved', 'approval', 'authorisation', 'reference', 'transaction', 'receipt #', 'rrn:',
  'abn', 'phone', 'tel', 'fax', 'table', 'order', 'server', 'cashier', 'operator',
  'thank', 'welcome', 'loyalty', 'points', 'member', 'incl. gst', 'gst component', 'gst $',
  'you saved', 'savings', 'special price', 'member price',
  'www.', 'http', '.com', '.au', 'wifi', 'password', 'network',
  'contactless', 'tap &', 'tap and', 'account:', 'signature'
];

const priceRegex = /\$?\s*(-?\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*(?:[A-Z*])?\s*$/i;
const quantityRegex = /^(\d+)\s*[xX×]\s*/;
// Strip leading barcodes (4–13 digits) followed by whitespace — covers EAN-8 to EAN-13
const productCodeRegex = /^\d{4,13}\s+/;

const dateRegexes = [
  // ISO: 2025-03-15
  /\b(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/,
  // AU: 15/03/2025 or 15/03/25
  /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{2,4})\b/
];

function normalizePrice(value: string) {
  let cleaned = value.replace(/[$\s]/g, '').replace(/[^0-9,.-]/g, '');
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 2 && parts.length === 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineHasKeyword(line: string, keywords: string[]) {
  const lowered = line.toLowerCase();
  return keywords.some((k) => lowered.includes(k));
}

function parseDate(text: string) {
  // ISO format first
  const isoMatch = text.match(dateRegexes[0]);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  // AU format DD/MM/YY or DD/MM/YYYY
  const auMatch = text.match(dateRegexes[1]);
  if (auMatch) {
    const year = auMatch[3].length === 2 ? `20${auMatch[3]}` : auMatch[3];
    return `${year}-${auMatch[2].padStart(2, '0')}-${auMatch[1].padStart(2, '0')}`;
  }
  return '';
}

const timeRegex = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m?)?\b/i;

function parseTime(text: string): string {
  const match = text.match(timeRegex);
  if (!match) return '';
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[4]?.toLowerCase();
  if (ampm === 'pm' || ampm === 'p') { if (h < 12) h += 12; }
  else if (ampm === 'am' || ampm === 'a') { if (h === 12) h = 0; }
  if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return '';
}

function parseReceiptFallback(text: string): ParsedReceipt {
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Merge name lines followed by standalone price lines
  const priceOnlyRe = /^\s*\$?\s*-?\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2})\s*(?:[A-Z*])?\s*$/i;
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i];
    const nxt = rawLines[i + 1];
    if (nxt && !priceOnlyRe.test(cur) && /[A-Za-z0-9]/.test(cur) && priceOnlyRe.test(nxt)) {
      lines.push(`${cur} ${nxt}`);
      i++;
    } else {
      lines.push(cur);
    }
  }

  // Merchant: first line with ≥ 3 alpha chars that isn't an address/ABN/phone
  const merchant = lines.find((line) => {
    if (line.length < 3 || /^\d+$/.test(line)) return false;
    if (/^\d+\s+(st|rd|nd|th|ave|blvd|street|road|drive|lane|court|crt|pl|place)/i.test(line)) return false;
    if (/^(abn|phone|tel|fax|tax invoice|receipt|duplicate|void)/i.test(line)) return false;
    if (/[^A-Za-z0-9\s&'.\-–]/.test(line) && !/ /.test(line)) return false; // skip pure symbol lines
    return /[A-Za-z]{3,}/.test(line);
  }) ?? 'Receipt';

  const date = lines.map(parseDate).find((v) => v) ?? '';
  const time = lines.map(parseTime).find((v) => v) || undefined;

  const items: ParsedLineItem[] = [];
  let subtotal: number | undefined;
  let surcharge: number | undefined;
  let total: number | undefined;

  for (const line of lines) {
    if (lineHasKeyword(line, skipKeywords)) continue;

    const priceMatch = line.match(priceRegex);
    if (!priceMatch) continue;

    const price = normalizePrice(priceMatch[1]);
    if (price <= 0) continue;

    let label = line.replace(priceRegex, '').trim();
    if (!label || label.length < 2) continue;

    if (lineHasKeyword(line, totalKeywords) && !lineHasKeyword(line, subtotalKeywords)) {
      // Keep the highest total seen (some receipts print it twice)
      if (!total || price > total) total = price;
      continue;
    }
    if (lineHasKeyword(line, subtotalKeywords)) { subtotal = price; continue; }
    if (lineHasKeyword(line, surchargeKeywords)) { surcharge = price; continue; }

    let quantity: number | undefined;
    const qtyMatch = label.match(quantityRegex);
    if (qtyMatch) {
      const q = parseInt(qtyMatch[1], 10);
      if (q >= 2 && q <= 99) quantity = q;
      label = label.replace(quantityRegex, '').trim();
    }

    // Strip product codes and cleanup
    label = label.replace(productCodeRegex, '').trim();
    label = label.replace(/[.\-_]{3,}$/g, '').replace(/\s{2,}/g, ' ').trim();

    if (label.length >= 2) {
      items.push({ name: label, price, ...(quantity != null && { quantity }) });
    }
  }

  const computedTotal = items.reduce((s, i) => s + i.price, 0);

  return {
    merchant,
    date,
    time,
    subtotal,
    surcharge,
    total: total ?? subtotal ?? computedTotal,
    lineItems: items,
    rawOcrText: text,
    confidence: 0.5,
    method: 'regex-fallback'
  };
}

// ─── Main Handler ───────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!visionApiKey && !geminiApiKey) {
      throw new Error('Missing VISION_API_KEY or GEMINI_API_KEY environment variable');
    }

    const { imagePath, imageUrl, imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imagePath && !imageUrl && !imageBase64) {
      throw new Error('imagePath, imageUrl, or imageBase64 is required');
    }

    // ── Step 1: Get image as base64 ──
    let base64Content = '';

    if (imageBase64) {
      base64Content = imageBase64;
    } else if (imagePath) {
      const { data, error } = await supabase.storage.from(bucket).download(imagePath);
      if (error) throw error;
      base64Content = arrayBufferToBase64(await data.arrayBuffer());
    } else if (imageUrl) {
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error('Failed to download image from URL');
      base64Content = arrayBufferToBase64(await resp.arrayBuffer());
    }

    let parsed: ParsedReceipt | null = null;

    // ── Step 2: PRIMARY — Gemini Vision (image → structured JSON) ──
    if (geminiApiKey) {
      console.log(`🔍 Gemini Vision (${(base64Content.length / 1000).toFixed(0)} KB base64)...`);
      parsed = await parseWithGeminiVision(base64Content, mimeType);
      if (parsed) {
        console.log(`✅ Gemini Vision: ${parsed.lineItems.length} items, total=${formatAud(parsed.total)}, surcharge=${formatAud(parsed.surcharge ?? 0)}`);
      }
    }

    // ── Step 3: FALLBACK 1 — Google Vision API text → Gemini text ──
    if (!parsed && visionApiKey) {
      console.log('⚡ Falling back to Vision API + Gemini text...');
      try {
        const visionResp = await retryWithBackoff(async () => {
          const res = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requests: [{
                  image: { content: base64Content },
                  features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
                  imageContext: { languageHints: ['en'] }
                }]
              }),
              signal: AbortSignal.timeout(25000)
            }
          );
          if (!res.ok) throw new Error(`Vision API error: ${res.status}`);
          return res;
        });

        const visionJson = await visionResp.json();
        const ocrText =
          visionJson?.responses?.[0]?.fullTextAnnotation?.text ??
          visionJson?.responses?.[0]?.textAnnotations?.[0]?.description ?? '';

        if (ocrText.trim()) {
          parsed = await parseWithGeminiText(ocrText);
          if (parsed) {
            console.log(`✅ Vision+Gemini text: ${parsed.lineItems.length} items`);
          } else {
            console.log('🔧 Using regex fallback...');
            parsed = parseReceiptFallback(ocrText);
            console.log(`✅ Regex: ${parsed.lineItems.length} items`);
          }
        }
      } catch (error) {
        console.error('Vision API failed:', classifyError(error));
      }
    }

    const result = parsed ?? {
      merchant: 'Receipt',
      date: '',
      total: 0,
      lineItems: [],
      rawOcrText: '',
      confidence: 0,
      method: 'none',
      validationWarnings: ['Could not read the receipt. Try a clearer, well-lit photo.']
    };

    console.log(`📊 OCR Complete: method=${result.method}, items=${result.lineItems.length}, total=${formatAud(result.total)}, surcharge=${formatAud(result.surcharge ?? 0)}, warnings=${result.validationWarnings?.length ?? 0}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const message = classifyError(error);
    console.error('❌ OCR Handler Error:', message);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
