import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../App';
import { fetchLoans, fetchSummary, getErrorMessage, Loan, repayLoan, Summary } from '../api/client';
import LoanItem from '../components/LoanItem';
import SummaryCard from '../components/SummaryCard';
import { useAuth } from '../context/AuthContext';
import { colors, fontSize, radius, spacing } from '../theme';
import { formatCurrency } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Loans'>;

export default function LoansScreen({ navigation }: Props) {
  const { signOut } = useAuth();

  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true); // first load (full-screen spinner)
  const [refreshing, setRefreshing] = useState(false); // pull-to-refresh
  const [error, setError] = useState<string | null>(null);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null); // full-size receipt modal

  // Logout button in the navigation header.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={confirmLogout} hitSlop={10}>
          <Text style={styles.headerButton}>Logout</Text>
        </Pressable>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  function confirmLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  // Loads list + summary together. Summary is a separate endpoint so totals come from SQL.
  const load = useCallback(async () => {
    try {
      const [loanList, summaryData] = await Promise.all([fetchLoans(), fetchSummary()]);
      setLoans(loanList);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  // Runs every time this screen comes into focus: first open AND after returning
  // from AddLoanScreen, which is how the list refreshes after adding a loan.
  useFocusEffect(
    useCallback(() => {
      void load().finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function handleRepay(loan: Loan) {
    Alert.alert(
      'Mark as repaid?',
      `Confirm that ${loan.friend_name} has paid back ${formatCurrency(loan.amount)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, repaid',
          onPress: async () => {
            setRepayingId(loan.id);
            try {
              await repayLoan(loan.id);
              await load(); // refresh list and summary
            } catch (err) {
              Alert.alert('Could not update loan', getErrorMessage(err));
              await load(); // e.g. it was already repaid elsewhere
            } finally {
              setRepayingId(null);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <FlatList
        data={loans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={
          <>
            <SummaryCard summary={summary} />
            {error && (
              <Pressable onPress={handleRefresh} style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Text style={styles.errorRetry}>Tap to retry</Text>
              </Pressable>
            )}
          </>
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No loans yet</Text>
              <Text style={styles.emptyText}>Tap the + button to record money you lent to a friend.</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <LoanItem
            loan={item}
            repaying={repayingId === item.id}
            onRepay={handleRepay}
            onOpenReceipt={setReceiptUri}
          />
        )}
      />

      {/* Floating "+" button */}
      <Pressable style={styles.fab} onPress={() => navigation.navigate('AddLoan')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      {/* Full-size receipt viewer */}
      <Modal visible={receiptUri !== null} transparent animationType="fade" onRequestClose={() => setReceiptUri(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReceiptUri(null)}>
          {receiptUri && <Image source={{ uri: receiptUri }} style={styles.modalImage} resizeMode="contain" />}
          <Text style={styles.modalClose}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerButton: { color: colors.white, fontWeight: '700', fontSize: fontSize.lg },
  listContent: { padding: spacing.lg, paddingBottom: 100 }, // room for the + button
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { color: colors.danger },
  errorRetry: { color: colors.danger, fontWeight: '700', marginTop: spacing.xs },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6, // Android shadow
    shadowColor: '#000', // iOS shadow
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: colors.white, fontSize: 34, lineHeight: 38, fontWeight: '300' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  modalImage: { width: '100%', height: '80%' },
  modalClose: { color: colors.white, marginTop: spacing.lg },
});
