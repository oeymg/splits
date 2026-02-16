// ── Splits Design System ──
// Cohesive colors, spacing, and styles for the entire app
// Brand colors inspired by warm, friendly coral palette

export const colors = {
  // Primary brand colors
  primary: '#FF5D47',        // Coral - main brand color
  brandCoral: '#FF5D47',     // Coral (alias for primary)
  primaryLight: '#FF8A7A',   // Lighter coral
  primaryDark: '#E54233',    // Darker coral

  // Brand neutrals
  bgPrimary: '#FDFCFB',      // Warm off-white background
  bgCard: '#ffffff',         // Pure white for cards
  bgSubtle: '#FFF7F5',       // Very light coral tint
  bg: '#f6f1ea',             // Warm beige (legacy, for backwards compatibility)

  // Borders
  border: '#e5dfd6',
  borderLight: '#ece7df',
  softBeige: '#F1E9E4',      // Soft beige accent

  // Text colors
  text: '#1A1C1E',           // Almost black
  textMain: '#1A1C1E',       // Alias for text
  textMuted: '#64748B',      // Muted blue-gray
  textLight: '#999',         // Light gray

  // Accent colors
  accent: '#f59e0b',         // Amber
  success: '#10b981',        // Green
  warning: '#f59e0b',        // Amber
  error: '#ef4444',          // Red
  orangeLight: '#FFF7F5',    // Light coral/orange tint

  // Avatars - fun color palette
  avatars: [
    '#ef4444', // Red
    '#f59e0b', // Orange
    '#10b981', // Green
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#14b8a6', // Teal
    '#f97316', // Orange-red
  ]
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  full: 9999
};

export const shadows = {
  sm: {
    shadowColor: '#1f1f1f',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  md: {
    shadowColor: '#1f1f1f',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3
  },
  lg: {
    shadowColor: '#1f1f1f',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  }
};

// Fun emojis for different states
export const emojis = {
  success: ['🎉', '✨', '🎊', '🌟', '💫'],
  money: ['💰', '💸', '💵', '💴', '💶'],
  food: ['🍕', '🍔', '🍜', '🍱', '🥗', '🌮'],
  celebration: ['🥳', '🎉', '✨', '🎊'],
};

// Get a consistent color for a person based on their ID
export function getAvatarColor(id: string): string {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors.avatars[hash % colors.avatars.length];
}

// Get random emoji from category
export function getRandomEmoji(category: keyof typeof emojis): string {
  const options = emojis[category];
  return options[Math.floor(Math.random() * options.length)];
}
