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
 * rounds to 2 decimal places to avoid floating point errors
 */

export function computeSettlements(
  lineItems: LineItem[],
  people: Person[],
  receiptTotal: number,
  payerId: string
): SettlementEntry[] {
  // 1. Initialize per-user totals
  const userSubtotals: Record<string, number> = {};
  const userItems: Record<string, Array<{ name: string; price: number; splitCount: number }>> = {};

  people.forEach((p) => {
    userSubtotals[p.id] = 0;
    userItems[p.id] = [];
  });

  // 2. Calculate sum of all assigned items
  for (const item of lineItems) {
    if (!item.allocatedTo || item.allocatedTo.length === 0) continue;

    const price = item.price;
    const splitCount = item.allocatedTo.length;
    const perPersonPrice = price / splitCount;

    item.allocatedTo.forEach((userId) => {
      // Add to subtotal
      userSubtotals[userId] = (userSubtotals[userId] || 0) + perPersonPrice;

      // Add to item list
      if (!userItems[userId]) userItems[userId] = [];
      userItems[userId].push({
        name: item.name,
        price: perPersonPrice,
        splitCount
      });
    });
  }

  // 3. Build final results — include everyone (payer too)
  return people
    .map((person) => {
      const subtotal = userSubtotals[person.id] || 0;

      return {
        person,
        subtotal: round2(subtotal),
        taxAndTip: 0,
        totalOwed: round2(subtotal),
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

export function formatCurrency(amount: number, currency = 'USD') {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2
    }).format(safeAmount);
  } catch {
    return `$${safeAmount.toFixed(2)}`;
  }
}
