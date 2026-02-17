import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { borderRadius, colors, spacing } from '../theme';
import { FloatingNavPill } from '../components/FloatingNavPill';

type Props = {
    onStart: () => void;
    onHome: () => void;
    onTryDemo: () => void;
    onPricing: () => void;
};

export function PricingScreen({ onStart, onHome, onTryDemo, onPricing }: Props) {
    return (
        <SafeAreaView style={styles.safe}>
            <View style={styles.container}>
                <View style={styles.priceRow}>
                    <Text style={styles.title}>free</Text>
                    <Text style={styles.lol}>(lol)</Text>
                </View>
                <Pressable
                    style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
                    onPress={onStart}
                    accessibilityRole="button"
                    accessibilityLabel="Start splitting bills"
                >
                    <Text style={styles.ctaText}>okay i'll split</Text>
                </Pressable>
            </View>
            <FloatingNavPill
                onHome={onHome}
                onTryDemo={onTryDemo}
                onPricing={onPricing}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: colors.bgPrimary,
    },
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
    },
    priceRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 28,
    },
    title: {
        fontSize: 86,
        fontWeight: '900',
        color: colors.textMain,
        letterSpacing: -4,
        lineHeight: 90,
    },
    lol: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.textMuted,
        marginLeft: 8,
        marginBottom: 14,
    },
    cta: {
        backgroundColor: colors.brandCoral,
        borderRadius: borderRadius.full,
        paddingVertical: 16,
        paddingHorizontal: 30,
        shadowColor: colors.brandCoral,
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
    },
    ctaPressed: {
        opacity: 0.92,
        transform: [{ scale: 0.98 }],
    },
    ctaText: {
        color: '#ffffff',
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
});
