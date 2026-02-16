import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
    Animated,
    Linking,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
    Easing,
    Dimensions,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { colors, spacing, borderRadius, shadows } from '../theme';

type Props = {
    onStart: () => void;
    onTryDemo: () => void;
    onPricing: () => void;
};

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 1;
const CONTENT_MARGIN = spacing.xxxl;
const IS_SMALL_SCREEN = SCREEN_WIDTH <= 430;
const SECTION_HORIZONTAL_PADDING = IS_SMALL_SCREEN ? spacing.lg : spacing.xxl;

// SPLITS text sizing — use a generous container so justifyContent:'center' handles alignment
const SPLITS_FONT_SIZE = IS_SMALL_SCREEN ? 102 : 140;
const SPLITS_BOX = SPLITS_FONT_SIZE * 2; // tall box, text centered inside via flexbox

const NAV_ITEMS = ['Pricing', 'Try a Demo', 'Contact Us'] as const;

const STEPS = [
    { emoji: '\u{1F4F8}', label: 'Snap', desc: 'Photo your receipt' },
    { emoji: '\u{1F465}', label: 'Claim', desc: 'Tap what you ate' },
    { emoji: '\u26A1', label: 'Done', desc: 'Everyone pays up (hopefully)' },
];

const STATS = [
    { value: '2s', label: 'average scan time', icon: '⚡' },
    { value: '100%', label: 'free', icon: '💎' },
    { value: '0', label: 'awkward convos', icon: '🤝' },
];

const QUOTES = [
    { text: '\u201CBro I am not shouting you food anymore.\u201D', attrib: '\u2014 literally everyone' },
    { text: '\u201CWho had the extra guac?\u201D', attrib: '\u2014 every group chat ever' },
    { text: '\u201CI\u2019ll Venmo you later\u201D and other lies.', attrib: '\u2014 your cheapest friend' },
];

const WHY_FEATURES = [
    {
        icon: '\u{1F9E0}',
        title: 'Line-by-line OCR',
        desc: 'Reads messy receipts, nails every subtotal, tax, and tip automatically.',
        accent: colors.brandCoral,
    },
    {
        icon: '\u{1F355}',
        title: 'Shared items',
        desc: 'Split the pizza, keep the wagyu. Fractional splits in one tap.',
        accent: '#3b82f6',
    },
    {
        icon: '\u26A1',
        title: 'Pay your way',
        desc: 'Venmo, PayPal, Zelle, Cash App, PayID, and more. Settle up however you like.',
        accent: '#10b981',
    },
    {
        icon: '\u{1F4B8}',
        title: 'Free',
        desc: 'No subscriptions. No ads. No paywalls. Just a quieter group chat.',
        accent: colors.accent,
    },
] as const;

