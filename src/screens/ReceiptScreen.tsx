import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    Image,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { runOcr } from '../lib/ocr';
import { uploadReceiptImage } from '../lib/supabase';
import { formatCurrency } from '../lib/settlements';
import { ReceiptDraft } from '../types';
import { preprocessImageForOcr } from '../lib/imagePreprocessing';
import { colors, spacing, borderRadius, shadows } from '../theme';
import { StepIndicator } from '../components/StepIndicator';

type Props = {
    onReceiptProcessed: (draft: ReceiptDraft, imageUri: string) => void;
    onSkip: () => void;
    onBack: () => void;
};

type ScreenState = 'pick' | 'processing' | 'results' | 'error';

export function ReceiptScreen({ onReceiptProcessed, onSkip, onBack }: Props) {
    const [screenState, setScreenState] = useState<ScreenState>('pick');
    const [previewUri, setPreviewUri] = useState<string | null>(null);
    const [statusText, setStatusText] = useState('');
    const [ocrDraft, setOcrDraft] = useState<ReceiptDraft | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    // Animated values for item reveal
    const [revealedCount, setRevealedCount] = useState(0);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(20)).current;

    // Entrance animations for pick state
    const pickFade = useRef(new Animated.Value(0)).current;
    const pickSlide = useRef(new Animated.Value(30)).current;

    // Pulsing animation for processing state
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Entrance animation for pick state
    useEffect(() => {
        if (screenState === 'pick') {
            pickFade.setValue(0);
            pickSlide.setValue(30);
            Animated.parallel([
                Animated.timing(pickFade, {
                    toValue: 1,
                    duration: 600,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true
                }),
                Animated.spring(pickSlide, {
                    toValue: 0,
                    tension: 50,
                    friction: 8,
                    useNativeDriver: true
                })
            ]).start();
        }
    }, [screenState]);

    // Pulsing animation for processing state
    useEffect(() => {
        if (screenState === 'processing') {
            const pulse = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.1,
                        duration: 1000,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 1000,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true
                    })
                ])
            );
            pulse.start();
            return () => pulse.stop();
        }
    }, [screenState]);

    // Animate items appearing one by one when OCR completes
    useEffect(() => {
        if (screenState === 'results' && ocrDraft) {
            // Fade in the results card
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

            // Reveal items one at a time
            const totalItems = ocrDraft.lineItems.length;
            if (totalItems > 0) {
                let count = 0;
                const interval = setInterval(() => {
                    count++;
                    setRevealedCount(count);
                    if (count >= totalItems) clearInterval(interval);
                }, 150);
                return () => clearInterval(interval);
            }
        }
    }, [screenState, ocrDraft]);

    const processImage = async (uri: string) => {
        setPreviewUri(uri);
        setScreenState('processing');
        setRevealedCount(0);
        fadeAnim.setValue(0);
        slideAnim.setValue(20);

        try {
            // Step 1: Advanced image preprocessing — enhance quality for OCR
            setStatusText('Enhancing image quality…');
            const preprocessed = await preprocessImageForOcr(uri);

            // Step 2: Run OCR via Supabase Edge Function with enhanced image
            setStatusText('Extracting text with AI…');
            const ocrPromise = runOcr({ imageBase64: preprocessed.base64, mimeType: preprocessed.mimeType });

            // Step 3: Upload original in background
            uploadReceiptImage(uri).then((upload) => {
                if (upload.error) console.warn('Background upload failed', upload.error);
            });

            setStatusText('Parsing receipt items…');
            const draft = await ocrPromise;

            // Show results - don't auto-proceed
            setOcrDraft(draft);
            setStatusText('');
            setScreenState('results');
        } catch (error: any) {
            console.error('OCR failed:', error);
            setStatusText('');
            setErrorMessage(error.message || 'Failed to process receipt.');
            setScreenState('error');
        }
    };

    const handleCapture = async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            Alert.alert('Camera access needed', 'Enable camera permissions to snap receipts.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 1,           // Let preprocessImageForOcr handle compression
            allowsEditing: false, // Don't crop — receipts are tall/narrow
            exif: false,
        });
        if (result.canceled) return;
        await processImage(result.assets[0].uri);
    };

    const handlePick = async () => {
        if (Platform.OS !== 'web') {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Alert.alert('Photo access needed', 'Enable photo permissions to choose receipts.');
                return;
            }
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], // includes HEIC, JPEG, PNG, WEBP
            quality: 1,             // Let preprocessImageForOcr handle compression
            allowsEditing: false,   // Don't crop — receipts are tall/narrow
            exif: false,
        });
        if (result.canceled) return;
        await processImage(result.assets[0].uri);
    };

    const handleRetry = () => {
        setScreenState('pick');
        setPreviewUri(null);
        setOcrDraft(null);
        setErrorMessage('');
        setRevealedCount(0);
    };

    const handleContinue = () => {
        if (ocrDraft && previewUri) {
            onReceiptProcessed(ocrDraft, previewUri);
        }
    };

    // ─── Pick state: show photo buttons ───
    if (screenState === 'pick') {
        return (
            <SafeAreaView style={styles.safe}>
                <View style={styles.container}>
                    <Pressable style={styles.backPill} onPress={onBack}>
                        <Text style={styles.backText}>‹ Back</Text>
                    </Pressable>

                    <StepIndicator currentStep={2} />

                    <Animated.View
                        style={{
                            opacity: pickFade,
                            transform: [{ translateY: pickSlide }]
                        }}
                    >
                        <Text style={styles.title}>Let's snap that receipt! 📸</Text>
                        <Text style={styles.subtitle}>
                            Don't worry, we'll do all the boring reading for you ✨
                        </Text>
                    </Animated.View>

                    <Animated.View
                        style={[
                            styles.buttonGroup,
                            {
                                opacity: pickFade,
                                transform: [{ translateY: pickSlide }]
                            }
                        ]}
                    >
                        <Pressable style={styles.primaryButton} onPress={handleCapture}>
                            <Text style={styles.primaryButtonIcon}>📸</Text>
                            <Text style={styles.primaryButtonText}>Take a photo</Text>
                        </Pressable>

                        <Pressable style={styles.secondaryButton} onPress={handlePick}>
                            <Text style={styles.secondaryButtonIcon}>🖼️</Text>
                            <Text style={styles.secondaryButtonText}>Choose from photos</Text>
                        </Pressable>
                    </Animated.View>

                    <Animated.View
                        style={{
                            opacity: pickFade,
                            transform: [{ translateY: pickSlide }]
                        }}
                    >
                        <Pressable style={styles.skipLink} onPress={onSkip}>
                            <Text style={styles.skipText}>⏭️ I'll type it myself</Text>
                        </Pressable>
                    </Animated.View>
                </View>
            </SafeAreaView>
        );
    }

    // ─── Processing state: show image + spinner ───
    if (screenState === 'processing') {
        return (
            <SafeAreaView style={styles.safe}>
                <View style={styles.container}>
                    <Pressable style={styles.backPill} onPress={handleRetry}>
                        <Text style={styles.backText}>‹ Cancel</Text>
                    </Pressable>

                    <StepIndicator currentStep={2} />

                    <Text style={styles.title}>Working our magic… 🪄</Text>
                    <Text style={styles.subtitle}>Hang tight! Our AI is reading every line so you don't have to.</Text>

                    <Animated.View
                        style={[
                            styles.processingCard,
                            { transform: [{ scale: pulseAnim }] }
                        ]}
                    >
                        {previewUri ? (
                            <Image
                                source={{ uri: previewUri }}
                                style={styles.previewSmall}
                                blurRadius={1}
                            />
                        ) : null}
                        <View style={styles.spinnerRow}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={styles.processingText}>{statusText}</Text>
                        </View>
                        <View style={styles.progressDots}>
                            <View style={[styles.dot, styles.dotActive]} />
                            <View
                                style={[
                                    styles.dot,
                                    statusText.includes('AI') || statusText.includes('text')
                                        ? styles.dotActive
                                        : null
                                ]}
                            />
                            <View
                                style={[
                                    styles.dot,
                                    statusText.includes('Parsing') ? styles.dotActive : null
                                ]}
                            />
                        </View>
                    </Animated.View>

                    <View style={styles.tipsCard}>
                        <Text style={styles.tipsTitle}>💡 Pro tips for perfect scans</Text>
                        <Text style={styles.tipsText}>• Lay it flat (no crinkles!)</Text>
                        <Text style={styles.tipsText}>• Find some good lighting</Text>
                        <Text style={styles.tipsText}>• Get the whole thing in frame</Text>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    // ─── Error state ───
    if (screenState === 'error') {
        return (
            <SafeAreaView style={styles.safe}>
                <View style={styles.container}>
                    <Pressable style={styles.backPill} onPress={handleRetry}>
                        <Text style={styles.backText}>‹ Back</Text>
                    </Pressable>

                    <StepIndicator currentStep={2} />

                    <Text style={styles.title}>Hmm, that was tricky 😅</Text>
                    <Text style={styles.subtitle}>No stress! Let's try again, or you can type it in yourself.</Text>

                    <View style={styles.errorCard}>
                        <Text style={styles.errorIcon}>⚠️</Text>
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>

                    <View style={styles.errorActions}>
                        <Pressable style={styles.primaryButton} onPress={handleRetry}>
                            <Text style={styles.primaryButtonText}>📸 Let's try again</Text>
                        </Pressable>
                        <Pressable style={styles.skipLink} onPress={onSkip}>
                            <Text style={styles.skipText}>⏭️ I'll just type it in</Text>
                        </Pressable>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    // ─── Results state: show what OCR found ───
    const itemsFound = ocrDraft?.lineItems?.length ?? 0;
    const total = ocrDraft?.total ?? 0;
    const confidence = ocrDraft?.confidence ?? 0;
    const warnings = ocrDraft?.validationWarnings ?? [];

    // Determine confidence badge
    const getConfidenceBadge = () => {
        if (confidence >= 0.9) return { text: 'Excellent', color: '#16a34a', bg: '#dcfce7' };
        if (confidence >= 0.7) return { text: 'Good', color: '#ca8a04', bg: '#fef9c3' };
        if (confidence >= 0.5) return { text: 'Fair', color: '#ea580c', bg: '#fed7aa' };
        return { text: 'Low', color: '#dc2626', bg: '#fee2e2' };
    };

    const badge = getConfidenceBadge();

    return (
        <SafeAreaView style={styles.safe}>
            <ScrollView contentContainerStyle={styles.resultsContainer}>
                <Pressable style={styles.backPill} onPress={handleRetry}>
                    <Text style={styles.backText}>‹ Retake</Text>
                </Pressable>

                <StepIndicator currentStep={2} />

                <Text style={styles.title}>Look what we found! 🎯</Text>
                <Text style={styles.subtitle}>Take a quick look and let's keep rolling.</Text>

                <Animated.View
                    style={[
                        styles.resultsCard,
                        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
                    ]}
                >
                    {/* Photo thumbnail */}
                    {previewUri ? (
                        <Image source={{ uri: previewUri }} style={styles.resultThumb} />
                    ) : null}

                    {/* Confidence Badge */}
                    {confidence > 0 && (
                        <View style={[styles.confidenceBadge, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.confidenceText, { color: badge.color }]}>
                                {badge.text} confidence ({Math.round(confidence * 100)}%)
                            </Text>
                        </View>
                    )}

                    {/* Validation Warnings */}
                    {warnings.length > 0 && (
                        <View style={styles.warningBox}>
                            <Text style={styles.warningIcon}>⚠️</Text>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.warningTitle}>Please review:</Text>
                                {warnings.map((warning, index) => (
                                    <Text key={index} style={styles.warningText}>• {warning}</Text>
                                ))}
                            </View>
                        </View>
                    )}

                    {/* Merchant & Date */}
                    <View style={styles.resultHeader}>
                        <View>
                            <Text style={styles.resultLabel}>MERCHANT</Text>
                            <Text style={styles.resultMerchant}>
                                {ocrDraft?.merchant || 'Unknown'}
                            </Text>
                        </View>
                        {ocrDraft?.date ? (
                            <View>
                                <Text style={[styles.resultLabel, { textAlign: 'right' }]}>DATE</Text>
                                <Text style={styles.resultDate}>
                                    {ocrDraft.date}{ocrDraft.time ? ` at ${ocrDraft.time}` : ''}
                                </Text>
                            </View>
                        ) : null}
                    </View>

                    <View style={styles.divider} />

                    {/* Items found */}
                    <Text style={styles.itemsFoundLabel}>
                        {itemsFound} {itemsFound === 1 ? 'item' : 'items'} detected
                    </Text>

                    {ocrDraft?.lineItems.map((item, index) => (
                        <View
                            key={item.id}
                            style={[
                                styles.resultItem,
                                index >= revealedCount && { opacity: 0 }
                            ]}
                        >
                            <View style={styles.resultItemDot} />
                            <Text style={styles.resultItemName}>{item.name}</Text>
                            <Text style={styles.resultItemPrice}>
                                {formatCurrency(item.price)}
                            </Text>
                        </View>
                    ))}

                    {itemsFound === 0 ? (
                        <View style={styles.noItemsBox}>
                            <Text style={styles.noItemsText}>
                                Hmm, we couldn't spot any items. No worries — you can add them yourself in the next step!
                            </Text>
                        </View>
                    ) : null}

                    <View style={styles.divider} />

                    {/* Total */}
                    <View style={styles.resultTotalRow}>
                        <Text style={styles.resultTotalLabel}>Total</Text>
                        <Text style={styles.resultTotalValue}>{formatCurrency(total)}</Text>
                    </View>
                </Animated.View>

                {/* Continue button */}
                <Pressable
                    style={({ pressed }) => [styles.continueButton, pressed && { opacity: 0.85 }]}
                    onPress={handleContinue}
                >
                    <Text style={styles.continueButtonText}>
                        Perfect! Let's assign items →
                    </Text>
                </Pressable>

                <Pressable style={styles.retakeLink} onPress={handleRetry}>
                    <Text style={styles.retakeLinkText}>Not quite right? Try again</Text>
                </Pressable>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bgPrimary },
    container: { flex: 1, padding: spacing.xl },
    resultsContainer: { padding: spacing.xl, paddingBottom: 60 },

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

    /* ── Pick state ── */
    buttonGroup: {
        flex: 1,
        justifyContent: 'center',
        gap: spacing.lg
    },
    primaryButton: {
        backgroundColor: colors.primary,
        borderRadius: borderRadius.xxl,
        paddingVertical: 22,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.md,
        ...shadows.md
    },
    primaryButtonIcon: { fontSize: 24 },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 17,
        fontWeight: '700'
    },
    secondaryButton: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        paddingVertical: 22,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.md,
        borderWidth: 2,
        borderColor: colors.border,
        ...shadows.sm
    },
    secondaryButtonIcon: { fontSize: 24 },
    secondaryButtonText: {
        color: colors.primary,
        fontSize: 17,
        fontWeight: '700'
    },
    skipLink: {
        alignItems: 'center',
        paddingVertical: spacing.lg,
        marginTop: spacing.sm
    },
    skipText: {
        color: colors.textMuted,
        fontSize: 14,
        fontWeight: '600'
    },

    /* ── Processing state ── */
    processingCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xxl,
        alignItems: 'center',
        gap: spacing.lg,
        marginTop: spacing.sm,
        ...shadows.lg
    },
    previewSmall: {
        width: '100%',
        height: 200,
        borderRadius: borderRadius.lg,
        opacity: 0.8
    },
    spinnerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md
    },
    processingText: {
        fontSize: 15,
        color: colors.primary,
        fontWeight: '700'
    },
    progressDots: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginTop: spacing.xs
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.border
    },
    dotActive: {
        backgroundColor: colors.primary
    },

    tipsCard: {
        backgroundColor: colors.primary + '10',
        borderRadius: borderRadius.xxl,
        padding: spacing.lg,
        marginTop: spacing.xxl,
    },
    tipsTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.primary,
        marginBottom: spacing.sm
    },
    tipsText: {
        fontSize: 13,
        color: colors.text,
        marginVertical: 3,
        fontWeight: '500'
    },

    /* ── Error state ── */
    errorCard: {
        backgroundColor: colors.error + '10',
        borderRadius: borderRadius.xxl,
        padding: spacing.xxl,
        alignItems: 'center',
        gap: spacing.md,
        marginTop: spacing.sm,
    },
    errorIcon: { fontSize: 48 },
    errorText: {
        fontSize: 15,
        color: colors.error,
        textAlign: 'center',
        lineHeight: 22,
        fontWeight: '600'
    },
    errorActions: {
        marginTop: spacing.xxl,
        gap: spacing.md
    },

    /* ── Results state ── */
    resultsCard: {
        backgroundColor: colors.bgCard,
        borderRadius: borderRadius.xxl,
        padding: spacing.xl,
        ...shadows.lg,
        marginBottom: spacing.xl
    },
    resultThumb: {
        width: '100%',
        height: 140,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border
    },
    confidenceBadge: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.sm,
        alignSelf: 'flex-start',
        marginBottom: spacing.md
    },
    confidenceText: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5
    },
    warningBox: {
        backgroundColor: colors.warning + '15',
        borderRadius: borderRadius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
        flexDirection: 'row',
        gap: spacing.sm,
        borderWidth: 2,
        borderColor: colors.warning + '40'
    },
    warningIcon: {
        fontSize: 20
    },
    warningTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.warning,
        marginBottom: spacing.xs
    },
    warningText: {
        fontSize: 12,
        color: colors.warning,
        lineHeight: 18,
        fontWeight: '600'
    },
    resultHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.xs,
        gap: spacing.md,
    },
    resultLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.textLight,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 2
    },
    resultMerchant: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
        flexShrink: 1,
    },
    resultDate: {
        fontSize: 14,
        color: colors.textMuted,
        fontWeight: '600'
    },
    divider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: spacing.lg
    },
    itemsFoundLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.primary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.md
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        gap: spacing.md
    },
    resultItemDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.primary
    },
    resultItemName: {
        flex: 1,
        fontSize: 15,
        color: colors.text,
        fontWeight: '600'
    },
    resultItemPrice: {
        fontSize: 15,
        fontWeight: '700',
        color: colors.text
    },
    noItemsBox: {
        backgroundColor: colors.warning + '15',
        borderRadius: borderRadius.md,
        padding: spacing.lg,
        marginVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.warning + '30'
    },
    noItemsText: {
        fontSize: 13,
        color: colors.warning,
        lineHeight: 20,
        textAlign: 'center',
        fontWeight: '600'
    },
    resultTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    resultTotalLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.text
    },
    resultTotalValue: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.text
    },

    continueButton: {
        backgroundColor: colors.primary,
        paddingVertical: 20,
        borderRadius: borderRadius.xxl,
        alignItems: 'center',
        ...shadows.md
    },
    continueButtonText: {
        color: '#ffffff',
        fontSize: 17,
        fontWeight: '700'
    },
    retakeLink: {
        alignItems: 'center',
        paddingVertical: spacing.lg
    },
    retakeLinkText: {
        color: colors.textMuted,
        fontSize: 14,
        fontWeight: '600'
    }
});
