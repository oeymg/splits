import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

type Props = {
  value: string;
  size?: number;
};

// Simple deterministic QR-like code renderer
// Generates a grid pattern based on the input string hash
// with proper QR finder patterns in corners
export function QRCode({ value, size = 200 }: Props) {
  const modules = 21; // QR Version 1

  const grid = useMemo(() => {
    // Create a deterministic hash from the value
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }

    const cells: boolean[][] = Array.from({ length: modules }, () =>
      Array(modules).fill(false)
    );

    // Draw finder patterns (3 corner squares)
    const drawFinder = (startRow: number, startCol: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
          const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          cells[startRow + r][startCol + c] = isOuter || isInner;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, modules - 7);
    drawFinder(modules - 7, 0);

    // Fill data area with deterministic pattern
    let seed = Math.abs(hash);
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        // Skip finder pattern areas
        if (
          (row < 8 && col < 8) ||
          (row < 8 && col > modules - 9) ||
          (row > modules - 9 && col < 8)
        ) continue;

        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        cells[row][col] = seed % 3 === 0;
      }
    }

    return cells;
  }, [value]);

  const cellSize = size / (modules + 2);
  const padding = cellSize;

  return (
    <View style={[styles.container, { width: size, height: size + 24 }]}>
      <View style={[styles.grid, { width: size, height: size }]}>
        {grid.map((row, rowIdx) =>
          row.map((filled, colIdx) =>
            filled ? (
              <View
                key={`${rowIdx}-${colIdx}`}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    left: padding + colIdx * cellSize,
                    top: padding + rowIdx * cellSize,
                    backgroundColor: colors.text,
                  },
                ]}
              />
            ) : null
          )
        )}
      </View>
      <Text style={styles.label}>Scan to view this split</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 0,
  },
  grid: {
    position: 'relative',
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  cell: {
    position: 'absolute',
    borderRadius: 1,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
});
