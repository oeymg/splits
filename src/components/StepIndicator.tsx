import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

const STEPS = ['Setup', 'Scan', 'Split', 'Done'] as const;

type Props = {
    currentStep: 1 | 2 | 3 | 4;
};

export function StepIndicator({ currentStep }: Props) {
    return (
        <View style={styles.container}>
            {STEPS.map((label, i) => {
                const stepNum = i + 1;
                const isCompleted = stepNum < currentStep;
                const isCurrent = stepNum === currentStep;
                const isUpcoming = stepNum > currentStep;

                return (
                    <React.Fragment key={label}>
                        <View style={styles.stepColumn}>
                            <View
                                style={[
                                    styles.circle,
                                    isCompleted && styles.circleCompleted,
                                    isCurrent && styles.circleCurrent,
                                    isUpcoming && styles.circleUpcoming,
                                ]}
                            >
                                {isCompleted ? (
                                    <Text style={styles.checkmark}>{'\u2713'}</Text>
                                ) : (
                                    <Text
                                        style={[
                                            styles.circleText,
                                            (isCompleted || isCurrent) && styles.circleTextActive,
                                        ]}
                                    >
                                        {stepNum}
                                    </Text>
                                )}
                            </View>
                            <Text
                                style={[
                                    styles.label,
                                    (isCompleted || isCurrent) && styles.labelActive,
                                ]}
                            >
                                {label}
                            </Text>
                        </View>
                        {i < STEPS.length - 1 && (
                            <View
                                style={[
                                    styles.line,
                                    stepNum < currentStep && styles.lineCompleted,
                                ]}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.xxl,
        paddingHorizontal: spacing.sm,
    },
    stepColumn: {
        alignItems: 'center',
        width: 52,
    },
    circle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
    },
    circleCompleted: {
        backgroundColor: colors.primary,
    },
    circleCurrent: {
        backgroundColor: colors.primary,
        shadowColor: colors.primary,
        shadowOpacity: 0.4,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    circleUpcoming: {
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: colors.border,
    },
    circleText: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.textLight,
    },
    circleTextActive: {
        color: '#ffffff',
    },
    checkmark: {
        fontSize: 15,
        fontWeight: '800',
        color: '#ffffff',
    },
    label: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textLight,
        textAlign: 'center',
    },
    labelActive: {
        color: colors.primary,
        fontWeight: '700',
    },
    line: {
        flex: 1,
        height: 2,
        backgroundColor: colors.border,
        marginTop: 15,
        borderRadius: 1,
    },
    lineCompleted: {
        backgroundColor: colors.primary,
    },
});
