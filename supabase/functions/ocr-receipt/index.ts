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
  tax?: number;
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

// ─── Helpers ────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Retry helper with exponential backoff
 * Retries failed API calls to improve reliability
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on the last attempt
      if (attempt === maxRetries - 1) break;

      // Calculate exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

// ─── Shared Prompt ──────────────────────────────────────────────────
// Used by both Gemini Vision (image) and Gemini Text parsers.

const RECEIPT_PROMPT = `You are an expert receipt parser. Analyze the receipt and extract structured data.

CRITICAL INSTRUCTIONS:
1. EVERY item on the receipt MUST have a name - never leave name empty or use generic text
2. Process EACH LINE that has an item name and price - don't skip lines
3. Item names should be descriptive (e.g. "Burger", "Coffee", "Pizza") NOT codes or numbers

CONTEXT ANALYSIS:
1. Identify the Merchant Name and Venue Type (Restaurant, Bar, Grocery, Retail, Furniture, Warehouse, Café, Taxi, Utility).
2. Use Venue Type to guide extraction:
   - Restaurant/Bar/Café: Expect food/drink items. Ignore table numbers, seat numbers, server names, "Guest Copy".
   - Grocery/Retail: Expect product names/barcodes. Ignore membership/points, "Savings".
   - Furniture/Warehouse: Expect product codes, descriptions, and SKUs (IKEA, Costco).

3. VENDOR-SPECIFIC RULES:

   **IKEA Receipts:**
   - Format: "Article #" or "Item #" followed by article number, then description, then price
   - Example: "30482355 KALLAX Shelf unit $149.00" → name="KALLAX Shelf unit", price=149.00
   - Product codes are 8 digits and should be REMOVED from item names
   - Multiple identical items shown as "Qty: 2" or "2x" on a separate line
   - Look for section headers like "FURNITURE", "HOME DECOR" and skip them
   - IKEA often has measurements in item names (e.g. "60x147 cm") - keep these

   **COSTCO Receipts:**
   - Format: Item number (usually 6-8 digits) + description + price, often split across multiple lines
   - Example: "12345678 Kirkland Water 40pk $5.99" → name="Kirkland Water 40pk", price=5.99
   - Item codes at START of line should be removed from names
   - Codes at END of line (e.g. "E", "A", "T") indicate tax status - ignore these
   - "SUBTOTAL" appears before tax, use this to validate item sum
   - Warehouse/membership numbers should be ignored
   - Prices ending in ".97" are often clearance items (this is normal)

   **ALDI / SUPERMARKET RULES:**
   - **Ignore leading product codes**: 6-digit code before item name (e.g. "516268 Doritos"). Do NOT include in name.
   - **Ignore trailing tax flags**: "A", "B", or "*" after prices (e.g. "6.99 B"). Extract "6.99", ignore the "B".
   - **Weighted Items**: "0.450 kg @ $12.00/kg" → look for FINAL PRICE on that line or nearby. Use total price, not unit price.

   **RESTAURANT RECEIPTS:**
   - Each food/drink item should have a clear name
   - Example: "Cheeseburger 15.50" → name="Cheeseburger", price=15.50
   - Example: "Coke 3.50" → name="Coke", price=3.50
   - If you see a description followed by a price, that's an item - include it!

4. Modifiers: If a line modifies the previous item (e.g. "Add Cheese", "No Ice", or $0.00 options), APPEND it to the item name (e.g. "Burger - Add Cheese"). Do NOT list it separately.

EXTRACTION RULES:
- Merchant name: usually the largest/first text at the top.
- Date: extract in YYYY-MM-DD format. If ambiguous (e.g. 02/03/2024), prefer DD/MM/YYYY (Australian format).
- Time: extract in HH:MM format (24-hour). Look for timestamps near the date, transaction time, or "Time:" labels. If no time is found, use null.
- LINE ITEMS: CRITICAL - Extract EVERY line that has both an item description and a price
  - Each item MUST have a name property that describes what it is
  - "2x Lemonade 12.00" → name="Lemonade", price=12.00, quantity=2
  - "Burger 15.50" → name="Burger", price=15.50, quantity=1
  - "Coffee" on one line, "3.50" on next line → name="Coffee", price=3.50, quantity=1
  - Price must be > 0 to be a standalone item.
  - NEVER leave name empty - always extract the item description
- SKIP: addresses, phone numbers, ABN/tax IDs, payment methods (VISA, EFTPOS), change, loyalty points, barcodes, QR references, "Thank you" messages.
- Extract subtotal, tax/GST/VAT, and total separately.
- BLURRY/FADED TEXT: Use context to infer words. If a price is unclear, look for the column alignment. If completely unreadable, skip the item.

CRITICAL: The sum of all lineItem prices should approximately equal the subtotal (before tax).
If you notice a discrepancy, re-check — you may have missed an item or mis-read a price.

Respond ONLY with valid JSON (no markdown, no backticks, no explanation):
{
  "merchant": "Merchant Name",
  "venueType": "Restaurant",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "lineItems": [
    {"name": "Item Name", "price": 12.50, "quantity": 1}
  ],
  "subtotal": 25.00,
  "tax": 2.50,
  "total": 27.50
}

REMEMBER: EVERY lineItem MUST have a descriptive name field. Never use empty strings or generic placeholders.
If you cannot determine a field, use null or empty string (except for lineItem names - those are required).`;

