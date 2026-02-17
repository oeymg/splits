import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Pressable,
    SafeAreaView,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    View
} from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { buildOweMessage, buildShareMessage } from '../lib/share';
import { computeSettlements, formatCurrency } from '../lib/settlements';
import { saveSplit } from '../lib/splitLinks';
import { PAYMENT_METHOD_CONFIG, Person, ReceiptDraft } from '../types';
import { AvatarCircle } from '../components/AvatarCircle';
import { QRCode } from '../components/QRCode';
import { colors, spacing, borderRadius, shadows, getAvatarColor } from '../theme';
import { StepIndicator } from '../components/StepIndicator';

type Props = {
    groupName: string;
    receipt: ReceiptDraft;
    people: Person[];
    payerId: string;
    onStartOver: () => void;
    onBack?: () => void;
};

export function SummaryScreen({ groupName, receipt, people, payerId, onStartOver, onBack }: Props) {
    const payer = people.find((p) => p.id === payerId);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [showQR, setShowQR] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const summaryRef = useRef<any>(null);

    const settlements = useMemo(
        // We now ignore receipt.total and just calculate from allocated items to ensure totals match step 3
        () => computeSettlements(receipt.lineItems, people, 0, payerId),
        [receipt.lineItems, people, payerId]
    );

    // Auto-save and generate shareable link on mount
    useEffect(() => {
        (async () => {
            const { shareUrl: url } = await saveSplit({ groupName, people, payerId, receipt });
            setShareUrl(url);
        })();
    }, []);

    // Toast auto-dismiss
    useEffect(() => {
        if (!toastMessage) return;
        const timer = setTimeout(() => setToastMessage(null), 2000);
        return () => clearTimeout(timer);
    }, [toastMessage]);

    const showToast = useCallback((msg: string) => setToastMessage(msg), []);

    const handleCopyLink = useCallback(async () => {
        if (!shareUrl) return;
        await Clipboard.setStringAsync(shareUrl);
        showToast('Link copied!');
    }, [shareUrl, showToast]);

    const handleExportImage = useCallback(async () => {
        if (!summaryRef.current) return;
        try {
            const uri = await captureRef(summaryRef, {
                format: 'png',
                quality: 1,
                result: 'tmpfile',
            });
            await Share.share({
                url: uri,
                message: shareUrl || undefined,
            });
        } catch {
            showToast('Could not export image');
        }
    }, [shareUrl, showToast]);

    // Celebration animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(30)).current;
    const confettiAnims = useRef(
        Array.from({ length: 8 }, () => ({
            x: new Animated.Value(Math.random() * 300 - 150),
            y: new Animated.Value(-100),
            rotate: new Animated.Value(0),
            opacity: new Animated.Value(1)
        }))
    ).current;

    useEffect(() => {
        // Entrance animation
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
            })
        ]).start();

        // Confetti celebration
        confettiAnims.forEach((anim, i) => {
            Animated.parallel([
                Animated.timing(anim.y, {
                    toValue: 600,
                    duration: 2000 + Math.random() * 500,
                    delay: i * 80,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true
                }),
                Animated.timing(anim.rotate, {
                    toValue: 360 * (Math.random() > 0.5 ? 1 : -1),
                    duration: 2000,
                    delay: i * 80,
                    easing: Easing.linear,
                    useNativeDriver: true
                }),
                Animated.timing(anim.opacity, {
                    toValue: 0,
                    duration: 2000,
                    delay: i * 80 + 1000,
                    useNativeDriver: true
                })
            ]).start();
        });
    }, []);

    // Calculate the 'Actual Total' (sum of all allocated items) to show instead of receipt total
    const allocatedTotal = useMemo(() =>
        settlements.reduce((sum, s) => sum + s.totalOwed, 0)
        , [settlements]);

    const shareText = useMemo(
        () =>
            buildShareMessage({
                groupName,
                merchant: receipt.merchant,
                date: receipt.date,
                time: receipt.time,
                total: allocatedTotal, // Use allocated total for consistency
                payer,
                paymentPrefs: payer?.paymentPrefs,
                settlements
            }),
        [groupName, receipt, payer, settlements, allocatedTotal]
    );

    const handleShare = async () => {
        await Share.share({ message: shareText });
    };

    const confettiColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

    return (
        <SafeAreaView style={styles.safe}>
            {/* Confetti Animation */}
            <View style={styles.confettiContainer} pointerEvents="none">
                {confettiAnims.map((anim, i) => (
                    <Animated.View
                        key={i}
                        style={[
                            styles.confetti,
                            {
                                backgroundColor: confettiColors[i % confettiColors.length],
                                transform: [
                                    { translateX: anim.x },
                                    { translateY: anim.y },
                                    {
                                        rotate: anim.rotate.interpolate({
                                            inputRange: [0, 360],
                                            outputRange: ['0deg', '360deg']
                                        })
                                    }
                                ],
                                opacity: anim.opacity
                            }
                        ]}
                    />
                ))}
            </View>

            <View style={styles.header}>
                {onBack && (
                    <Pressable onPress={onBack} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={colors.primary} />
                    </Pressable>
                )}
            </View>

            <ScrollView contentContainerStyle={styles.container}>
                <StepIndicator currentStep={4} />

                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }}
                >
                    <Text style={styles.title}>All done! ✨</Text>
                    <Text style={styles.subtitle}>Here's who owes what. Easy peasy!</Text>
                </Animated.View>

                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }}
                >
                    <View style={styles.receiptCard}>
                        <Text style={styles.receiptTitle}>
                            📍 {receipt.merchant || groupName || 'Receipt'}
                        </Text>
                        {receipt.date ? (
                            <Text style={styles.receiptDate}>
                                {receipt.date}{receipt.time ? ` at ${receipt.time}` : ''}
                            </Text>
                        ) : null}
                        <View style={styles.divider} />
                        <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>Total Allocated</Text>
                            <Text style={styles.totalValue}>{formatCurrency(allocatedTotal)}</Text>
                        </View>
                    </View>

                {settlements.length === 0 ? (
                    <View style={styles.emptyCard}>
                        <Text style={styles.emptyText}>Hmm, no one's claimed anything yet. Go back and assign some items!</Text>
                    </View>
                ) : (
                    <View style={styles.settlementsCard}>
                        <Text style={styles.sectionTitle}>💰 Breakdown by person</Text>
                        {settlements.map((entry) => (
                            <View
                                key={entry.person.id}
                                style={[
                                    styles.settlementRow,
                                    entry.isPayer && styles.payerRow
                                ]}
                            >
                                <View style={styles.settlementHeader}>
                                    <View style={styles.settlementLeft}>
                                        <AvatarCircle
                                            id={entry.person.id}
                                            name={entry.person.name}
                                            size={44}
                                        />
                                        <View>
                                            <Text style={styles.settlementName}>{entry.person.name}</Text>
                                            {entry.isPayer && (
                                                <Text style={styles.payerBadge}>💳 Paid the bill</Text>
                                            )}
                                        </View>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Text style={styles.settlementAmount}>
                                            {formatCurrency(entry.totalOwed)}
                                        </Text>
                                        <Text style={styles.owesLabel}>
                                            {entry.isPayer ? 'your share' : 'owes'}
                                        </Text>
                                    </View>
                                </View>

                                {/* Breakdown */}
                                <View style={styles.breakdownContainer}>
                                    {entry.items.map((item, idx) => (
                                        <View key={idx} style={styles.breakdownRow}>
                                            <Text style={styles.breakdownName}>
                                                {item.name} {item.splitCount > 1 ? `(1/${item.splitCount})` : ''}
                                            </Text>
                                            <Text style={styles.breakdownPrice}>{formatCurrency(item.price)}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                    <View style={styles.paymentCard}>
                        <Text style={styles.sectionTitle}>💳 Payment details</Text>
                        <Text style={styles.paymentText}>Pay to: {payer?.name ?? 'Payer'}</Text>
                        {payer?.paymentPrefs?.method ? (() => {
                            const config = PAYMENT_METHOD_CONFIG[payer.paymentPrefs.method];
                            const handle = payer.paymentPrefs.handle;
                            return (
                                <Text style={styles.paymentText}>
                                    {config.emoji} {config.label}{handle ? `: ${handle}` : ''}
                                </Text>
                            );
                        })() : (
                            <Text style={styles.paymentMuted}>No payment method set</Text>
                        )}
                    </View>

                    <ViewShot ref={summaryRef} options={{ format: 'png', quality: 1 }}>
                        <View style={styles.previewCard}>
                            <Text style={styles.previewLabel}>What everyone will see</Text>
                            <Text style={styles.previewText}>{shareText}</Text>
                        </View>
                    </ViewShot>

                    <Pressable style={styles.shareButton} onPress={handleShare}>
                        <Text style={styles.shareButtonText}>📤 Share with everyone</Text>
                    </Pressable>

                    {/* Virality action row */}
                    <View style={styles.viralRow}>
                        <Pressable style={styles.viralButton} onPress={handleCopyLink}>
                            <Text style={styles.viralButtonText}>🔗 Copy link</Text>
                        </Pressable>
                        <Pressable style={styles.viralButton} onPress={() => setShowQR(!showQR)}>
                            <Text style={styles.viralButtonText}>{showQR ? '✕ Hide QR' : '📱 QR code'}</Text>
                        </Pressable>
                        <Pressable style={styles.viralButton} onPress={handleExportImage}>
                            <Text style={styles.viralButtonText}>🖼 Save image</Text>
                        </Pressable>
                    </View>

                    {showQR && shareUrl && (
                        <View style={styles.qrCard}>
                            <QRCode value={shareUrl} size={200} />
                            <Text style={styles.qrHint}>Show this to friends nearby</Text>
                        </View>
                    )}

                    {shareUrl && (
                        <Pressable style={styles.linkCard} onPress={handleCopyLink}>
                            <Text style={styles.linkLabel}>Shareable link</Text>
                            <Text style={styles.linkUrl} numberOfLines={1}>{shareUrl}</Text>
                        </Pressable>
                    )}

                    <Pressable style={styles.startOverButton} onPress={onStartOver}>
                        <Text style={styles.startOverText}>↻ Split another bill</Text>
                    </Pressable>
                </Animated.View>

                {/* Toast */}
                {toastMessage && (
                    <View style={styles.toast}>
                        <Text style={styles.toastText}>{toastMessage}</Text>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bgPrimary },
    container: { padding: spacing.xl, paddingBottom: 60 },

    confettiContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        alignItems: 'center'
    },
    confetti: {
        position: 'absolute',
        width: 12,
        height: 12,
        borderRadius: 6
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
    receiptCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xl,
        marginBottom: spacing.lg,
        ...shadows.md
    },
    receiptTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text
    },
    receiptDate: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2
    },
    divider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: spacing.md
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between'
    },
    totalLabel: {
        fontSize: 16,
        color: colors.text,
        fontWeight: '600'
    },
    totalValue: {
        fontSize: 18,
        fontWeight: '800',
        color: colors.text
    },
    emptyCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xxl,
        alignItems: 'center',
        marginBottom: spacing.lg
    },
    emptyText: {
        fontSize: 14,
        color: colors.textMuted,
        textAlign: 'center'
    },
    settlementsCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xl,
        marginBottom: spacing.lg,
        gap: spacing.md,
        ...shadows.md
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: colors.text,
        marginBottom: spacing.sm
    },
    settlementRow: {
        flexDirection: 'column',
        marginBottom: spacing.md
    },
    settlementHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        marginBottom: spacing.sm
    },
    breakdownContainer: {
        backgroundColor: colors.bgSubtle,
        borderRadius: borderRadius.sm,
        padding: spacing.md,
        width: '100%',
        marginBottom: spacing.xs,
        borderWidth: 1,
        borderColor: colors.borderLight
    },
    breakdownRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4
    },
    breakdownName: {
        fontSize: 13,
        color: colors.textMuted
    },
    breakdownPrice: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text
    },
    settlementLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md
    },
    settlementName: {
        fontSize: 16,
        color: colors.text,
        fontWeight: '600'
    },
    settlementAmount: {
        fontSize: 18,
        fontWeight: '800',
        color: colors.text
    },
    owesLabel: {
        fontSize: 12,
        color: colors.textLight,
        fontWeight: '500',
        marginTop: 2
    },
    payerRow: {
        backgroundColor: colors.success + '10',
        borderRadius: borderRadius.md,
        padding: spacing.md,
        borderWidth: 2,
        borderColor: colors.success + '30'
    },
    payerBadge: {
        fontSize: 12,
        color: colors.success,
        fontWeight: '700',
        marginTop: 2
    },
    paymentCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xl,
        marginBottom: spacing.lg,
        gap: spacing.xs,
        ...shadows.sm
    },
    paymentText: {
        fontSize: 15,
        color: colors.text,
        marginTop: spacing.xs,
        fontWeight: '500'
    },
    paymentMuted: {
        fontSize: 14,
        color: colors.textLight,
        marginTop: spacing.xs
    },
    previewCard: {
        backgroundColor: colors.bgSubtle,
        borderRadius: borderRadius.lg,
        padding: spacing.lg,
        marginBottom: spacing.xxl,
        borderWidth: 1,
        borderColor: colors.borderLight
    },
    previewLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textLight,
        textTransform: 'uppercase',
        marginBottom: spacing.sm
    },
    previewText: {
        fontSize: 13,
        color: colors.text,
        lineHeight: 20
    },
    shareButton: {
        backgroundColor: colors.primary,
        paddingVertical: 20,
        borderRadius: borderRadius.xxl,
        alignItems: 'center',
        marginBottom: spacing.md,
        ...shadows.md
    },
    shareButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700'
    },
    viralRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    viralButton: {
        flex: 1,
        backgroundColor: colors.bgCard,
        paddingVertical: 12,
        borderRadius: borderRadius.md,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.borderLight,
        ...shadows.sm,
    },
    viralButtonText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.text,
        textAlign: 'center',
    },
    qrCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.lg,
        padding: spacing.xxl,
        marginBottom: spacing.lg,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.borderLight,
        ...shadows.sm,
    },
    qrHint: {
        fontSize: 12,
        color: colors.textMuted,
        marginTop: spacing.md,
    },
    linkCard: {
        backgroundColor: colors.bgSubtle,
        borderRadius: borderRadius.md,
        padding: spacing.lg,
        marginBottom: spacing.lg,
        borderWidth: 1,
        borderColor: colors.borderLight,
    },
    linkLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textLight,
        textTransform: 'uppercase',
        marginBottom: spacing.xs,
    },
    linkUrl: {
        fontSize: 13,
        color: colors.primary,
        fontWeight: '500',
    },
    toast: {
        position: 'absolute',
        bottom: 24,
        left: '50%' as any,
        transform: [{ translateX: -80 }],
        backgroundColor: colors.text,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: borderRadius.full,
        ...shadows.md,
    },
    toastText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    startOverButton: {
        paddingVertical: 16,
        borderRadius: borderRadius.xxl,
        alignItems: 'center',
        borderWidth: 2,
        borderColor: colors.border
    },
    startOverText: {
        color: colors.textMuted,
        fontSize: 15,
        fontWeight: '600'
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        marginBottom: spacing.xs
    },
    backButton: {
        padding: spacing.sm,
        marginLeft: -spacing.sm
    }
});
