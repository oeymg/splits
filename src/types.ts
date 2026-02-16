export type PaymentMethod =
  | 'VENMO'
  | 'PAYPAL'
  | 'ZELLE'
  | 'CASHAPP'
  | 'PAYID'
  | 'BANK_TRANSFER'
  | 'CASH'
  | 'OTHER';

export type PaymentPrefs = {
  method: PaymentMethod;
  handle?: string;
  note?: string;
};

export const PAYMENT_METHOD_CONFIG: Record<
  PaymentMethod,
  { label: string; emoji: string; placeholder: string; keyboardType: 'default' | 'email-address' | 'phone-pad' }
> = {
  VENMO: { label: 'Venmo', emoji: '💸', placeholder: '@username', keyboardType: 'default' },
  PAYPAL: { label: 'PayPal', emoji: '🅿️', placeholder: 'email or @username', keyboardType: 'email-address' },
  ZELLE: { label: 'Zelle', emoji: '💲', placeholder: 'email or phone', keyboardType: 'email-address' },
  CASHAPP: { label: 'Cash App', emoji: '💵', placeholder: '$cashtag', keyboardType: 'default' },
  PAYID: { label: 'PayID', emoji: '🏦', placeholder: 'you@payid or phone', keyboardType: 'email-address' },
  BANK_TRANSFER: { label: 'Bank', emoji: '🏧', placeholder: 'BSB + Account or IBAN', keyboardType: 'default' },
  CASH: { label: 'Cash', emoji: '💰', placeholder: '', keyboardType: 'default' },
  OTHER: { label: 'Other', emoji: '📝', placeholder: 'Details for payment', keyboardType: 'default' },
};

export type Person = {
  id: string;
  name: string;
  phone?: string;
  paymentPrefs?: PaymentPrefs;
};

export type LineItem = {
  id: string;
  name: string;
  price: number;
  allocatedTo: string[];
};

export type ReceiptDraft = {
  merchant: string;
  date: string;
  time?: string;
  total: number;
  subtotal?: number;
  tax?: number;
  imageUri?: string;
  rawOcrText?: string;
  lineItems: LineItem[];
  confidence?: number;
  method?: string;
  validationWarnings?: string[];
};

export type AllocationSummary = {
  owedByUserId: Record<string, number>;
  unassignedTotal: number;
  subtotal: number;
};

export type SettlementEntry = {
  person: Person;
  totalOwed: number;
  subtotal: number;
  taxAndTip: number;
  isPayer: boolean;
  items: Array<{ name: string; price: number; splitCount: number }>;
};
