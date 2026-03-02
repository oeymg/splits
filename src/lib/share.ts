import { PAYMENT_METHOD_CONFIG, PaymentPrefs, Person, SettlementEntry } from '../types';
import { formatCurrency } from './settlements';

function formatPaymentLine(prefs: PaymentPrefs): string | null {
  const config = PAYMENT_METHOD_CONFIG[prefs.method];
  if (!config) return null;
  if (prefs.method === 'CASH') return `${config.emoji} ${config.label}`;
  if (prefs.handle) return `${config.label}: ${prefs.handle}`;
  if (prefs.note) return prefs.note;
  return null;
}

type ShareMessageParams = {
  groupName: string;
  merchant: string;
  date: string;
  time?: string;
  total: number;
  payer: Person | undefined;
  paymentPrefs?: PaymentPrefs;
  settlements: SettlementEntry[];
  shareUrl?: string | null;
};

export function buildShareMessage({
  groupName,
  settlements,
  shareUrl
}: ShareMessageParams) {
  const lines: string[] = [];

  lines.push(`The split for '${groupName || 'Group'}'.`);
  lines.push('');

  // Show payer's share first
  const payerEntry = settlements.find((s) => s.isPayer);
  if (payerEntry) {
    lines.push(`${payerEntry.person.name} (paid): ${formatCurrency(payerEntry.totalOwed)}`);
  }

  // Then show what others owe
  for (const entry of settlements.filter((s) => !s.isPayer)) {
    lines.push(`${entry.person.name}: ${formatCurrency(entry.totalOwed)}`);
  }

  if (shareUrl) {
    lines.push('');
    lines.push(`To view the Split: ${shareUrl}`);
  }

  return lines.join('\n');
}

export function buildOweMessage({
  amount,
  payer,
  paymentPrefs
}: {
  amount: number;
  payer?: Person;
  paymentPrefs?: PaymentPrefs;
}) {
  const parts: string[] = [];
  parts.push(`You owe ${formatCurrency(amount)}${payer?.name ? ` to ${payer.name}` : ''}.`);

  if (paymentPrefs) {
    const payLine = formatPaymentLine(paymentPrefs);
    if (payLine) parts.push(`${payLine}.`);
  }

  return parts.join(' ');
}