// ─── Gemini Vision (Multimodal) — PRIMARY ───────────────────────────
// Sends the receipt IMAGE directly to Gemini. It can see layout,
// columns, alignment, and reads receipts far more accurately than
// a text-only pipeline (Vision API → flat text → Gemini).

async function parseWithGeminiVision(base64Image: string): Promise<ParsedReceipt | null> {
  if (!geminiApiKey) return null;

  try {
    // Wrap API call with retry logic for better reliability
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
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                  }
                }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096
            }
          }),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Gemini Vision error:', res.status, errorText);
        throw new Error(`Gemini Vision API error: ${res.status}`);
      }

      return res;
    }, 2); // Max 2 retries for vision (expensive API)

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') return null;

    const result = validateAndBuild(parsed, '(image → Gemini Vision)');
    if (result) {
      result.confidence = 0.95; // High confidence for vision-based parsing
      result.method = 'gemini-vision';
    }

    return result;
  } catch (error) {
    console.error('Gemini Vision failed after retries:', error);
    return null;
  }
}

// ─── Gemini Text Parser — FALLBACK 1 ────────────────────────────────
// Takes OCR text (from Vision API) and parses it with Gemini.

async function parseWithGeminiText(ocrText: string): Promise<ParsedReceipt | null> {
  if (!geminiApiKey) return null;

  const prompt = `${RECEIPT_PROMPT}

OCR TEXT:
${ocrText}`;

  try {
    // Use retry logic for text parsing
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
              maxOutputTokens: 2048
            }
          }),
          signal: AbortSignal.timeout(20000) // 20 second timeout
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Gemini text error:', errorText);
        throw new Error(`Gemini Text API error: ${res.status}`);
      }

      return res;
    }, 2);

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') return null;

    const result = validateAndBuild(parsed, ocrText);
    if (result) {
      result.confidence = 0.75; // Medium-high confidence for text-based parsing
      result.method = 'gemini-text';
    }

    return result;
  } catch (error) {
    console.error('Gemini text failed after retries:', error);
    return null;
  }
}

// ─── Shared Validation & Builder ────────────────────────────────────

function validateAndBuild(parsed: any, rawOcrText: string): ParsedReceipt | null {
  const validationWarnings: string[] = [];

  const lineItems: ParsedLineItem[] = (parsed.lineItems ?? [])
    .map((item: any) => {
      // Coerce price/quantity if they are strings
      let price = item.price;
      if (typeof price === 'string') {
        const cleaned = price.replace(/[^0-9.-]/g, '');
        price = parseFloat(cleaned);
      }

      let quantity = item.quantity ?? 1;
      if (typeof quantity === 'string') {
        const cleaned = quantity.replace(/[^0-9.]/g, '');
        quantity = parseFloat(cleaned) || 1;
      }

      return {
        name: typeof item.name === 'string' ? item.name.trim() : '',
        price: Number.isFinite(price) ? price : 0,
        quantity: Number.isFinite(quantity) ? quantity : 1
      };
    })
    .filter((item: ParsedLineItem) =>
      item.name.length > 0 && item.price !== 0
    );

  if (lineItems.length === 0) return null;

  const computedTotal = lineItems.reduce((sum: number, i: ParsedLineItem) => sum + i.price, 0);
  const reportedTotal = typeof parsed.total === 'number' ? parsed.total : computedTotal;

  // ── Enhanced validation checks ──
  const subtotalOrTotal = parsed.subtotal ?? parsed.total ?? computedTotal;

  // Check 1: Do items roughly add up?
  if (subtotalOrTotal > 0 && computedTotal > 0) {
    const ratio = computedTotal / subtotalOrTotal;
    if (ratio < 0.5 || ratio > 2.0) {
      const warning = `Item sum ($${computedTotal.toFixed(2)}) differs significantly from receipt total ($${subtotalOrTotal.toFixed(2)})`;
      console.warn(`⚠️ ${warning}`);
      validationWarnings.push(warning);
    } else if (ratio < 0.8 || ratio > 1.2) {
      validationWarnings.push('Minor discrepancy between item sum and total');
    }
  }

  // Check 2: Is merchant name valid?
  if (!parsed.merchant || parsed.merchant === 'Receipt' || parsed.merchant.length < 2) {
    validationWarnings.push('Merchant name unclear');
  }

  // Check 3: Is date valid?
  if (!parsed.date || parsed.date === '') {
    validationWarnings.push('Date not detected');
  } else {
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(parsed.date)) {
      validationWarnings.push('Date format may be incorrect');
    }
  }

  // Check 4: Are amounts reasonable?
  if (reportedTotal > 10000) {
    validationWarnings.push('Unusually high total - please verify');
  }

  if (reportedTotal < 0.01) {
    validationWarnings.push('Total is too low');
  }

  // Check 5: Tax validation
  if (parsed.tax && parsed.subtotal) {
    const expectedTaxRatio = parsed.tax / parsed.subtotal;
    if (expectedTaxRatio > 0.25 || expectedTaxRatio < 0.01) {
      validationWarnings.push('Tax amount seems unusual');
    }
  }

  // Check 6: Line items validation
  const suspiciousItems = lineItems.filter(item =>
    item.price > reportedTotal ||
    item.price < 0.01 ||
    item.quantity > 100
  );
  if (suspiciousItems.length > 0) {
    validationWarnings.push(`${suspiciousItems.length} item(s) have unusual prices or quantities`);
  }

  // Validate time format (HH:MM, 24-hour)
  let time: string | undefined;
  if (parsed.time && typeof parsed.time === 'string') {
    const timeMatch = parsed.time.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
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
    tax: typeof parsed.tax === 'number' ? parsed.tax : undefined,
    total: reportedTotal,
    lineItems,
    rawOcrText,
    validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
  };
}

