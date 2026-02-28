import { LineItem } from '../types';

export const CATEGORY_EMOJI: Record<string, string> = {
    coffee: '☕',
    alcohol: '🍺',
    drink: '🥤',
    food: '🍽️',
    dessert: '🍰',
    grocery: '🛒',
    fuel: '⛽',
    other: '📦',
};

export function guessCategory(name: string): string {
    const n = name.toLowerCase();
    if (/coffee|latte|flat white|cappuccino|espresso|macchiato|mocha|long black|piccolo|cold brew|affogato/.test(n)) return 'coffee';
    if (/beer|wine|spirits?|vodka|gin|rum|whisky|whiskey|cider|ale|lager|cocktail|margarita|champagne|prosecco|sake|mead/.test(n)) return 'alcohol';
    if (/cake|dessert|ice cream|gelato|cheesecake|brownie|pudding|tart|donut|doughnut|muffin|cookie|biscuit|pastry|waffle|crepe|churro/.test(n)) return 'dessert';
    if (/juice|water|soda|cola|lemonade|smoothie|tea|hot choc|milkshake|frappe|kombucha|sparkling/.test(n)) return 'drink';
    if (/fuel|petrol|diesel|unleaded|e10|98ron|lpg/.test(n)) return 'fuel';
    if (/\b(bag|pack|tin|jar|box|bottle|can)\b/.test(n) && !/beer|wine|water/.test(n)) return 'grocery';
    return 'food';
}

export function getCategoryEmoji(item: LineItem): string {
    const cat = item.category ?? guessCategory(item.name);
    return CATEGORY_EMOJI[cat] ?? '🍽️';
}
