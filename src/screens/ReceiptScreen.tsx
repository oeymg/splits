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
import { ReceiptDraft, LineItem } from '../types';
import { preprocessImageForOcr } from '../lib/imagePreprocessing';
import { colors, spacing, borderRadius, shadows } from '../theme';
import { StepIndicator } from '../components/StepIndicator';

// Names that look like items but are receipt metadata
const NON_ITEM_NAMES = new Set([
    'eft', 'eftpos', 'eft payment', 'eftpos payment',
    'aud', 'gst', 'hst', 'pst', 'vat', 'tax', 'taxes',
    'subtotal', 'sub total', 'sub-total',
    'total', 'grand total', 'order total', 'total due', 'amount due',
    'balance', 'balance due', 'balance payable', 'balance owing',
    'change', 'change due', 'change given', 'your change',
    'cash', 'cash tendered', 'cash payment', 'cash received',
    'rounding', 'rounding adj', 'rounding adjustment',
    'visa', 'mastercard', 'amex', 'american express',
    'thank you', 'thanks', 'receipt', 'tax invoice',
    'loyalty', 'points', 'rewards',
]);
const NON_ITEM_REGEX = [
    /^eft(pos)?(\s+payment)?$/i,
    /^(incl\.?\s+)?gst(\s+incl\.?)?$/i,
    /^sub[\s-]?total$/i,
    /^(grand\s+|order\s+)?(total|amount)(\s+(due|payable))?$/i,
    /^balance(\s+(due|payable|owing))?$/i,
    /^(your\s+)?change(\s+due)?$/i,
    /^cash(\s+(tendered|payment|received))?$/i,
    /^rounding(\s+adj(ustment)?)?$/i,
    /^(credit\s+)?card(\s+fee)?$/i,
    /^service\s+(charge|fee|surcharge)$/i,
    /^\d{4,}$/,           // pure barcodes / product codes
    /^[*\-=_\s.]{2,}$/,  // divider lines
    /^(thank\s+you|thanks)[\s!.]*$/i,
    /^tax\s*invoice$/i,
];
function filterNonItems(items: LineItem[]): LineItem[] {
    return items.filter(item => {
        const name = item.name.trim();
        if (name.length <= 1) return false;
        const lower = name.toLowerCase();
        if (NON_ITEM_NAMES.has(lower)) return false;
        if (NON_ITEM_REGEX.some(p => p.test(name))) return false;
        return true;
    });
}

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

    // Animated values for results card
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(40)).current;
    const cardScaleAnim = useRef(new Animated.Value(0.93)).current;

    // Per-item animations for results list
    const resultItemAnimsRef = useRef<Map<string, { opacity: Animated.Value; translateX: Animated.Value }>>(new Map());
    const getResultItemAnim = (id: string) => {
        if (!resultItemAnimsRef.current.has(id)) {
            resultItemAnimsRef.current.set(id, {
                opacity: new Animated.Value(0),
                translateX: new Animated.Value(16)
            });
        }
        return resultItemAnimsRef.current.get(id)!;
    };

    // Entrance animations for pick state
    const pickFade = useRef(new Animated.Value(0)).current;
    const pickSlide = useRef(new Animated.Value(60)).current;

    // Processing state: card entrance + scan line
    const processCardFade = useRef(new Animated.Value(0)).current;
    const processCardSlide = useRef(new Animated.Value(40)).current;
    const scanLineAnim = useRef(new Animated.Value(0)).current;

    // Exit animation when continuing to items
    const exitOpacity = useRef(new Animated.Value(1)).current;
    const exitTranslateY = useRef(new Animated.Value(0)).current;
    const continuePressAnim = useRef(new Animated.Value(1)).current;

    // Entrance animation for pick state
    useEffect(() => {
        if (screenState === 'pick') {
            pickFade.setValue(0);
            pickSlide.setValue(60);
            Animated.parallel([
                Animated.timing(pickFade, {
                    toValue: 1,
                    duration: 350,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true
                }),
                Animated.spring(pickSlide, {
                    toValue: 0,
                    tension: 70,
                    friction: 10,
                    useNativeDriver: true
                })
            ]).start();
        }
    }, [screenState]);

    // Processing state: card slides in + scan line sweeps the image
    useEffect(() => {
        if (screenState === 'processing') {
            processCardFade.setValue(0);
            processCardSlide.setValue(40);
            Animated.parallel([
                Animated.timing(processCardFade, {
                    toValue: 1,
                    duration: 350,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true
                }),
                Animated.spring(processCardSlide, {
                    toValue: 0,
                    tension: 70,
                    friction: 10,
                    useNativeDriver: true
                })
            ]).start();

            scanLineAnim.setValue(0);
            const scan = Animated.loop(
                Animated.sequence([
                    Animated.timing(scanLineAnim, {
                        toValue: 1,
                        duration: 1800,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true
                    }),
                    Animated.timing(scanLineAnim, {
                        toValue: 0,
                        duration: 300,
                        easing: Easing.in(Easing.quad),
                        useNativeDriver: true
                    })
                ])
            );
            scan.start();
            return () => scan.stop();
        }
    }, [screenState]);

    // Results: card spring-pops in, items stagger in from the right
    useEffect(() => {
        if (screenState === 'results' && ocrDraft) {
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
                }),
                Animated.spring(cardScaleAnim, {
                    toValue: 1,
                    tension: 70,
                    friction: 10,
                    useNativeDriver: true
                })
            ]).start();

            if (ocrDraft.lineItems.length > 0) {
                Animated.stagger(
                    45,
                    ocrDraft.lineItems.map((item) => {
                        const anim = getResultItemAnim(item.id);
                        return Animated.parallel([
                            Animated.timing(anim.opacity, {
                                toValue: 1,
                                duration: 250,
                                easing: Easing.out(Easing.quad),
                                useNativeDriver: true
                            }),
                            Animated.spring(anim.translateX, {
                                toValue: 0,
                                tension: 90,
                                friction: 11,
                                useNativeDriver: true
                            })
                        ]);
                    })
                ).start();
            }
        }
    }, [screenState, ocrDraft]);

    const processImage = async (uri: string) => {
        setPreviewUri(uri);
        setScreenState('processing');
        fadeAnim.setValue(0);
        slideAnim.setValue(40);
        cardScaleAnim.setValue(0.93);
        resultItemAnimsRef.current.clear();

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

            // Strip out non-items (EFT, AUD, totals, dividers, etc.)
            const filteredDraft = { ...draft, lineItems: filterNonItems(draft.lineItems) };

            // Show results - don't auto-proceed
            setOcrDraft(filteredDraft);
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
        resultItemAnimsRef.current.clear();
    };

    const handleContinue = () => {
        if (ocrDraft && previewUri) {
            Animated.parallel([
                Animated.timing(exitOpacity, {
                    toValue: 0,
                    duration: 260,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true
                }),
                Animated.timing(exitTranslateY, {
                    toValue: -70,
                    duration: 260,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true
                })
            ]).start(() => {
                onReceiptProcessed(ocrDraft, previewUri);
            });
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
                            { opacity: processCardFade, transform: [{ translateY: processCardSlide }] }
                        ]}
                    >
                        {previewUri ? (
                            <View style={styles.previewWrapper}>
                                <Image
                                    source={{ uri: previewUri }}
                                    style={styles.previewSmall}
                                    blurRadius={2}
                                />
                                <Animated.View
                                    style={[
                                        styles.scanLine,
                                        {
                                            transform: [{
                                                translateY: scanLineAnim.interpolate({
                                                    inputRange: [0, 1],
                                                    outputRange: [0, 196]
                                                })
                                            }]
                                        }
                                    ]}
                                />
                            </View>
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
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
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
            <Animated.View style={[{ flex: 1 }, { opacity: exitOpacity, transform: [{ translateY: exitTranslateY }] }]}>
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
                        { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale: cardScaleAnim }] }
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

                    {ocrDraft?.lineItems.map((item) => {
                        const anim = getResultItemAnim(item.id);
                        return (
                            <Animated.View
                                key={item.id}
                                style={[
                                    styles.resultItem,
                                    { opacity: anim.opacity, transform: [{ translateX: anim.translateX }] }
                                ]}
                            >
                                <View style={styles.resultItemDot} />
                                <Text style={styles.resultItemName}>{item.name}</Text>
                                <Text style={styles.resultItemPrice}>
                                    {formatCurrency(item.price)}
                                </Text>
                            </Animated.View>
                        );
                    })}

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
                        <Text style={styles.resultTotalLabel}>Parsed total</Text>
                        <Text style={styles.resultTotalValue}>{formatCurrency(total)}</Text>
                    </View>

                    {/* Discrepancy notice */}
                    {(() => {
                        const printed = ocrDraft?.receiptTotal;
                        if (!printed || !total || Math.abs(printed - total) < 0.01) return null;
                        const diff = round2(total - printed);
                        const over = diff > 0;
                        return (
                            <View style={[styles.discrepancyBox, { borderColor: over ? colors.warning + '60' : colors.error + '50', backgroundColor: over ? colors.warning + '12' : colors.error + '08' }]}>
                                <Text style={[styles.discrepancyIcon]}>{over ? '⬆️' : '⬇️'}</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.discrepancyTitle, { color: over ? colors.warning : colors.error }]}>
                                        Receipt total was {formatCurrency(printed)}
                                    </Text>
                                    <Text style={styles.discrepancyBody}>
                                        {over
                                            ? `We parsed ${formatCurrency(Math.abs(diff))} more than the printed total — check for duplicates.`
                                            : `We parsed ${formatCurrency(Math.abs(diff))} less than the printed total — some items may be missing.`}
                                    </Text>
                                </View>
                            </View>
                        );
                    })()}
                </Animated.View>

                {/* Continue button */}
                <Animated.View style={{ transform: [{ scale: continuePressAnim }] }}>
                    <Pressable
                        style={styles.continueButton}
                        onPressIn={() => Animated.spring(continuePressAnim, {
                            toValue: 0.95, tension: 300, friction: 10, useNativeDriver: true
                        }).start()}
                        onPressOut={() => Animated.spring(continuePressAnim, {
                            toValue: 1, tension: 300, friction: 10, useNativeDriver: true
                        }).start()}
                        onPress={handleContinue}
                    >
                        <Text style={styles.continueButtonText}>
                            Perfect! Let's assign items →
                        </Text>
                    </Pressable>
                </Animated.View>

                <Pressable style={styles.retakeLink} onPress={handleRetry}>
                    <Text style={styles.retakeLinkText}>Not quite right? Try again</Text>
                </Pressable>
            </ScrollView>
            </Animated.View>
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
    previewWrapper: {
        width: '100%',
        overflow: 'hidden',
        borderRadius: borderRadius.lg,
    },
    previewSmall: {
        width: '100%',
        height: 200,
        borderRadius: borderRadius.lg,
        opacity: 0.75
    },
    scanLine: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        backgroundColor: colors.primary + 'CC',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 6,
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
    },
    discrepancyBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        marginTop: spacing.md,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1.5,
    },
    discrepancyIcon: {
        fontSize: 16,
        marginTop: 1,
    },
    discrepancyTitle: {
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 2,
    },
    discrepancyBody: {
        fontSize: 12,
        color: colors.textMuted,
        fontWeight: '500',
        lineHeight: 17,
    },
});
