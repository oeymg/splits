import React, { useState, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PaymentMethod, PAYMENT_METHOD_CONFIG, Person } from '../types';
import { AvatarCircle } from '../components/AvatarCircle';
import { colors, spacing, borderRadius, shadows } from '../theme';
import { StepIndicator } from '../components/StepIndicator';

type Props = {
    groupName: string;
    setGroupName: (name: string) => void;
    people: Person[];
    setPeople: (fn: (prev: Person[]) => Person[]) => void;
    payerId: string;
    setPayerId: (id: string) => void;
    onNext: () => void;
    onBack: () => void;
};

export function GroupScreen({
    groupName,
    setGroupName,
    people,
    setPeople,
    payerId,
    setPayerId,
    onNext,
    onBack
}: Props) {
    const [newName, setNewName] = useState('');
    const payer = people.find((p) => p.id === payerId);

    // Entrance animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(30)).current;


    useEffect(() => {
        // Fade and slide in
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 600,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 50,
                friction: 8,
                useNativeDriver: true
            }),
        ]).start();
    }, []);

    const addPerson = () => {
        if (!newName.trim()) return;
        setPeople((prev) => [...prev, { id: `p-${Date.now()}`, name: newName.trim() }]);
        setNewName('');
    };

    const removePerson = (id: string) => {
        if (id === 'me') return;
        setPeople((prev) => prev.filter((p) => p.id !== id));
        if (payerId === id) setPayerId('me');
    };

    const selectedMethod = payer?.paymentPrefs?.method as PaymentMethod | undefined;

    const selectMethod = (method: PaymentMethod) => {
        setPeople((prev) =>
            prev.map((p) =>
                p.id === payerId
                    ? { ...p, paymentPrefs: { method, handle: p.paymentPrefs?.method === method ? p.paymentPrefs?.handle : '' } }
                    : p
            )
        );
    };

    const updateHandle = (value: string) => {
        setPeople((prev) =>
            prev.map((p) =>
                p.id === payerId && p.paymentPrefs
                    ? { ...p, paymentPrefs: { ...p.paymentPrefs, handle: value } }
                    : p
            )
        );
    };

    const canProceed = people.length >= 2 && groupName.trim().length > 0;


    return (
        <SafeAreaView style={styles.safe}>
            <ScrollView contentContainerStyle={styles.container}>
                <Pressable style={styles.backPill} onPress={onBack}>
                    <Text style={styles.backText}>‹ Back</Text>
                </Pressable>

                <StepIndicator currentStep={1} />

                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }}
                >
                    <Text style={styles.title}>Who's in? 👥</Text>
                    <Text style={styles.subtitle}>Add everyone who joined the fun (and the bill!)</Text>
                </Animated.View>

                {/* Group Name */}
                <Animated.View
                    style={[
                        styles.section,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }]
                        }
                    ]}
                >
                    <Text style={styles.label}>🏷️ Group name</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Friday Dinner, Team Lunch"
                        placeholderTextColor={colors.textLight}
                        value={groupName}
                        onChangeText={setGroupName}
                        autoCapitalize="words"
                    />
                </Animated.View>

                {/* People */}
                <Animated.View
                    style={[
                        styles.section,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }]
                        }
                    ]}
                >
                    <Text style={styles.label}>👥 People ({people.length})</Text>
                    <Text style={styles.hint}>
                        Tap who paid the bill • Hold to remove someone
                    </Text>

                    {people.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyIcon}>👻</Text>
                            <Text style={styles.emptyText}>It's a bit lonely here!</Text>
                            <Text style={styles.emptyHint}>Add yourself and your friends below</Text>
                        </View>
                    ) : (
                        <View style={styles.peopleGrid}>
                            {people.map((person) => {
                                const isPayer = payerId === person.id;
                                return (
                                    <Pressable
                                        key={person.id}
                                        onPress={() => setPayerId(person.id)}
                                        onLongPress={() => removePerson(person.id)}
                                        style={[
                                            styles.personCard,
                                            isPayer && styles.personCardActive
                                        ]}
                                    >
                                        <AvatarCircle id={person.id} name={person.name} size={48} />
                                        <Text style={[styles.personName, isPayer && styles.personNameActive]}>
                                            {person.name}
                                        </Text>
                                        {isPayer && (
                                            <View style={styles.payerBadge}>
                                                <Text style={styles.payerBadgeText}>💳 Paid</Text>
                                            </View>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}
                </Animated.View>

                {/* Add Person */}
                <Animated.View
                    style={[
                        styles.section,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }]
                        }
                    ]}
                >
                    <Text style={styles.label}>➕ Add someone</Text>
                    <View style={styles.addRow}>
                        <TextInput
                            style={[styles.input, { flex: 1 }]}
                            placeholder="Enter name"
                            placeholderTextColor={colors.textLight}
                            value={newName}
                            onChangeText={setNewName}
                            onSubmitEditing={addPerson}
                            autoCapitalize="words"
                        />
                        <Pressable
                            style={[styles.addButton, !newName.trim() && styles.addButtonDisabled]}
                            onPress={addPerson}
                            disabled={!newName.trim()}
                        >
                            <Text style={styles.addButtonText}>+ Add</Text>
                        </Pressable>
                    </View>
                </Animated.View>

                {/* Payment Method (optional) */}
                {payer && (
                    <Animated.View
                        style={[
                            styles.section,
                            {
                                opacity: fadeAnim,
                                transform: [{ translateY: slideAnim }]
                            }
                        ]}
                    >
                        <Text style={styles.label}>
                            💳 {payer.name}'s payment method <Text style={styles.optional}>(optional)</Text>
                        </Text>
                        <Text style={styles.hint}>
                            Makes it super easy for everyone to pay {payer.name} back!
                        </Text>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.methodScroll}
                        >
                            {(Object.keys(PAYMENT_METHOD_CONFIG) as PaymentMethod[]).map((method) => {
                                const config = PAYMENT_METHOD_CONFIG[method];
                                const isActive = selectedMethod === method;
                                return (
                                    <Pressable
                                        key={method}
                                        style={[styles.methodPill, isActive && styles.methodPillActive]}
                                        onPress={() => selectMethod(method)}
                                    >
                                        <Text style={styles.methodEmoji}>{config.emoji}</Text>
                                        <Text style={[styles.methodLabel, isActive && styles.methodLabelActive]}>
                                            {config.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                        {selectedMethod && selectedMethod !== 'CASH' && (
                            <TextInput
                                style={[styles.input, { marginTop: spacing.md }]}
                                placeholder={PAYMENT_METHOD_CONFIG[selectedMethod].placeholder}
                                placeholderTextColor={colors.textLight}
                                value={payer?.paymentPrefs?.handle ?? ''}
                                onChangeText={updateHandle}
                                keyboardType={PAYMENT_METHOD_CONFIG[selectedMethod].keyboardType}
                                autoCapitalize="none"
                            />
                        )}
                    </Animated.View>
                )}

                {/* Next Button */}
                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }}
                >
                    <Pressable
                        style={({ pressed }) => [
                            styles.nextButton,
                            !canProceed && styles.nextButtonDisabled,
                            pressed && canProceed && { transform: [{ scale: 0.98 }] }
                        ]}
                        onPress={onNext}
                        disabled={!canProceed}
                    >
                        <Text style={styles.nextButtonText}>
                            {canProceed ? "Let's go! → Scan Receipt" : 'Add at least 2 people to get started'}
                        </Text>
                    </Pressable>

                    {!canProceed && people.length >= 2 && (
                        <Text style={styles.warningText}>💡 Don't forget a group name!</Text>
                    )}
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
        letterSpacing: -1,
        marginBottom: 4
    },

    subtitle: {
        fontSize: 15,
        color: colors.textMuted,
        marginBottom: spacing.xxl
    },

    section: {
        marginBottom: spacing.xxl
    },

    label: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.text,
        marginBottom: spacing.sm
    },

    optional: {
        fontWeight: '500',
        color: colors.textLight
    },

    hint: {
        fontSize: 12,
        color: colors.textLight,
        marginBottom: spacing.md,
        lineHeight: 16
    },

    input: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xl,
        borderWidth: 2,
        borderColor: colors.border,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        fontSize: 16,
        color: colors.text,
        ...shadows.sm
    },

    emptyState: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xxxl,
        alignItems: 'center',
        borderWidth: 2,
        borderColor: colors.borderLight,
        ...shadows.md
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: spacing.md
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 4
    },
    emptyHint: {
        fontSize: 13,
        color: colors.textMuted
    },

    peopleGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md
    },

    personCard: {
        backgroundColor: colors.bgCard,
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
        borderRadius: borderRadius.xxl,
        minWidth: 100,
        flexShrink: 1,
        alignItems: 'center',
        borderWidth: 2.5,
        borderColor: colors.border,
        ...shadows.md
    },

    personCardActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '10',
        ...shadows.lg,
        transform: [{ scale: 1.02 }]
    },

    personName: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text,
        marginTop: spacing.sm,
        textAlign: 'center'
    },

    personNameActive: {
        color: colors.primary,
        fontWeight: '700'
    },

    payerBadge: {
        marginTop: 6,
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: borderRadius.full
    },

    payerBadgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: '700'
    },

    addRow: {
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'center'
    },

    addButton: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.xxl,
        paddingVertical: spacing.lg,
        borderRadius: borderRadius.xl,
        ...shadows.md
    },

    addButtonDisabled: {
        backgroundColor: colors.textLight,
        opacity: 0.5
    },

    addButtonText: {
        color: '#ffffff',
        fontWeight: '800',
        fontSize: 15
    },

    nextButton: {
        backgroundColor: colors.primary,
        paddingVertical: 20,
        borderRadius: borderRadius.xxl,
        alignItems: 'center',
        marginTop: spacing.xl,
        ...shadows.lg
    },

    nextButtonDisabled: {
        backgroundColor: colors.border,
        opacity: 0.7
    },

    nextButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700'
    },

    warningText: {
        fontSize: 13,
        color: colors.warning,
        textAlign: 'center',
        marginTop: spacing.md
    },

    methodScroll: {
        gap: spacing.sm,
        paddingVertical: spacing.xs,
    },
    methodPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.bgCard,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.full,
        borderWidth: 2,
        borderColor: colors.border,
        ...shadows.sm,
    },
    methodPillActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '10',
    },
    methodEmoji: {
        fontSize: 16,
    },
    methodLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text,
    },
    methodLabelActive: {
        color: colors.primary,
        fontWeight: '700',
    },
});