// ── Pressable card with spring scale ──
function BounceCard({ children, style }: { children: React.ReactNode; style?: any }) {
    const scale = useRef(new Animated.Value(1)).current;

    const onPressIn = () => {
        Animated.spring(scale, {
            toValue: 0.95,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const onPressOut = () => {
        Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 18,
            bounciness: 10,
        }).start();
    };

    return (
        <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
            <Animated.View style={[style, { transform: [{ scale }] }]}>
                {children}
            </Animated.View>
        </Pressable>
    );
}


// ── Animated count-up text (looping) ──
function CountUpText({
    from = 0,
    to,
    suffix = '',
    style,
}: {
    from?: number;
    to: number;
    suffix?: string;
    style?: any;
}) {
    const [display, setDisplay] = useState(from.toString());

    useEffect(() => {
        const range = Math.abs(to - from);
        const duration = range <= 10 ? 2500 : 3500;
        const holdDuration = 2000;
        let cancelled = false;

        const runCycle = () => {
            if (cancelled) return;
            const startTime = Date.now();

            const frame = () => {
                if (cancelled) return;
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                const current = from + (to - from) * eased;

                if (progress >= 1) {
                    setDisplay(to.toString());
                    setTimeout(() => {
                        if (cancelled) return;
                        setDisplay(from.toString());
                        setTimeout(runCycle, 400);
                    }, holdDuration);
                } else if (range <= 10) {
                    setDisplay(current.toFixed(1));
                    requestAnimationFrame(frame);
                } else {
                    setDisplay(Math.round(current).toString());
                    requestAnimationFrame(frame);
                }
            };

            requestAnimationFrame(frame);
        };

        const timer = setTimeout(runCycle, 800);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [from, to]);

    return (
        <Text style={style}>
            {display}
            {suffix}
        </Text>
    );
}

// ── Pulsing CTA button ──
function PulsingCTA({ onPress, label }: { onPress: () => void; label: string }) {
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.04,
                    duration: 1800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    return (
        <Pressable onPress={onPress}>
            <Animated.View
                style={[
                    styles.ctaPrimary,
                    {
                        transform: [{ scale: pulseAnim }],
                        shadowRadius: 30,
                        shadowOpacity: 0.5,
                    },
                ]}
            >
                <Text style={styles.ctaPrimaryText}>{label}</Text>
            </Animated.View>
        </Pressable>
    );
}

// ── Rotating quotes ──
function RotatingQuotes() {
    const [activeIndex, setActiveIndex] = useState(0);
    const fadeAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const interval = setInterval(() => {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start(() => {
                setActiveIndex((prev) => (prev + 1) % QUOTES.length);
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 400,
                    useNativeDriver: true,
                }).start();
            });
        }, 4000);

        return () => clearInterval(interval);
    }, []);

    const quote = QUOTES[activeIndex];

    return (
        <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={styles.quoteText}>{quote.text}</Text>
            <View style={styles.quoteDivider} />
            <Text style={styles.quoteAttrib}>{quote.attrib}</Text>
            <View style={styles.quoteDots}>
                {QUOTES.map((_, i) => (
                    <View
                        key={i}
                        style={[
                            styles.quoteDot,
                            i === activeIndex && styles.quoteDotActive,
                        ]}
                    />
                ))}
            </View>
        </Animated.View>
    );
}