// ─── Regex Fallback Parser — FALLBACK 2 ─────────────────────────────
// Used when both Gemini paths fail. Decent but not as smart.

const totalKeywords = ['total', 'amount due', 'balance due', 'grand total', 'amount'];
const subtotalKeywords = ['subtotal', 'sub total', 'sub-total'];
const taxKeywords = ['tax', 'gst', 'vat', 'service charge', 'surcharge'];
const skipKeywords = [
  'visa', 'mastercard', 'eftpos', 'cash', 'change', 'card', 'payment',
  'abn', 'phone', 'tel', 'fax', 'table', 'order', 'server', 'cashier',
  'thank', 'welcome', 'loyalty', 'points', 'member',
  'www.', 'http', '.com', '.au', 'wifi', 'password'
];

const priceRegex = /\$?\s*(-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*(?:[A-Z*])?\s*$/i;
const quantityRegex = /^(\d+)\s*[xX×]\s*/;
const productCodeRegex = /^\d{4,8}\s+/; // Handles 4-8 digit codes at start (e.g. ALDI: 516268, IKEA: 30482355, Costco: 12345678)

const dateRegexes = [
  /\b(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/,
  /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\\d{2,4})\b/,
  /\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](\\d{2,4})\b/
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
  return keywords.some((keyword) => lowered.includes(keyword));
}

