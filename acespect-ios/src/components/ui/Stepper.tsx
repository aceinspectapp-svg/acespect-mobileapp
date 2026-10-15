import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../theme';

export interface Step {
  label: string;
}

interface StepperProps {
  steps: Step[];
  /** Zero-based index of the current step. */
  current: number;
}

/**
 * Horizontal numbered step indicator (1 — 2 — 3) shown in the wizard header.
 * Completed + current steps render filled; upcoming steps render muted.
 * Renders on the dark header, so labels use the on-dark palette.
 */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <View style={styles.row}>
      {steps.map((step, i) => {
        const active = i <= current;
        const isLast = i === steps.length - 1;
        return (
          <React.Fragment key={step.label}>
            <View style={styles.stepCol}>
              <View style={[styles.circle, active ? styles.circleActive : styles.circleInactive]}>
                <Text style={[styles.num, active ? styles.numActive : styles.numInactive]}>
                  {i + 1}
                </Text>
              </View>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {step.label}
              </Text>
            </View>
            {!isLast && <View style={[styles.line, i < current && styles.lineActive]} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  stepCol: { alignItems: 'center', width: 76 },
  circle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleActive: { backgroundColor: colors.white },
  circleInactive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  num: { ...typography.label, fontWeight: '700' },
  numActive: { color: colors.headerGradientFrom },
  numInactive: { color: colors.textOnDarkMuted },
  label: {
    ...typography.caption,
    color: colors.textOnDarkMuted,
    marginTop: 6,
    fontSize: 11,
  },
  labelActive: { color: colors.white, fontWeight: '600' },
  line: {
    height: 2,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 14,
    marginHorizontal: -10,
  },
  lineActive: { backgroundColor: colors.white },
});
