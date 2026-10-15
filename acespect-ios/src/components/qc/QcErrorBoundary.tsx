import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { Button } from '../ui';

/**
 * A screen that throws while drawing would otherwise take the whole app down (a release build just closes). Catch it,
 * say what went wrong, and let the person go back or try again.
 */
export class QcErrorBoundary extends React.Component<{ children: React.ReactNode; onBack?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.box}>
        <Text style={styles.title}>This screen hit a problem</Text>
        <Text style={styles.msg} selectable>{this.state.error.message}</Text>
        <View style={{ gap: spacing.md }}>
          <Button label="Try again" onPress={() => this.setState({ error: null })} />
          {this.props.onBack && <Button label="Go back" variant="outline" onPress={this.props.onBack} />}
        </View>
      </View>
    );
  }
}

/** Wrap a navigation screen so a render failure shows a message instead of closing the app. */
export function guarded<P extends { navigation: { goBack: () => void } }>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  const Guarded = (props: P) => (
    <QcErrorBoundary onBack={() => props.navigation.goBack()}>
      <Screen {...props} />
    </QcErrorBoundary>
  );
  Guarded.displayName = `Guarded(${Screen.displayName ?? Screen.name})`;
  return Guarded;
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.background },
  title: { ...typography.h3, color: colors.textPrimary },
  msg: { ...typography.bodySm, color: colors.danger, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md },
});
