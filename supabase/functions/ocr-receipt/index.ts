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

// ─── Structured Output Schema ────────────────────────────────────────
// Guarantees Gemini always returns valid JSON matching this shape.
// No markdown wrapping, no JSON.parse failures.
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
const RECEIPT_PROMPT = `You are an expert Australian receipt parser.

AUSTRALIAN CONTEXT:
- GST (10%) is already INCLUDED in all displayed prices. Do not extract it as a line item.
- Lines like "Incl. GST $2.50", "GST $2.50", or "GST Component" are informational only — skip entirely.
- Weekend, public holiday, or service surcharges (e.g. "15% surcharge $4.50") ARE real charges — put the dollar amount in the surcharge field.

SKIP THESE COMPLETELY — they are not items:
- Payment method lines: EFTPOS, Visa, Mastercard, PayWave, Tap & Go, Contactless, Cash, Change, Refund
- Currency indicators: Lines containing only "AUD" or starting with "AUD $"
- Card detail lines: "Account: ****XXXX", "Auth:", "Approval:", "Reference:", "Transaction ID:", "Receipt #"
- GST lines: "Incl. GST", "GST $", "GST Component", "Tax Invoice"
- Rounding: "Cash rounding", "Rounding adjustment" (AU rounds to 5 cents)
- Savings/loyalty: "You saved", "Member savings", "Points earned", "Rewards", "Discount", "Specials"
- Receipt metadata: ABN, addresses, phone numbers, website URLs, "Thank you", "Guest copy", "Duplicate"
- Order details: table number, seat number, server name, order number, docket number
- Duplicate totals: if "TOTAL" appears twice, use only the last/largest one

EXTRACTION RULES:
- merchant: Business name — usually the largest text at the very top. Not an address.
- date: Output as YYYY-MM-DD. AU receipts use DD/MM/YYYY — convert correctly.
- time: HH:MM in 24-hour format. Null if not found.
- lineItems: Extract EVERY food, drink, or product line that has a name and price > 0.
  - name: Clean descriptive name only. Strip leading product/barcode codes:
    - "516268 Doritos" → "Doritos"
    - "30482355 KALLAX Shelf unit 77x147cm" → "KALLAX Shelf unit 77x147cm"
    - Keep measurements in IKEA names (e.g. "77x147cm").
  - price: The TOTAL price for that line (e.g. "2x Coffee $8.00" → price=8.00, quantity=2).
  - quantity: The number of units if explicitly stated (e.g. "Qty: 2", "2x", "× 2"). Omit if 1.
  - Modifiers that follow an item on the next line with $0 (e.g. "No onion", "Extra shot"): append to item name, do NOT add as separate item.
  - Modifiers with their own price (e.g. "Add Bacon $2.00"): append to item name, add price to item total OR list separately — your choice, but do not double-count.
  - If item name and price appear on separate consecutive lines, merge them into one item.
- subtotal: The pre-surcharge total of items, if explicitly labelled. Null otherwise.
- surcharge: Dollar amount of any surcharge line (weekend, public holiday, service fee). Null if none.
- total: The final amount the customer paid.

QUANTITY GUIDANCE:
- "2x Flat White 8.00" → name="Flat White", price=8.00, quantity=2 (price is the TOTAL for both)
- "Flat White × 3  12.00" → name="Flat White", price=12.00, quantity=3
- "Chicken Burger  18.00" (no quantity shown) → name="Chicken Burger", price=18.00 (omit quantity)
- Do NOT split the total price — return the full line price as given

VENUE HINTS:
- Cafes/Restaurants: food and drink items only. Each line with an item name and price is a line item.
- Supermarkets (Woolworths, Coles, Aldi, IGA): ignore savings, specials, points earned, member prices.
- IKEA: strip 8-digit article codes; keep product name and dimensions.
- Bottle shops/Pubs: alcohol products are valid items.
- Petrol stations: fuel (e.g. "Unleaded 30.5L $1.89/L $57.65") is a valid item — name="Unleaded", price=total fuel cost.

The sum of all lineItem prices should be close to subtotal (or total if no surcharge). If it's off by more than 20%, you likely missed items or misread a price — re-examine.`;

// ─── Helpers ────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function classifyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
    return 'OCR is busy right now — wait a moment and try again.';
  }
  if (msg.includes('503') || msg.toLowerCase().includes('unavailable')) {
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
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries - 1) break;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('All retry attempts failed');
}

// ─── Gemini Vision (PRIMARY) ─────────────────────────────────────────
// Sends the image directly. Gemini sees layout, columns, and alignment.
// Uses structured output — guaranteed valid JSON, no parsing failures.

