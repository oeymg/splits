import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { getAvatarColor } from '../theme';

type Props = {
  id: string;
  name: string;
  size?: number;
  style?: ViewStyle;
};

export function AvatarCircle({ id, name, size = 32, style }: Props) {
  const color = getAvatarColor(id);
  const initial = name.charAt(0).toUpperCase();
  const fontSize = size * 0.45;

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}>
      <Text style={[styles.text, { fontSize }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontWeight: '700',
  }
});
