import { supabase, isSupabaseConfigured } from './supabase';
import { Person, ReceiptDraft, LineItem } from '../types';

// Generate a short random ID for shareable links
function generateShortId(length = 8): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // no confusing chars (0/O, 1/l)
  let result = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

export type SplitData = {
  groupName: string;
  people: Person[];
  payerId: string;
  receipt: ReceiptDraft;
};

export type SavedSplit = SplitData & {
  shareId: string;
  createdAt: string;
};

const SHARE_BASE_URL = 'https://usesplits.app/split/';

// Save a split to Supabase and return a shareable link
export async function saveSplit(data: SplitData): Promise<{ shareId: string; shareUrl: string; error: string | null }> {
  const shareId = generateShortId();
  const shareUrl = `${SHARE_BASE_URL}${shareId}`;

  if (!isSupabaseConfigured || !supabase) {
    // Fallback: use the share base URL with the generated ID
    // Without a backend, the link serves as a reference ID only
    return { shareId, shareUrl, error: null };
  }

  try {
    const { error } = await supabase
      .from('splits')
      .insert({
        share_id: shareId,
        group_name: data.groupName,
        people: data.people,
        payer_id: data.payerId,
        receipt: {
          merchant: data.receipt.merchant,
          date: data.receipt.date,
          total: data.receipt.total,
          subtotal: data.receipt.subtotal,
          tax: data.receipt.tax,
          lineItems: data.receipt.lineItems
        }
      });

    if (error) {
      return { shareId, shareUrl, error: error.message };
    }

    return { shareId, shareUrl, error: null };
  } catch (err) {
    return { shareId, shareUrl: '', error: String(err) };
  }
}

// Load a split by its share ID
export async function loadSplit(shareId: string): Promise<{ data: SplitData | null; error: string | null }> {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('splits')
      .select('*')
      .eq('share_id', shareId)
      .single();

    if (error || !data) {
      return { data: null, error: error?.message ?? 'Split not found' };
    }

    return {
      data: {
        groupName: data.group_name,
        people: data.people as Person[],
        payerId: data.payer_id,
        receipt: data.receipt as ReceiptDraft
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// Generate the share URL for a given ID
export function getShareUrl(shareId: string): string {
  return `${SHARE_BASE_URL}${shareId}`;
}

