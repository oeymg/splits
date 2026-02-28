import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ──────────────────────────────────────────────────────────
type ParsedLineItem = { name: string; price: number; quantity?: number; category?: string };

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
const openaiApiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
const bucket = Deno.env.get('RECEIPTS_BUCKET') ?? 'receipts';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

// ─── Prompt ──────────────────────────────────────────────────────────
const RECEIPT_PROMPT = `You are a precise Australian receipt parser for a bill-splitting app. Respond with ONLY valid JSON — no markdown, no code blocks, no explanation.

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
  category: Classify each item as exactly one of these strings:
    • "coffee"  — espresso, latte, flat white, cappuccino, long black, macchiato, cold brew, affogato
    • "alcohol" — beer, wine, spirits, cocktails, cider
    • "drink"   — non-alcoholic non-coffee beverages: juice, water, soda, tea, smoothie, hot chocolate
    • "food"    — cooked meals, snacks, burgers, pizza, sandwiches, chips, anything eaten as a meal
    • "dessert" — cake, ice cream, gelato, brownie, pastry, tart, sweets
    • "grocery" — packaged/supermarket items, household goods
    • "fuel"    — petrol, diesel, unleaded, LPG
    • "other"   — anything that doesn't fit the above

MULTI-LINE ITEMS: If item name is on one line and its price is on the very next line alone, merge them into a single item.

subtotal: Pre-surcharge item total, if explicitly labelled "Subtotal" or "Sub-total". Null otherwise.

surcharge: Dollar amount of any merchant-added surcharge (weekend, public holiday, service fee, credit card fee).
  • "15% weekend surcharge $6.75" → surcharge=6.75
  • "Service fee 10% $4.50" → surcharge=4.50
  • Null if no surcharge.

total: The FINAL amount the customer paid. If printed multiple times, use the last occurrence or the largest value that is less than double the item sum.

SELF-CHECK: Sum your lineItem prices. If the sum is more than 25% away from subtotal (or total if no surcharge), you missed items or misread a price — look again before finalising.

Return JSON exactly matching this structure (no extra fields, no markdown):
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "time": "HH:MM or null",
  "lineItems": [
    { "name": "string", "price": 0.00, "quantity": null, "category": "food" }
  ],
  "subtotal": null,
  "surcharge": null,
  "total": 0.00
}`;

// ─── Helpers ────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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
      if (!isTransientError(error)) throw error;
      if (attempt === maxRetries - 1) break;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1} failed (transient), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('All retry attempts failed');
}

// ─── GPT-4o-mini Vision (PRIMARY) ────────────────────────────────────
async function parseWithGPT4oVision(base64Image: string, mimeType = 'image/jpeg'): Promise<ParsedReceipt | null> {
  if (!openaiApiKey) return null;

  if (base64Image.length > 8_000_000) {
    console.warn(`Image is large (${(base64Image.length / 1_000_000).toFixed(1)}MB base64) — may be slow`);
  }

  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: RECEIPT_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: 'auto'
                }
              }
            ]
          }],
          temperature: 0,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(40000)
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('GPT-4o-mini error:', res.status, errorText);
        throw new Error(`OpenAI API error: ${res.status} — ${errorText.slice(0, 200)}`);
      }
      return res;
    });

    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (!text) return null;

    const parsed = JSON.parse(text);
    const result = validateAndBuild(parsed, '');
    if (result) {
      result.confidence = 0.95;
      result.method = 'gpt4o-vision';
    }
    return result;
  } catch (error) {
    console.error('GPT-4o-mini Vision failed:', classifyError(error));
    return null;
  }
}

