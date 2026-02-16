import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type SectionProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function Section({ title, subtitle, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#1f1f1f',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  },
  header: {
    marginBottom: 12
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1c1c1c'
  },
  subtitle: {
    marginTop: 4,
    color: '#6b6b6b',
    fontSize: 13
  },
  content: {
    gap: 12
  }
});
