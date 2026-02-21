import { LineItem, Person, SettlementEntry } from '../types';

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

// ─── Math & Logic ───────────────────────────────────────────────────

export function computeAllocationSummary(lineItems: LineItem[], people: Person[]) {
  const owedByUserId: Record<string, number> = {};
  let unassignedTotal = 0;
  let subtotal = 0;

  for (const person of people) {
    owedByUserId[person.id] = 0;
  }

  for (const item of lineItems) {
    subtotal = round2(subtotal + item.price);
    if (!item.allocatedTo || item.allocatedTo.length === 0) {
      unassignedTotal = round2(unassignedTotal + item.price);
      continue;
    }

    const split = item.price / item.allocatedTo.length;
    for (const userId of item.allocatedTo) {
      owedByUserId[userId] = round2((owedByUserId[userId] ?? 0) + split);
    }
  }

  return { owedByUserId, unassignedTotal, subtotal };
}

/**
 * Computes per-person settlements.
 * Surcharge (e.g. weekend/public holiday surcharge) is distributed
 * proportionally based on each person's share of the item subtotal.
 * In Australia, GST is already included in item prices — do not pass tax here.
 */
export function computeSettlements(
  lineItems: LineItem[],
  people: Person[],
  receiptTotal: number,
  payerId: string,
  surcharge = 0
): SettlementEntry[] {
  // 1. Initialize per-user totals
  const userSubtotals: Record<string, number> = {};
  const userItems: Record<string, Array<{ name: string; price: number; splitCount: number }>> = {};

  people.forEach((p) => {
    userSubtotals[p.id] = 0;
    userItems[p.id] = [];
  });

  // 2. Calculate sum of all assigned items
  let assignedTotal = 0;
  for (const item of lineItems) {
    if (!item.allocatedTo || item.allocatedTo.length === 0) continue;

    const price = item.price;
    const splitCount = item.allocatedTo.length;
    const perPersonPrice = price / splitCount;

    item.allocatedTo.forEach((userId) => {
      userSubtotals[userId] = (userSubtotals[userId] || 0) + perPersonPrice;
      if (!userItems[userId]) userItems[userId] = [];
      userItems[userId].push({ name: item.name, price: perPersonPrice, splitCount });
    });

    assignedTotal += price;
  }

  // 3. Build final results with proportional surcharge
  return people
    .map((person) => {
      const subtotal = round2(userSubtotals[person.id] || 0);

      // Distribute surcharge proportionally to each person's item share
      const personSurcharge =
        surcharge > 0 && assignedTotal > 0
          ? round2((subtotal / assignedTotal) * surcharge)
          : 0;

      return {
        person,
        subtotal,
        surcharge: personSurcharge,
        totalOwed: round2(subtotal + personSurcharge),
        isPayer: person.id === payerId,
        items: userItems[person.id] || []
      };
    })
    .filter((entry) => entry.totalOwed > 0)
    .sort((a, b) => {
      // Payer first, then alphabetical
      if (a.isPayer !== b.isPayer) return a.isPayer ? -1 : 1;
      return a.person.name.localeCompare(b.person.name);
    });
}

export function formatCurrency(amount: number, currency = 'AUD') {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2
    }).format(safeAmount);
  } catch {
    return `$${safeAmount.toFixed(2)}`;
  }
}
