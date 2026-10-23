import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Loan, receiptUrl } from '../api/client';
import { colors, fontSize, radius, spacing } from '../theme';
import { formatCurrency, formatDate } from '../utils/format';

interface Props {
  loan: Loan;
  repaying: boolean; // true while this loan's repay request is in flight
  onRepay: (loan: Loan) => void;
  onOpenReceipt: (uri: string) => void;
}

// One row in the list. Three visual states: Pending, Overdue (red), Repaid (grey + green badge).
export default function LoanItem({ loan, repaying, onRepay, onOpenReceipt }: Props) {
  const status = loan.is_repaid ? 'repaid' : loan.is_overdue ? 'overdue' : 'pending';
  const badge = BADGES[status];

  return (
    <View
      style={[
        styles.card,
        status === 'overdue' && styles.cardOverdue, // red tint + red left border
        status === 'repaid' && styles.cardRepaid, // greyed out
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={[styles.name, status === 'repaid' && styles.mutedText]} numberOfLines={1}>
            {loan.friend_name}
          </Text>
          <Text style={styles.due}>Due {formatDate(loan.due_date)}</Text>
          {status === 'overdue' && (
            <Text style={styles.overdueLabel}>
              Overdue by {loan.days_overdue} {loan.days_overdue === 1 ? 'day' : 'days'}
            </Text>
          )}
        </View>

        <View style={styles.rightBlock}>
          <Text style={[styles.amount, status === 'repaid' && styles.mutedText]}>
            {formatCurrency(loan.amount)}
          </Text>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
          </View>
        </View>
      </View>

      <View style={styles.bottomRow}>
        {loan.receipt_url ? (
          <Pressable onPress={() => onOpenReceipt(receiptUrl(loan.receipt_url as string))}>
            <Image source={{ uri: receiptUrl(loan.receipt_url) }} style={styles.thumb} />
          </Pressable>
        ) : (
          <View />
        )}

        {status !== 'repaid' && (
          <Pressable
            onPress={() => onRepay(loan)}
            disabled={repaying}
            style={({ pressed }) => [styles.repayButton, (pressed || repaying) && { opacity: 0.6 }]}
          >
            {repaying ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.repayText}>Mark as repaid</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const BADGES = {
  pending: { label: 'Pending', bg: colors.warningBg, fg: colors.warning },
  overdue: { label: 'Overdue', bg: colors.danger, fg: colors.white },
  repaid: { label: 'Repaid', bg: colors.successBg, fg: colors.success },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    gap: spacing.md,
  },
  cardOverdue: { backgroundColor: colors.dangerBg, borderLeftColor: colors.danger },
  cardRepaid: { backgroundColor: colors.greyBg, borderLeftColor: colors.success, opacity: 0.8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  nameBlock: { flex: 1, gap: 2 },
  rightBlock: { alignItems: 'flex-end', gap: spacing.xs },
  name: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  due: { fontSize: fontSize.md, color: colors.textMuted },
  overdueLabel: { fontSize: fontSize.md, color: colors.danger, fontWeight: '700' },
  amount: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  mutedText: { color: colors.textMuted },
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  badgeText: { fontSize: fontSize.sm, fontWeight: '700' },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.border },
  repayButton: {
    backgroundColor: colors.success,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minWidth: 130,
    alignItems: 'center',
  },
  repayText: { color: colors.white, fontWeight: '700', fontSize: fontSize.md },
});
