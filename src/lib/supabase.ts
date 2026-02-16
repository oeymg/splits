import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    })
  : null;

export async function uploadReceiptImage(fileUri: string) {
  if (!isSupabaseConfigured || !supabase) {
    return { publicUrl: fileUri, path: null, error: null };
  }

  try {
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const filePath = `receipt-${Date.now()}.jpg`;

    const { error } = await supabase.storage.from('receipts').upload(filePath, blob, {
      contentType: 'image/jpeg',
      upsert: true
    });

    if (error) {
      return { publicUrl: fileUri, path: null, error };
    }

    const { data } = supabase.storage.from('receipts').getPublicUrl(filePath);
    return { publicUrl: data.publicUrl, path: filePath, error: null };
  } catch (error) {
    return { publicUrl: fileUri, path: null, error };
  }
}
