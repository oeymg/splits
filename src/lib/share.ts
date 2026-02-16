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
};

export function buildShareMessage({
  groupName,
  merchant,
  date,
  time,
  total,
  payer,
  paymentPrefs,
  settlements
}: ShareMessageParams) {
  const lines: string[] = [];

  lines.push(`${groupName || 'Group'} · ${merchant || 'Receipt'}`);
  if (date) {
    lines.push(`Date: ${date}${time ? ` at ${time}` : ''}`);
  }
  if (Number.isFinite(total) && total > 0) {
    lines.push(`Total: ${formatCurrency(total)}`);
  }

  lines.push('');

  if (payer) {
    lines.push(`Pay to: ${payer.name}`);
  }

  if (paymentPrefs) {
    const payLine = formatPaymentLine(paymentPrefs);
    if (payLine) lines.push(payLine);
  }

  if (settlements.length) {
    lines.push('');

    // Show payer's share first
    const payerEntry = settlements.find((s) => s.isPayer);
    if (payerEntry) {
      lines.push(`${payerEntry.person.name} (paid): ${formatCurrency(payerEntry.totalOwed)}`);
      for (const item of payerEntry.items) {
        lines.push(`  • ${item.name} (${formatCurrency(item.price)})`);
      }
      lines.push('');
    }

    // Then show what others owe
    const others = settlements.filter((s) => !s.isPayer);
    if (others.length) {
      lines.push('Others owe:');
      for (const entry of others) {
        lines.push(`${entry.person.name}: ${formatCurrency(entry.totalOwed)}`);
        for (const item of entry.items) {
          lines.push(`  • ${item.name} (${formatCurrency(item.price)})`);
        }
        lines.push('');
      }
    }
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