// ─── Validation & Builder ────────────────────────────────────────────
function validateAndBuild(parsed: any, rawOcrText: string): ParsedReceipt | null {
  const validationWarnings: string[] = [];

  const VALID_CATEGORIES = new Set(['coffee', 'alcohol', 'drink', 'food', 'dessert', 'grocery', 'fuel', 'other']);

  const lineItems: ParsedLineItem[] = (parsed.lineItems ?? [])
    .map((item: any) => {
      let price = typeof item.price === 'string'
        ? parseFloat(item.price.replace(/[^0-9.-]/g, ''))
        : item.price;

      let quantity = item.quantity ?? undefined;
      if (typeof quantity === 'string') {
        quantity = parseFloat(quantity.replace(/[^0-9.]/g, '')) || undefined;
      }
      if (quantity != null && (!Number.isInteger(quantity) || quantity < 2 || quantity > 99)) {
        quantity = undefined;
      }

      const name = typeof item.name === 'string'
        ? item.name.trim().replace(/[.\-_]{3,}$/, '').replace(/\s{2,}/g, ' ').trim()
        : '';

      const category = typeof item.category === 'string' && VALID_CATEGORIES.has(item.category)
        ? item.category
        : undefined;

      return {
        name,
        price: Number.isFinite(price) ? Math.round(price * 100) / 100 : 0,
        ...(quantity != null && { quantity }),
        ...(category != null && { category })
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

  const expectedSubtotal = typeof parsed.subtotal === 'number' && parsed.subtotal > 0
    ? parsed.subtotal
    : surcharge
      ? Math.round((reportedTotal - surcharge) * 100) / 100
      : reportedTotal;

  if (expectedSubtotal > 0 && computedTotal > 0) {
    const ratio = computedTotal / expectedSubtotal;
    if (ratio < 0.4 || ratio > 2.5) {
      validationWarnings.push(`Item sum (${formatAud(computedTotal)}) differs significantly from receipt total (${formatAud(expectedSubtotal)}) — some items may be missing or mispriced`);
    } else if (ratio < 0.75 || ratio > 1.25) {
      validationWarnings.push('Minor discrepancy between item sum and total — worth double-checking');
    }
  }

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

// ─── Regex Fallback ───────────────────────────────────────────────────
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
const productCodeRegex = /^\d{4,13}\s+/;

const dateRegexes = [
  /\b(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/,
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
  const isoMatch = text.match(dateRegexes[0]);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
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

  const merchant = lines.find((line) => {
    if (line.length < 3 || /^\d+$/.test(line)) return false;
    if (/^\d+\s+(st|rd|nd|th|ave|blvd|street|road|drive|lane|court|crt|pl|place)/i.test(line)) return false;
    if (/^(abn|phone|tel|fax|tax invoice|receipt|duplicate|void)/i.test(line)) return false;
    if (/[^A-Za-z0-9\s&'.\-–]/.test(line) && !/ /.test(line)) return false;
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
    if (!openaiApiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable');
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

    // ── Step 2: PRIMARY — GPT-4o-mini Vision ──
    console.log(`🔍 GPT-4o-mini Vision (${(base64Content.length / 1000).toFixed(0)} KB base64)...`);
    parsed = await parseWithGPT4oVision(base64Content, mimeType);
    if (parsed) {
      console.log(`✅ GPT-4o-mini: ${parsed.lineItems.length} items, total=${formatAud(parsed.total)}, surcharge=${formatAud(parsed.surcharge ?? 0)}`);
    }

    // ── Step 3: FALLBACK — Regex parser ──
    if (!parsed) {
      console.log('🔧 GPT-4o failed — using regex fallback...');
      // For regex we need raw text; without a text extraction step we emit a warning
      parsed = {
        merchant: 'Receipt',
        date: '',
        total: 0,
        lineItems: [],
        rawOcrText: '',
        confidence: 0,
        method: 'none',
        validationWarnings: ['Could not read the receipt. Try a clearer, well-lit photo.']
      };
    }

    console.log(`📊 OCR Complete: method=${parsed.method}, items=${parsed.lineItems.length}, total=${formatAud(parsed.total)}, warnings=${parsed.validationWarnings?.length ?? 0}`);

    return new Response(JSON.stringify(parsed), {
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
