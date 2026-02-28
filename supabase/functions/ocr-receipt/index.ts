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
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? Deno.env.get('Anthropic_API_Key') ?? '';
const bucket = Deno.env.get('RECEIPTS_BUCKET') ?? 'receipts';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

// ─── Prompt ──────────────────────────────────────────────────────────
const RECEIPT_PROMPT = `Parse this Australian receipt for a bill-splitting app. Your entire response must be ONLY a single JSON object — no markdown, no explanation, no extra text.

SKIP these lines: payment (EFTPOS/card/cash/change/refund/approved), card details (Auth/RRN/account#), tax (GST/ABN), rounding, loyalty/points, store metadata (address/phone/URL/"Thank you"), order info (table/server/docket). Use only the FINAL total value.

Fields to extract:
merchant: Business name at top. Empty string if unclear.
date: YYYY-MM-DD. AU receipts use DD/MM/YYYY — convert carefully.
time: HH:MM 24h, or null.
lineItems: Every purchased item with price > 0.
  name: Clean name. Strip leading barcodes/codes. Strip trailing dots. Append free modifiers to parent. Merge priced add-ons into parent name and add their price.
  price: Line total as printed. "2x Coffee $8" → price=8, qty=2 (never divide). "Coffee $4×3" → price=12, qty=3. Fuel: use the dollar total, not per-litre.
  quantity: Only if explicitly shown (2x / Qty 3 / ×2). Omit if 1. Portion sizes like "6 piece" are NOT quantity.
  category: exactly one of "coffee" "alcohol" "drink" "food" "dessert" "grocery" "fuel" "other"
subtotal: Dollar amount if labelled "Subtotal"/"Sub-total", else null.
surcharge: Weekend/holiday/service/card fee dollar amount, else null.
total: Final amount paid.

Output this exact JSON structure filled with the receipt data:
{"merchant":"","date":"","time":null,"lineItems":[{"name":"","price":0.00,"category":"food"}],"subtotal":null,"surcharge":null,"total":0.00}`;

// ─── Helpers ────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
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

// ─── Claude Haiku Vision (PRIMARY) ───────────────────────────────────
async function parseWithClaude(base64Image: string, mimeType = 'image/jpeg'): Promise<ParsedReceipt | null> {
  if (!anthropicApiKey) return null;

  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: base64Image }
              },
              { type: 'text', text: RECEIPT_PROMPT }
            ]
          }]
        }),
        signal: AbortSignal.timeout(25000)
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Claude error:', res.status, errorText);
        throw new Error(`Anthropic API error: ${res.status} — ${errorText.slice(0, 200)}`);
      }
      return res;
    });

    const json = await response.json();
    const raw = json?.content?.[0]?.text ?? '';
    if (!raw) {
      console.error('Claude returned empty content');
      return null;
    }

    // Extract JSON — strip any markdown wrapping just in case
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in Claude response:', raw.slice(0, 300));
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = validateAndBuild(parsed, '');
    if (result) {
      result.confidence = 0.95;
      result.method = 'claude-haiku-vision';
    }
    return result;
  } catch (error) {
    console.error('Claude Vision failed:', classifyError(error));
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
    if (!anthropicApiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable');
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

    // ── Step 2: PRIMARY — Claude Haiku Vision ──
    console.log(`🔍 Claude Haiku Vision (${(base64Content.length / 1000).toFixed(0)} KB)...`);
    parsed = await parseWithClaude(base64Content, mimeType);
    if (parsed) {
      console.log(`✅ Claude: ${parsed.lineItems.length} items, total=${formatAud(parsed.total)}, surcharge=${formatAud(parsed.surcharge ?? 0)}`);
    }

    // ── Step 3: FALLBACK ──
    if (!parsed) {
      console.log('🔧 Claude failed — using regex fallback...');
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