async function parseWithGeminiVision(base64Image: string, mimeType = 'image/jpeg'): Promise<ParsedReceipt | null> {
  if (!geminiApiKey) return null;

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
              temperature: 0.1,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA
            }
          }),
          signal: AbortSignal.timeout(30000)
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

    // With structured output, text is guaranteed valid JSON — no cleaning needed
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
// Used when image is unavailable. Sends raw OCR text from Vision API.

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
              temperature: 0.1,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA
            }
          }),
          signal: AbortSignal.timeout(20000)
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

      return {
        name: typeof item.name === 'string' ? item.name.trim() : '',
        price: Number.isFinite(price) ? price : 0,
        ...(quantity != null && { quantity })
      };
    })
    .filter((item: ParsedLineItem) => item.name.length > 0 && item.price > 0);

  if (lineItems.length === 0) return null;

  const computedTotal = lineItems.reduce((sum: number, i: ParsedLineItem) => sum + i.price, 0);
  const reportedTotal = typeof parsed.total === 'number' && parsed.total > 0
    ? parsed.total
    : computedTotal;

  const surcharge = typeof parsed.surcharge === 'number' && parsed.surcharge > 0
    ? parsed.surcharge
    : undefined;

  // Validation: do items add up?
  const expectedSubtotal = parsed.subtotal ?? (surcharge ? reportedTotal - surcharge : reportedTotal);
  if (expectedSubtotal > 0 && computedTotal > 0) {
    const ratio = computedTotal / expectedSubtotal;
    if (ratio < 0.5 || ratio > 2.0) {
      validationWarnings.push(`Item sum ($${computedTotal.toFixed(2)}) differs significantly from receipt total ($${expectedSubtotal.toFixed(2)}) — some items may be missing`);
    } else if (ratio < 0.8 || ratio > 1.2) {
      validationWarnings.push('Minor discrepancy between item sum and total — check items');
    }
  }

  if (!parsed.merchant || parsed.merchant.length < 2) {
    validationWarnings.push('Merchant name unclear');
  }

  if (!parsed.date) {
    validationWarnings.push('Date not detected');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    validationWarnings.push('Date format may be incorrect');
  }

  if (reportedTotal > 10000) {
    validationWarnings.push('Unusually high total — please verify');
  }

  const suspiciousItems = lineItems.filter(item => item.price > reportedTotal || (item.quantity ?? 1) > 100);
  if (suspiciousItems.length > 0) {
    validationWarnings.push(`${suspiciousItems.length} item(s) have unusual prices or quantities`);
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
    merchant: parsed.merchant || 'Receipt',
    date: parsed.date || '',
    time,
    subtotal: typeof parsed.subtotal === 'number' ? parsed.subtotal : undefined,
    surcharge,
    total: reportedTotal,
    lineItems,
    rawOcrText,
    validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
  };
}

// ─── Regex Fallback (FALLBACK 2) ─────────────────────────────────────
// Used only when both Gemini paths fail.

const totalKeywords = ['total', 'amount due', 'balance due', 'grand total'];
const subtotalKeywords = ['subtotal', 'sub total', 'sub-total'];
const surchargeKeywords = ['surcharge', 'holiday surcharge', 'weekend surcharge', 'service charge'];
const skipKeywords = [
  'visa', 'mastercard', 'eftpos', 'paywave', 'cash', 'change', 'card', 'payment',
  'abn', 'phone', 'tel', 'fax', 'table', 'order', 'server', 'cashier',
  'thank', 'welcome', 'loyalty', 'points', 'member', 'incl. gst', 'gst component',
  'www.', 'http', '.com', '.au', 'wifi', 'password'
];

const priceRegex = /\$?\s*(-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*(?:[A-Z*])?\s*$/i;
const quantityRegex = /^(\d+)\s*[xX×]\s*/;
const productCodeRegex = /^\d{4,8}\s+/;

const dateRegexes = [
  /\b(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/,
  /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\\d{2,4})\b/
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
  for (const regex of dateRegexes) {
    const match = text.match(regex);
    if (!match) continue;
    if (match[1].length === 4) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
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

  // Merge name lines followed by price-only lines
  const priceOnlyRe = /^\s*\$?\s*-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\s*(?:[A-Z*])?\s*$/i;
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

  const merchant = lines.find((line) => {
    if (line.length < 3 || /^\d+$/.test(line)) return false;
    if (/^\d+\s+(st|rd|th|ave|blvd|street|road|drive)/i.test(line)) return false;
    if (/^(abn|phone|tel|fax)/i.test(line)) return false;
    return /[A-Za-z]{2,}/.test(line);
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
      total = price; continue;
    }
    if (lineHasKeyword(line, subtotalKeywords)) { subtotal = price; continue; }
    if (lineHasKeyword(line, surchargeKeywords)) { surcharge = price; continue; }

    let quantity: number | undefined;
    const qtyMatch = label.match(quantityRegex);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      label = label.replace(quantityRegex, '').trim();
    }

    label = label.replace(productCodeRegex, '').trim();
    label = label.replace(/[.\-_]{3,}$/g, '').replace(/\s{2,}/g, ' ').trim();

    if (label.length >= 2) {
      items.push({ name: label, price, ...(quantity != null && { quantity }) });
    }
  }

  const computedTotal = items.reduce((s, i) => s + i.price, 0);

  return {
    merchant, date, time, subtotal, surcharge,
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
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error('Failed to download image from URL');
      base64Content = arrayBufferToBase64(await resp.arrayBuffer());
    }

    let parsed: ParsedReceipt | null = null;

    // ── Step 2: PRIMARY — Gemini Vision ──
    if (geminiApiKey) {
      console.log('🔍 Attempting Gemini Vision...');
      parsed = await parseWithGeminiVision(base64Content, mimeType);
      if (parsed) {
        console.log(`✅ Gemini Vision: ${parsed.lineItems.length} items, total=$${parsed.total}, surcharge=$${parsed.surcharge ?? 0}`);
      }
    }

    // ── Step 3: FALLBACK 1 — Vision API text → Gemini text ──
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

    console.log(`📊 OCR Complete: method=${result.method}, items=${result.lineItems.length}, total=${result.total}, surcharge=${result.surcharge ?? 0}, warnings=${result.validationWarnings?.length ?? 0}`);

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
