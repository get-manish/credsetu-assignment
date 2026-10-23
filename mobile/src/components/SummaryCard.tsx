import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Summary } from '../api/client';
import { colors, fontSize, radius, spacing } from '../theme';
import { formatCurrency } from '../utils/format';

// Four numbers at the top of the Loans screen. Overdue is red so it stands out.
export default function SummaryCard({ summary }: { summary: Summary | null }) {
  // Before the first load finishes we show dashes instead of misleading zeros.
  const show = (n?: number) => (summary ? formatCurrency(n ?? 0) : '—');

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Stat label="Total Lent" value={show(summary?.total_lent)} />
        <Stat label="Total Repaid" value={show(summary?.total_repaid)} color={colors.success} />
      </View>
      <View style={styles.row}>
        <Stat label="Outstanding" value={show(summary?.outstanding)} />
        <Stat
          label={summary && summary.overdue_count > 0 ? `Overdue (${summary.overdue_count})` : 'Overdue'}
          value={show(summary?.overdue_amount)}
          color={colors.danger}
        />
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.lg,
  },
  row: { flexDirection: 'row', gap: spacing.lg },
  stat: { flex: 1 },
  label: { color: colors.textMuted, fontSize: fontSize.sm, marginBottom: spacing.xs },
  value: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700' },
});
