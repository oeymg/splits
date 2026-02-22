import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import { coerceNumber } from '../lib/ocr';
import { computeAllocationSummary, formatCurrency } from '../lib/settlements';
import { LineItem, Person, ReceiptDraft } from '../types';
import { AvatarCircle } from '../components/AvatarCircle';
import { colors, spacing, borderRadius, shadows, getAvatarColor } from '../theme';
import { StepIndicator } from '../components/StepIndicator';

type Props = {
    receipt: ReceiptDraft;
    setReceipt: (fn: (prev: ReceiptDraft) => ReceiptDraft) => void;
    people: Person[];
    onNext: () => void;
    onBack: () => void;
};

export function ItemsScreen({ receipt, setReceipt, people, onNext, onBack }: Props) {
    const summary = computeAllocationSummary(receipt.lineItems, people);
    const unassigned = summary.unassignedTotal;

    const [imageExpanded, setImageExpanded] = useState(false);

    // Entrance animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(60)).current;

    // Per-item stagger animations
    const itemAnimsRef = useRef<Map<string, { opacity: Animated.Value; translateY: Animated.Value; scale: Animated.Value }>>(new Map());
    const mountedRef = useRef(false);

    const getItemAnim = (id: string) => {
        if (!itemAnimsRef.current.has(id)) {
            itemAnimsRef.current.set(id, {
                opacity: new Animated.Value(0),
                translateY: new Animated.Value(22),
                scale: new Animated.Value(0.88)
            });
        }
        return itemAnimsRef.current.get(id)!;
    };

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 350,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 70,
                friction: 10,
                useNativeDriver: true
            })
        ]).start();
    }, []);

    // Stagger items in on mount
    useEffect(() => {
        if (receipt.lineItems.length === 0) return;
        mountedRef.current = true;
        Animated.stagger(
            40,
            receipt.lineItems.map((item) => {
                const anim = getItemAnim(item.id);
                return Animated.parallel([
                    Animated.timing(anim.opacity, {
                        toValue: 1,
                        duration: 280,
                        easing: Easing.out(Easing.quad),
                        useNativeDriver: true
                    }),
                    Animated.spring(anim.translateY, {
                        toValue: 0,
                        tension: 90,
                        friction: 11,
                        useNativeDriver: true
                    }),
                    Animated.spring(anim.scale, {
                        toValue: 1,
                        tension: 90,
                        friction: 11,
                        useNativeDriver: true
                    })
                ]);
            })
        ).start();
    }, []);

    // Animate newly added items
    useEffect(() => {
        if (!mountedRef.current) return;
        receipt.lineItems.forEach((item) => {
            if (!itemAnimsRef.current.has(item.id)) {
                const anim = getItemAnim(item.id);
                Animated.parallel([
                    Animated.timing(anim.opacity, {
                        toValue: 1,
                        duration: 280,
                        easing: Easing.out(Easing.quad),
                        useNativeDriver: true
                    }),
                    Animated.spring(anim.translateY, {
                        toValue: 0,
                        tension: 90,
                        friction: 11,
                        useNativeDriver: true
                    }),
                    Animated.spring(anim.scale, {
                        toValue: 1,
                        tension: 90,
                        friction: 11,
                        useNativeDriver: true
                    })
                ]).start();
            }
        });
        // Clean up removed items
        const currentIds = new Set(receipt.lineItems.map(i => i.id));
        for (const id of itemAnimsRef.current.keys()) {
            if (!currentIds.has(id)) itemAnimsRef.current.delete(id);
        }
    }, [receipt.lineItems]);

    const updateLineItem = (id: string, patch: Partial<LineItem>) => {
        setReceipt((prev) => ({
            ...prev,
            lineItems: prev.lineItems.map((item) => (item.id === id ? { ...item, ...patch } : item))
        }));
    };

    const toggleAllocation = (itemId: string, personId: string) => {
        setReceipt((prev) => ({
            ...prev,
            lineItems: prev.lineItems.map((item) => {
                if (item.id !== itemId) return item;
                const has = item.allocatedTo.includes(personId);
                return {
                    ...item,
                    allocatedTo: has
                        ? item.allocatedTo.filter((id) => id !== personId)
                        : [...item.allocatedTo, personId]
                };
            })
        }));
    };

    const allocateToAll = (itemId: string) => {
        setReceipt((prev) => ({
            ...prev,
            lineItems: prev.lineItems.map((item) =>
                item.id === itemId ? { ...item, allocatedTo: people.map((p) => p.id) } : item
            )
        }));
    };

    const addLineItem = () => {
        setReceipt((prev) => ({
            ...prev,
            lineItems: [
                ...prev.lineItems,
                { id: `li-${Date.now()}`, name: 'New item', price: 0, allocatedTo: [] }
            ]
        }));
    };

    const removeLineItem = (id: string) => {
        setReceipt((prev) => ({
            ...prev,
            lineItems: prev.lineItems.filter((item) => item.id !== id)
        }));
    };

    return (
        <SafeAreaView style={styles.safe}>
            <ScrollView contentContainerStyle={styles.container}>
                <Pressable style={styles.backPill} onPress={onBack}>
                    <Text style={styles.backText}>‹ Back</Text>
                </Pressable>

                <StepIndicator currentStep={3} />

                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }}
                >
                    <Text style={styles.title}>Who owes what? 🧾</Text>
                    <Text style={styles.subtitle}>Tap names to claim items. Hit "All" to split evenly!</Text>
                </Animated.View>

                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }}
                >
                    {receipt.merchant ? (
                        <View style={styles.receiptHeader}>
                            <Text style={styles.receiptMerchant}>📍 {receipt.merchant}</Text>
                            {receipt.date ? <Text style={styles.receiptDate}>{receipt.date}</Text> : null}
                        </View>
                    ) : null}

                    {receipt.imageUri ? (
                        <View style={styles.receiptImageCard}>
                            <Pressable
                                style={styles.receiptImageToggle}
                                onPress={() => setImageExpanded(prev => !prev)}
                            >
                                <Text style={styles.receiptImageToggleText}>
                                    {imageExpanded ? '▲ Hide receipt' : '🧾 View receipt'}
                                </Text>
                            </Pressable>
                            {imageExpanded ? (
                                <ScrollView
                                    style={styles.receiptImageScroll}
                                    nestedScrollEnabled
                                    showsVerticalScrollIndicator={false}
                                >
                                    <Image
                                        source={{ uri: receipt.imageUri }}
                                        style={styles.receiptImage}
                                        resizeMode="contain"
                                    />
                                </ScrollView>
                            ) : null}
                        </View>
                    ) : null}

                {receipt.lineItems.map((item) => {
                    const anim = getItemAnim(item.id);
                    return (
                    <Animated.View
                        key={item.id}
                        style={[
                            styles.itemCard,
                            { opacity: anim.opacity, transform: [{ translateY: anim.translateY }, { scale: anim.scale }] }
                        ]}
                    >
                        <View style={styles.itemRow}>
                            <TextInput
                                style={styles.itemName}
                                value={item.name}
                                onChangeText={(v) => updateLineItem(item.id, { name: v })}
                            />
                            <TextInput
                                style={styles.itemPrice}
                                value={item.price.toString()}
                                keyboardType="decimal-pad"
                                onChangeText={(v) => updateLineItem(item.id, { price: coerceNumber(v) })}
                            />
                            <Pressable onPress={() => removeLineItem(item.id)} style={styles.removeBtn}>
                                <Text style={styles.removeBtnText}>✕</Text>
                            </Pressable>
                        </View>
                        <View style={styles.chipWrap}>
                            {people.map((person) => {
                                const isSelected = item.allocatedTo.includes(person.id);
                                const avatarColor = getAvatarColor(person.id);
                                return (
                                    <Pressable
                                        key={person.id}
                                        onPress={() => toggleAllocation(item.id, person.id)}
                                        style={[
                                            styles.chip,
                                            isSelected && {
                                                backgroundColor: avatarColor,
                                                borderColor: avatarColor,
                                                ...shadows.sm
                                            }
                                        ]}
                                    >
                                        <AvatarCircle id={person.id} name={person.name} size={20} />
                                        <Text
                                            style={[
                                                styles.chipText,
                                                isSelected && styles.chipTextActive
                                            ]}
                                        >
                                            {person.name}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                            <Pressable style={styles.allButton} onPress={() => allocateToAll(item.id)}>
                                <Text style={styles.allButtonText}>✨ All</Text>
                            </Pressable>
                        </View>
                    </Animated.View>
                    );
                })}

                <Pressable style={styles.addItemButton} onPress={addLineItem}>
                    <Text style={styles.addItemText}>+ Add another item</Text>
                </Pressable>

                <View style={styles.totalsCard}>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Items subtotal</Text>
                        <Text style={styles.totalValue}>{formatCurrency(summary.subtotal)}</Text>
                    </View>
                    <View style={styles.surchargeRow}>
                        <Text style={styles.totalLabel}>Surcharge</Text>
                        <Text style={styles.surchargeHint}>(weekend, public holiday, etc.)</Text>
                        <TextInput
                            style={styles.surchargeInput}
                            value={receipt.surcharge ? receipt.surcharge.toString() : ''}
                            placeholder="0.00"
                            keyboardType="decimal-pad"
                            onChangeText={(v) =>
                                setReceipt((prev) => ({ ...prev, surcharge: coerceNumber(v) || undefined }))
                            }
                        />
                    </View>
                    <View style={[styles.totalRow, styles.grandTotalRow]}>
                        <Text style={[styles.totalLabel, styles.grandTotalLabel]}>Total</Text>
                        <Text style={[styles.totalValue, styles.grandTotalValue]}>
                            {formatCurrency(summary.subtotal + (receipt.surcharge || 0))}
                        </Text>
                    </View>
                    {unassigned > 0 ? (
                        <Text style={styles.warningText}>⚠️ {formatCurrency(unassigned)} still needs homes</Text>
                    ) : (
                        <Text style={styles.successText}>✓ Everyone's claimed their items!</Text>
                    )}
                </View>

                    <Pressable style={styles.nextButton} onPress={onNext}>
                        <Text style={styles.nextButtonText}>Almost there! → Summary</Text>
                    </Pressable>
                </Animated.View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bgPrimary },
    container: { padding: spacing.xl, paddingBottom: 60 },

    backPill: {
        alignSelf: 'flex-start',
        backgroundColor: colors.bgSubtle,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.full,
        marginBottom: spacing.lg,
    },
    backText: {
        fontSize: 14,
        color: colors.textMuted,
        fontWeight: '600'
    },
    title: {
        fontSize: 32,
        fontWeight: '800',
        color: colors.text,
        marginBottom: 4,
        letterSpacing: -1
    },
    subtitle: {
        fontSize: 15,
        color: colors.textMuted,
        marginBottom: spacing.xxl
    },
    receiptHeader: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.lg,
        marginBottom: spacing.lg,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        ...shadows.sm
    },
    receiptMerchant: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.text
    },
    receiptDate: {
        fontSize: 13,
        color: colors.textMuted
    },

    itemCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.lg,
        marginBottom: spacing.md,
        ...shadows.md
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.md
    },
    itemName: {
        flex: 1,
        fontSize: 15,
        color: colors.text,
        fontWeight: '600',
        minWidth: 0,
    },
    itemPrice: {
        width: 80,
        fontSize: 15,
        fontWeight: '700',
        color: colors.text,
        textAlign: 'right',
        backgroundColor: colors.bgSubtle,
        borderRadius: borderRadius.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border
    },
    removeBtn: {
        padding: spacing.sm
    },
    removeBtnText: {
        fontSize: 16,
        color: colors.textLight,
        fontWeight: '600'
    },
    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.bgSubtle,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.full,
        borderWidth: 2,
        borderColor: colors.border
    },
    chipText: {
        color: colors.text,
        fontSize: 13,
        fontWeight: '600'
    },
    chipTextActive: {
        color: '#ffffff',
        fontWeight: '700'
    },
    allButton: {
        backgroundColor: colors.primary + '15',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.full,
        borderWidth: 2,
        borderColor: colors.primary
    },
    allButtonText: {
        color: colors.primary,
        fontSize: 13,
        fontWeight: '700'
    },
    addItemButton: {
        borderWidth: 2,
        borderColor: colors.border,
        borderStyle: 'dashed',
        borderRadius: borderRadius.lg,
        paddingVertical: spacing.lg,
        alignItems: 'center',
        marginBottom: spacing.lg,
        marginTop: spacing.sm
    },
    addItemText: {
        color: colors.textMuted,
        fontSize: 15,
        fontWeight: '600'
    },

    totalsCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.lg,
        marginBottom: spacing.lg,
        ...shadows.md
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: spacing.xs
    },
    totalLabel: {
        fontSize: 15,
        color: colors.text,
        fontWeight: '600'
    },
    totalValue: {
        fontSize: 16,
        fontWeight: '800',
        color: colors.text
    },
    surchargeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.sm,
        flexWrap: 'wrap'
    },
    surchargeHint: {
        fontSize: 12,
        color: colors.textMuted,
        flex: 1
    },
    surchargeInput: {
        width: 80,
        fontSize: 15,
        fontWeight: '700',
        color: colors.text,
        textAlign: 'right',
        backgroundColor: colors.bgSubtle,
        borderRadius: borderRadius.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border
    },
    grandTotalRow: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.sm,
        marginTop: spacing.xs,
        marginBottom: spacing.sm
    },
    grandTotalLabel: {
        fontSize: 16,
        fontWeight: '700'
    },
    grandTotalValue: {
        fontSize: 18,
        color: colors.primary
    },
    warningText: {
        fontSize: 13,
        color: colors.warning,
        marginTop: spacing.sm,
        fontWeight: '600'
    },
    successText: {
        fontSize: 13,
        color: colors.success,
        marginTop: spacing.sm,
        fontWeight: '600'
    },

    nextButton: {
        backgroundColor: colors.primary,
        paddingVertical: 20,
        borderRadius: borderRadius.xxl,
        alignItems: 'center',
        ...shadows.md
    },
    nextButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700'
    },

    receiptImageCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        marginBottom: spacing.md,
        overflow: 'hidden',
        ...shadows.sm
    },
    receiptImageToggle: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
    },
    receiptImageToggleText: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.primary,
    },
    receiptImageScroll: {
        maxHeight: 480,
    },
    receiptImage: {
        width: '100%',
        height: 900,
    },
});