function parseDate(text: string) {
  for (const regex of dateRegexes) {
    const match = text.match(regex);
    if (!match) continue;
    if (match[1].length === 4) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const a = match[1].padStart(2, '0');
    const b = match[2].padStart(2, '0');
    const rawYear = match[3];
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${b}-${a}`;
  }
  return '';
}

const timeRegexes = [
  /\btime[:\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap]m?))?/i,
  /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)\b/i,
  /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/
];

function parseTime(text: string): string {
  for (const regex of timeRegexes) {
    const match = text.match(regex);
    if (!match) continue;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[4]?.toLowerCase();

    if (ampm === 'pm' || ampm === 'p') {
      if (h < 12) h += 12;
    } else if (ampm === 'am' || ampm === 'a') {
      if (h === 12) h = 0;
    }

    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  return '';
}

function parseReceiptFallback(text: string): ParsedReceipt {
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Merge split lines (Vision API puts names and prices on separate lines)
  // Updated: Allow price lines that might have extra spaces or flags
  const priceOnlyRe = /^\s*\$?\s*-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\s*(?:[A-Z*])?\s*$/i;
  const lines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i];
    const nxt = rawLines[i + 1];

    // Check if current line is text and next line is just a price
    if (nxt && !priceOnlyRe.test(cur) && /[A-Za-z0-9]/.test(cur) && priceOnlyRe.test(nxt)) {
      lines.push(`${cur} ${nxt}`);
      i++;
    } else {
      lines.push(cur);
    }
  }

  const merchant = lines.find((line) => {
    if (line.length < 3) return false;
    if (/^\d+$/.test(line)) return false;
    if (/^\d+\s+(st|rd|th|ave|blvd|street|road|drive)/i.test(line)) return false;
    if (/^(abn|phone|tel|fax)/i.test(line)) return false;
    return /[A-Za-z]{2,}/.test(line);
  }) ?? 'Receipt';

  const date = lines.map(parseDate).find((v) => v) ?? '';
  const time = lines.map(parseTime).find((v) => v) || undefined;

  const items: ParsedLineItem[] = [];
  let subtotal: number | undefined;
  let tax: number | undefined;
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
    if (lineHasKeyword(line, taxKeywords)) { tax = price; continue; }

    let quantity = 1;
    const qtyMatch = label.match(quantityRegex);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      label = label.replace(quantityRegex, '').trim();
    }

    // Remove leading product codes from ALDI/IKEA/Costco (e.g. "516268 Doritos", "30482355 KALLAX")
    label = label.replace(productCodeRegex, '').trim();

    label = label.replace(/[.\-_]{3,}$/g, '').replace(/\s{2,}/g, ' ').trim();
    if (label.length >= 2) {
      items.push({ name: label, price, quantity });
    }
  }

  const computedTotal = items.reduce((s, i) => s + i.price, 0);

  return {
    merchant, date, time, subtotal, tax,
    total: total ?? subtotal ?? computedTotal,
    lineItems: items,
    rawOcrText: text,
    confidence: 0.5, // Lower confidence for regex-based parsing
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
      throw new Error('Missing VISION_API_KEY or GEMINI_API_KEY');
    }

    const { imagePath, imageUrl, imageBase64 } = await req.json();
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
      const buffer = await data.arrayBuffer();
      base64Content = arrayBufferToBase64(buffer);
    } else if (imageUrl) {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error('Failed to download image');
      const buffer = await resp.arrayBuffer();
      base64Content = arrayBufferToBase64(buffer);
    }

    let parsed: ParsedReceipt | null = null;

    // ── Step 2: PRIMARY — Gemini Vision (multimodal) ──
    // Sends the image directly. Gemini sees layout, columns, alignment.
    if (geminiApiKey) {
      console.log('🔍 Attempting Gemini Vision (multimodal)...');
      parsed = await parseWithGeminiVision(base64Content);
      if (parsed) {
        console.log(`✅ Gemini Vision: ${parsed.lineItems.length} items, total=$${parsed.total}`);
      }
    }

    // ── Step 3: FALLBACK 1 — Vision API text → Gemini text ──
    if (!parsed && visionApiKey) {
      console.log('⚡ Falling back to Vision API + Gemini text...');

      try {
        // Add retry logic for Vision API
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
                  imageContext: {
                    languageHints: ['en'],
                    textDetectionParams: { enableTextDetectionConfidenceScore: true }
                  }
                }]
              }),
              signal: AbortSignal.timeout(25000) // 25 second timeout
            }
          );

          if (!res.ok) {
            const errorText = await res.text();
            console.error('Vision API error:', errorText);
            throw new Error(`Vision API error: ${res.status}`);
          }

          return res;
        }, 2);

        const visionJson = await visionResp.json();
        const ocrText =
          visionJson?.responses?.[0]?.fullTextAnnotation?.text ??
          visionJson?.responses?.[0]?.textAnnotations?.[0]?.description ??
          '';

        if (ocrText.trim()) {
          // Try Gemini text
          parsed = await parseWithGeminiText(ocrText);
          if (parsed) {
            console.log(`✅ Vision+Gemini text: ${parsed.lineItems.length} items (confidence: ${parsed.confidence})`);
          }

          // FALLBACK 2 — regex
          if (!parsed) {
            console.log('🔧 Using regex fallback...');
            parsed = parseReceiptFallback(ocrText);
            console.log(`✅ Regex: ${parsed.lineItems.length} items (confidence: ${parsed.confidence})`);
          }
        }
      } catch (error) {
        console.error('Vision API failed after retries:', error);
        // Continue to return whatever we have
      }
    }

    // ── Step 4: Return ──
    const result = parsed ?? {
      merchant: 'Receipt',
      date: '',
      total: 0,
      lineItems: [],
      rawOcrText: '',
      confidence: 0,
      method: 'none',
      validationWarnings: ['No OCR method succeeded']
    };

    // Log final result for monitoring
    console.log(`📊 OCR Complete:`, {
      method: result.method,
      confidence: result.confidence,
      itemCount: result.lineItems.length,
      total: result.total,
      warnings: result.validationWarnings?.length ?? 0
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('❌ OCR Handler Error:', error);

    return new Response(JSON.stringify({
      error: (error as Error).message,
      details: error instanceof Error ? error.stack : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