export function WelcomeScreen({ onStart, onTryDemo, onPricing }: Props) {
    const scrollY = useRef(new Animated.Value(0)).current;
    const fadeIn = useRef(new Animated.Value(0)).current;
    const bounceAnim = useRef(new Animated.Value(0)).current;
    const scrollRef = useRef<any>(null);

    // Track raw scroll position for snap
    const rawScrollY = useRef(0);

    useEffect(() => {
        Animated.timing(fadeIn, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
        }).start();

        Animated.loop(
            Animated.sequence([
                Animated.timing(bounceAnim, {
                    toValue: 1,
                    duration: 2000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(bounceAnim, {
                    toValue: 0,
                    duration: 2000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    // ── Scroll-driven interpolations ──
    const splitTopTranslate = scrollY.interpolate({
        inputRange: [0, HERO_HEIGHT],
        outputRange: [0, -SCREEN_HEIGHT],
        extrapolate: 'clamp',
    });
    const splitBottomTranslate = scrollY.interpolate({
        inputRange: [0, HERO_HEIGHT],
        outputRange: [0, SCREEN_HEIGHT],
        extrapolate: 'clamp',
    });
    const splitsOpacity = scrollY.interpolate({
        inputRange: [0, HERO_HEIGHT * 0.3],
        outputRange: [1, 0],
        extrapolate: 'clamp',
    });
    const scrollIndicatorOpacity = scrollY.interpolate({
        inputRange: [0, 100],
        outputRange: [1, 0],
        extrapolate: 'clamp',
    });
    const bounceTranslate = bounceAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 10],
    });
    // Floating pill
    const pillTranslateY = scrollY.interpolate({
        inputRange: [HERO_HEIGHT * 0.7, HERO_HEIGHT],
        outputRange: [30, 0],
        extrapolate: 'clamp',
    });
    const pillOpacity = scrollY.interpolate({
        inputRange: [HERO_HEIGHT * 0.7, HERO_HEIGHT],
        outputRange: [0, 1],
        extrapolate: 'clamp',
    });

    // Landing content
    const contentOpacity = scrollY.interpolate({
        inputRange: [HERO_HEIGHT * 0.5, HERO_HEIGHT],
        outputRange: [0, 1],
        extrapolate: 'clamp',
    });
    const contentTranslateY = scrollY.interpolate({
        inputRange: [HERO_HEIGHT * 0.5, HERO_HEIGHT],
        outputRange: [40, 0],
        extrapolate: 'clamp',
    });

    // Parallax for quote card
    const quoteTranslateY = scrollY.interpolate({
        inputRange: [HERO_HEIGHT, HERO_HEIGHT + 600, HERO_HEIGHT + 1200],
        outputRange: [20, 0, -20],
        extrapolate: 'clamp',
    });

    // Snap to hero boundary on scroll end
    const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y;
        if (y > 0 && y < HERO_HEIGHT) {
            const target = y > HERO_HEIGHT * 0.35 ? HERO_HEIGHT : 0;
            scrollRef.current?.scrollTo({ y: target, animated: true });
        }
    }, []);

    const handleNavPress = (item: string) => {
        if (item === 'Try a Demo') {
            onTryDemo();
        }
        if (item === 'Pricing') {
            onPricing();
        }
        if (item === 'Contact Us') {
            Linking.openURL('https://usesplits.app/contact');
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
            {/* ═══════════ Split Screen Hero ═══════════ */}
            <Animated.View style={[styles.splitHero, { opacity: fadeIn }]} pointerEvents="none">
                <Animated.View style={[styles.splitTop, { transform: [{ translateY: splitTopTranslate }] }]}>
                    <Animated.View style={[styles.splitsTextBox, { opacity: splitsOpacity }]}>
                        <Text style={styles.splitsText}>SPLITS</Text>
                    </Animated.View>
                </Animated.View>

                <Animated.View
                    style={[styles.splitBottom, { transform: [{ translateY: splitBottomTranslate }] }]}
                >
                    <Animated.View style={[styles.splitsTextBoxBottom, { opacity: splitsOpacity }]}>
                        <Text style={styles.splitsText}>SPLITS</Text>
                    </Animated.View>
                </Animated.View>

                <Animated.View
                    style={[
                        styles.scrollIndicator,
                        {
                            opacity: scrollIndicatorOpacity,
                            transform: [{ translateY: bounceTranslate }],
                        },
                    ]}
                >
                    <View style={styles.scrollLine} />
                    <Text style={styles.scrollLabel}>SCROLL</Text>
                </Animated.View>
            </Animated.View>

            {/* ═══════════ Scrollable Content ═══════════ */}
            <Animated.ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                    {
                        useNativeDriver: true,
                        listener: (e: any) => {
                            rawScrollY.current = e.nativeEvent.contentOffset.y;
                        },
                    }
                )}
                onMomentumScrollEnd={onScrollEnd}
                onScrollEndDrag={onScrollEnd}
                scrollEventThrottle={16}
                decelerationRate="fast"
            >
                <View style={{ height: HERO_HEIGHT }} />

                <Animated.View
                    style={[
                        styles.contentWrap,
                        {
                            opacity: contentOpacity,
                            transform: [{ translateY: contentTranslateY }],
                        },
                    ]}
                >
                    {/* ── 1. Hero ── */}
                    <View style={styles.heroSection}>
                        <Text style={styles.headline}>
                            Split bills,{'\n'}skip the{' '}
                            <Text style={styles.headlineAccent}>awkwies.</Text>
                        </Text>
                        <Text style={styles.subtitle}>
                            Snap a receipt. We handle the rest.
                        </Text>
                        <View style={styles.ctaRow}>
                            <PulsingCTA onPress={onStart} label="Get Started" />
                            <Pressable
                                style={({ pressed }) => [
                                    styles.ctaGhost,
                                    pressed && { opacity: 0.5 },
                                ]}
                                onPress={onTryDemo}
                            >
                                <Text style={styles.ctaGhostText}>Try Demo</Text>
                            </Pressable>
                        </View>
                    </View>

                    {/* ── 2. How It Works ── */}
                    <View style={[styles.stepsSection, styles.sectionSpacing]}>
                        <Text style={styles.sectionTag}>HOW IT WORKS</Text>
                        <View style={styles.stepsRow}>
                            {STEPS.map((step, i) => (
                                <React.Fragment key={step.label}>
                                    <BounceCard style={styles.stepItem}>
                                        <Text style={styles.stepEmoji}>{step.emoji}</Text>
                                        <Text style={styles.stepLabel}>{step.label}</Text>
                                        <Text style={styles.stepDesc}>{step.desc}</Text>
                                    </BounceCard>
                                    {!IS_SMALL_SCREEN && i < STEPS.length - 1 && (
                                        <Text style={styles.stepArrow}>{'\u2192'}</Text>
                                    )}
                                </React.Fragment>
                            ))}
                        </View>
                    </View>

                    {/* ── 3. Quote Card ── */}
                    <View style={[styles.quoteSection, styles.sectionSpacing]}>
                        <BounceCard style={styles.quoteCard}>
                            <Animated.View style={{ transform: [{ translateY: quoteTranslateY }] }}>
                                <RotatingQuotes />
                            </Animated.View>
                        </BounceCard>
                    </View>

                    {/* ── 4. Stats ── */}
                    <View style={[styles.statsSection, styles.sectionSpacing]}>
                        <View style={styles.statsRow}>
                            {STATS.map((stat, i) => {
                                const match = stat.value.match(/^(\d+)(.*)$/);
                                const numVal = match ? parseInt(match[1]) : 0;
                                const suffix = match ? match[2] : '';
                                return (
                                    <React.Fragment key={stat.label}>
                                        <BounceCard style={styles.statItem}>
                                            <Text style={styles.statIcon}>{stat.icon}</Text>
                                            <CountUpText
                                                from={numVal === 0 ? 20 : 0}
                                                to={numVal}
                                                suffix={suffix}
                                                style={styles.statValue}
                                            />
                                            <Text style={styles.statLabel}>{stat.label}</Text>
                                        </BounceCard>
                                        {i < STATS.length - 1 && <View style={styles.statDivider} />}
                                    </React.Fragment>
                                );
                            })}
                        </View>
                    </View>

                    {/* ── 5. Why Splits ── */}
                    <View style={[styles.whySection, styles.sectionSpacing]}>
                        <Text style={styles.whySectionTag}>WHY SPLITS</Text>
                        <Text style={styles.whyHeadline}>
                            Less math.{`\n`}Less nagging.{`\n`}More meals.
                        </Text>

                        <View style={styles.whyList}>
                            {WHY_FEATURES.map((feature, i) => (
                                <BounceCard key={feature.title} style={styles.whyRow}>
                                    <View
                                        style={[
                                            styles.whyAccentBar,
                                            { backgroundColor: feature.accent },
                                        ]}
                                    />
                                    <View style={styles.whyRowInner}>
                                        <View
                                            style={[
                                                styles.whyIconCircle,
                                                { backgroundColor: feature.accent + '15' },
                                            ]}
                                        >
                                            <Text style={styles.whyIconEmoji}>{feature.icon}</Text>
                                        </View>
                                        <View style={styles.whyTextBlock}>
                                            <Text style={styles.whyFeatureTitle}>{feature.title}</Text>
                                            <Text style={styles.whyFeatureDesc}>{feature.desc}</Text>
                                        </View>
                                    </View>
                                    {i < WHY_FEATURES.length - 1 && <View style={styles.whyRowDivider} />}
                                </BounceCard>
                            ))}
                        </View>
                    </View>

                    {/* ── 6. Final CTA ── */}
                    <View style={[styles.finalSection, styles.sectionSpacing]}>
                        <Text style={styles.finalHeadline}>Ready?</Text>
                        <Text style={styles.finalSubtext}>
                            It takes less time than arguing over the bill.
                        </Text>
                        <View style={styles.ctaRow}>
                            <PulsingCTA onPress={onStart} label="Let's Split" />
                            <Pressable
                                style={({ pressed }) => [
                                    styles.ctaGhost,
                                    pressed && { opacity: 0.5 },
                                ]}
                                onPress={onTryDemo}
                            >
                                <Text style={styles.ctaGhostText}>Try Demo</Text>
                            </Pressable>
                        </View>

                        <View style={styles.footer}>
                            <View style={styles.footerLine} />
                            <Text style={styles.footerText}>usesplits.app</Text>
                        </View>
                    </View>
                </Animated.View>
            </Animated.ScrollView>

            {/* ═══════════ Floating Nav Pill ═══════════ */}
                <Animated.View
                    style={[
                        styles.floatingPill,
                        {
                            opacity: pillOpacity,
                            transform: [{ translateY: pillTranslateY }],
                        },
                    ]}
                    pointerEvents="auto"
                >
                    {NAV_ITEMS.map((item, i) => (
                        <Pressable
                            key={item}
                            style={({ pressed }) => [
                                styles.pillItem,
                                i < NAV_ITEMS.length - 1 && styles.pillItemBorder,
                                pressed && { opacity: 0.6 },
                            ]}
                            onPress={() => handleNavPress(item)}
                        >
                            <Text style={styles.pillText}>{item}</Text>
                        </Pressable>
                    ))}
                </Animated.View>
            </View>
        </SafeAreaView>
    );
}

const sectionCardBase = {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.xxl,
    paddingHorizontal: SECTION_HORIZONTAL_PADDING,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.bgPrimary,
    },
    container: {
        flex: 1,
        backgroundColor: colors.bgPrimary,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 120,
    },
    contentWrap: {
        marginHorizontal: IS_SMALL_SCREEN ? spacing.lg : CONTENT_MARGIN,
    },
    sectionSpacing: {
        marginTop: IS_SMALL_SCREEN ? 14 : 18,
    },

    // ── Split Screen Hero ──────────────────
    splitHero: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    splitTop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '50%',
        backgroundColor: colors.brandCoral,
        overflow: 'hidden',
    },
    splitBottom: {
        position: 'absolute',
        top: '50%',
        marginTop: -1,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#141517',
        overflow: 'hidden',
    },
    splitsTextBox: {
        position: 'absolute',
        bottom: -SPLITS_BOX / 2,
        left: 0,
        right: 0,
        height: SPLITS_BOX,
        alignItems: 'center',
        justifyContent: 'center',
    },
    splitsTextBoxBottom: {
        position: 'absolute',
        top: -SPLITS_BOX / 2,
        left: 0,
        right: 0,
        height: SPLITS_BOX,
        alignItems: 'center',
        justifyContent: 'center',
    },
    splitsText: {
        fontSize: SPLITS_FONT_SIZE,
        fontWeight: '900',
        letterSpacing: SPLITS_FONT_SIZE * -0.05,
        color: '#ffffff',
        includeFontPadding: false,
    },
    scrollIndicator: {
        position: 'absolute',
        bottom: 48,
        alignItems: 'center',
        zIndex: 20,
    },
    scrollLine: {
        width: 1,
        height: 28,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
        marginBottom: 10,
    },
    scrollLabel: {
        fontSize: 9,
        fontWeight: '800',
        color: 'rgba(255, 255, 255, 0.45)',
        letterSpacing: 4,
    },

    // ── Section Tag ──────────────────────────
    sectionTag: {
        fontSize: 10,
        fontWeight: '800',
        color: colors.textMuted,
        letterSpacing: 3,
        textAlign: 'center',
        marginBottom: 28,
    },

    // ── 1. Hero Section ──────────────────────
    heroSection: {
        ...sectionCardBase,
        paddingTop: IS_SMALL_SCREEN ? 52 : 72,
        paddingBottom: IS_SMALL_SCREEN ? 44 : 56,
        alignItems: 'center',
        backgroundColor: colors.bgPrimary,
    },
    headline: {
        fontSize: IS_SMALL_SCREEN ? 42 : 58,
        fontWeight: '900',
        color: colors.textMain,
        textAlign: 'center',
        lineHeight: IS_SMALL_SCREEN ? 46 : 62,
        letterSpacing: IS_SMALL_SCREEN ? -2 : -3,
        marginBottom: spacing.lg,
    },
    subtitle: {
        fontSize: IS_SMALL_SCREEN ? 16 : 18,
        color: colors.textMuted,
        textAlign: 'center',
        fontWeight: '500',
        marginBottom: IS_SMALL_SCREEN ? 28 : 40,
    },
    ctaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 12,
    },
    ctaPrimary: {
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        backgroundColor: colors.brandCoral,
        paddingVertical: IS_SMALL_SCREEN ? 16 : 18,
        paddingHorizontal: IS_SMALL_SCREEN ? 38 : 48,
        borderRadius: borderRadius.full,
        shadowColor: colors.brandCoral,
        shadowOpacity: 0.3,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
    },
    ctaPrimaryText: {
        fontSize: 17,
        fontWeight: '800',
        color: '#ffffff',
        letterSpacing: 0.2,
    },
    ctaPressed: {
        opacity: 0.9,
        transform: [{ scale: 0.95 }],
    },

    // ── 2. Steps Section ─────────────────────
    stepsSection: {
        ...sectionCardBase,
        paddingVertical: IS_SMALL_SCREEN ? 36 : 56,
    },
    stepsRow: {
        flexDirection: IS_SMALL_SCREEN ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: IS_SMALL_SCREEN ? spacing.sm : 0,
    },
    stepItem: {
        flex: IS_SMALL_SCREEN ? 0 : 1,
        width: IS_SMALL_SCREEN ? '100%' : undefined,
        alignItems: 'center',
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.sm,
    },
    stepEmoji: {
        fontSize: 32,
        marginBottom: 12,
    },
    stepLabel: {
        fontSize: 16,
        fontWeight: '800',
        color: colors.textMain,
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    stepDesc: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.textMuted,
        textAlign: 'center',
        lineHeight: 16,
    },
    stepArrow: {
        fontSize: 20,
        color: colors.brandCoral,
        fontWeight: '700',
        marginHorizontal: 2,
    },

    // ── 3. Quote Section ─────────────────────
    quoteSection: {
        paddingVertical: IS_SMALL_SCREEN ? 20 : 32,
    },
    quoteCard: {
        backgroundColor: colors.textMain,
        borderRadius: borderRadius.xxxl,
        paddingVertical: IS_SMALL_SCREEN ? 36 : 48,
        paddingHorizontal: spacing.xxl,
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
    },
    quoteText: {
        fontSize: IS_SMALL_SCREEN ? 20 : 24,
        fontWeight: '800',
        color: '#ffffff',
        textAlign: 'center',
        lineHeight: IS_SMALL_SCREEN ? 28 : 34,
        letterSpacing: -1,
    },
    quoteDivider: {
        width: 32,
        height: 2,
        backgroundColor: colors.brandCoral,
        marginVertical: 20,
        alignSelf: 'center',
    },
    quoteAttrib: {
        fontSize: 14,
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.35)',
        fontStyle: 'italic',
        textAlign: 'center',
    },

    // ── 4. Stats Section ─────────────────────
    statsSection: {
        ...sectionCardBase,
        paddingVertical: IS_SMALL_SCREEN ? 42 : 56,
        alignItems: 'center',
    },
    statsRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    statItem: {
        alignItems: 'center',
        position: 'relative',
        width: IS_SMALL_SCREEN ? 74 : 120,
    },
    statIcon: {
        fontSize: 28,
        marginBottom: 12,
    },
    statValue: {
        fontSize: IS_SMALL_SCREEN ? 32 : 52,
        fontWeight: '900',
        color: colors.brandCoral,
        letterSpacing: IS_SMALL_SCREEN ? -1.5 : -3,
        marginBottom: 8,
    },
    statLabel: {
        fontSize: IS_SMALL_SCREEN ? 11 : 13,
        fontWeight: '600',
        color: colors.textMuted,
        textAlign: 'center',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        lineHeight: 18,
    },
    statDivider: {
        width: 1,
        height: IS_SMALL_SCREEN ? 56 : 72,
        backgroundColor: colors.textMuted + '15',
        marginHorizontal: IS_SMALL_SCREEN ? 8 : 16,
        marginTop: IS_SMALL_SCREEN ? 12 : 16,
    },

    // ── 5. Why Splits ─────────────────────────
    whySection: {
        paddingVertical: IS_SMALL_SCREEN ? 40 : 56,
        paddingHorizontal: IS_SMALL_SCREEN ? spacing.lg : spacing.xxl,
        backgroundColor: '#0a0e14',
        borderRadius: borderRadius.xxxl,
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOpacity: 0.15,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
        elevation: 5,
    },
    whySectionTag: {
        fontSize: 10,
        fontWeight: '900',
        color: colors.brandCoral,
        letterSpacing: 4,
        textAlign: 'center',
        marginBottom: 16,
    },
    whyHeadline: {
        fontSize: IS_SMALL_SCREEN ? 24 : 34,
        fontWeight: '900',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: -1.5,
        lineHeight: IS_SMALL_SCREEN ? 31 : 42,
        marginBottom: IS_SMALL_SCREEN ? 26 : 40,
    },
    whyList: {
        gap: 0,
    },
    whyRow: {
        position: 'relative',
        paddingVertical: 22,
        paddingLeft: 20,
        paddingRight: 4,
    },
    whyAccentBar: {
        position: 'absolute',
        left: 0,
        top: 18,
        bottom: 18,
        width: 3,
        borderRadius: 2,
    },
    whyRowInner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 16,
    },
    whyIconCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    whyIconEmoji: {
        fontSize: 22,
    },
    whyTextBlock: {
        flex: 1,
        paddingTop: 2,
    },
    whyFeatureTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#f0f4f8',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    whyFeatureDesc: {
        fontSize: 14,
        fontWeight: '500',
        color: 'rgba(255, 255, 255, 0.45)',
        lineHeight: 20,
    },
    whyRowDivider: {
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        marginTop: 22,
        marginLeft: 64,
    },

    // ── 6. Final CTA Section ─────────────────
    finalSection: {
        ...sectionCardBase,
        paddingVertical: IS_SMALL_SCREEN ? 44 : 56,
        alignItems: 'center',
    },
    finalHeadline: {
        fontSize: IS_SMALL_SCREEN ? 38 : 52,
        fontWeight: '900',
        color: colors.textMain,
        letterSpacing: -3,
        marginBottom: 28,
    },
    ctaGhost: {
        alignItems: 'center',
        alignSelf: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 36,
        borderRadius: borderRadius.full,
        borderWidth: 1.5,
        borderColor: colors.textMain + '15',
    },
    ctaGhostText: {
        fontSize: 17,
        fontWeight: '800',
        color: colors.textMain,
    },

    // ── Footer ───────────────────────────────
    footer: {
        marginTop: 56,
        alignItems: 'center',
    },
    footerLine: {
        width: 32,
        height: 1,
        backgroundColor: colors.textMuted + '20',
        marginBottom: 16,
    },
    footerText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textMuted + '60',
        letterSpacing: 1,
    },

    // ── Floating Nav Pill ─────────────────────
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
        paddingHorizontal: IS_SMALL_SCREEN ? 12 : 18,
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

    // ── Enhanced: Headline accent ────────────
    headlineAccent: {
        color: colors.brandCoral,
    },

    // ── Enhanced: Quote dots ─────────────────
    quoteDots: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
        marginTop: 20,
    },
    quoteDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    quoteDotActive: {
        backgroundColor: colors.brandCoral,
    },

    // ── Enhanced: Final subtext ──────────────
    finalSubtext: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.textMuted,
        textAlign: 'center',
        marginBottom: 32,
        marginTop: -12,
    },
});
