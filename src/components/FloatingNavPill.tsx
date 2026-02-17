import React from 'react';
import { Dimensions, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderRadius, colors, shadows, spacing } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IS_SMALL_SCREEN = SCREEN_WIDTH <= 430;

type Props = {
    onHome: () => void;
    onTryDemo: () => void;
    onPricing: () => void;
    showHome?: boolean;
};

const NAV_ITEMS = ['Home', 'Pricing', 'Try a Demo', 'Contact Us'] as const;

export function FloatingNavPill({ onHome, onTryDemo, onPricing, showHome = true }: Props) {
    const items = showHome ? NAV_ITEMS : NAV_ITEMS.filter((item) => item !== 'Home');

    const handlePress = (item: string) => {
        if (item === 'Home') onHome();
        if (item === 'Try a Demo') onTryDemo();
        if (item === 'Pricing') onPricing();
        if (item === 'Contact Us') Linking.openURL('https://usesplits.app/contact');
    };

    return (
        <View style={styles.floatingPill}>
            {items.map((item, i) => (
                <Pressable
                    key={item}
                    style={({ pressed }) => [
                        styles.pillItem,
                        i < items.length - 1 && styles.pillItemBorder,
                        pressed && { opacity: 0.6 },
                    ]}
                    onPress={() => handlePress(item)}
                >
                    <Text style={styles.pillText}>{item}</Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    floatingPill: {
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        flexDirection: 'row',
        backgroundColor: colors.textMain,
        borderRadius: borderRadius.full,
        paddingVertical: 6,
        paddingHorizontal: 6,
        zIndex: 50,
        ...shadows.lg,
        shadowColor: '#000000',
        shadowOpacity: 0.2,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 10,
    },
    pillItem: {
        paddingVertical: 12,
        paddingHorizontal: IS_SMALL_SCREEN ? 10 : 18,
    },
    pillItemBorder: {
        borderRightWidth: 1,
        borderRightColor: 'rgba(255, 255, 255, 0.1)',
    },
    pillText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#ffffff',
        letterSpacing: 0.2,
    },
});
