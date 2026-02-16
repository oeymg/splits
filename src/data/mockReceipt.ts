import { ReceiptDraft } from '../types';

export const mockReceipt: ReceiptDraft = {
  merchant: 'Sunset Diner',
  date: '2026-02-07',
  subtotal: 60,
  tax: 5.4,
  total: 65.4,
  rawOcrText: 'SUNSET DINER\nBurger 18.50\nFries 7.00\nSalad 14.00\nSoda 4.50\nPasta 16.00\nTax 5.40\nTotal 65.40',
  lineItems: [
    { id: 'li-1', name: 'Burger', price: 18.5, allocatedTo: [] },
    { id: 'li-2', name: 'Fries', price: 7.0, allocatedTo: [] },
    { id: 'li-3', name: 'Salad', price: 14.0, allocatedTo: [] },
    { id: 'li-4', name: 'Soda', price: 4.5, allocatedTo: [] },
    { id: 'li-5', name: 'Pasta', price: 16.0, allocatedTo: [] }
  ]
};
