import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getErrorMessage, requestOtp, verifyOtp } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

// Same rule as the server: optional "+", then 10-15 digits.
const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

export default function LoginScreen() {
  const { signIn } = useAuth();

  // Two steps on one screen: 'phone' then 'otp'.
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Strip spaces and dashes people type: "+91 98765-43210" -> "+919876543210".
  const cleanPhone = phone.replace(/[\s-]/g, '');

  async function handleSendOtp() {
    if (!PHONE_REGEX.test(cleanPhone)) {
      setError('Enter a valid phone number (10-15 digits, optional + prefix).');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await requestOtp(cleanPhone);
      setOtp('');
      setStep('otp');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!/^[0-9]{6}$/.test(otp)) {
      setError('Enter the 6-digit OTP.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await verifyOtp(cleanPhone, otp);
      // Saving the token flips AuthContext, and App.tsx swaps to the Loans screen automatically.
      await signIn(token, user);
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }

  function handleChangeNumber() {
    setStep('phone');
    setOtp('');
    setError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.logo}>MiniLedger</Text>
        <Text style={styles.tagline}>Keep track of money you lend to friends</Text>

        <View style={styles.card}>
          {step === 'phone' ? (
            <>
              <Text style={styles.label}>Phone number</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="+919876543210"
                keyboardType="phone-pad"
                autoComplete="tel"
                editable={!loading}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <PrimaryButton title="Send OTP" onPress={handleSendOtp} loading={loading} />
            </>
          ) : (
            <>
              <Text style={styles.label}>Enter the OTP sent to {cleanPhone}</Text>
              <TextInput
                style={[styles.input, styles.otpInput]}
                value={otp}
                onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ''))}
                placeholder="------"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                editable={!loading}
              />
              <Text style={styles.hint}>Check the server console for the OTP</Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <PrimaryButton title="Verify" onPress={handleVerify} loading={loading} />
              <Pressable onPress={handleChangeNumber} disabled={loading} style={styles.linkButton}>
                <Text style={styles.link}>Change number</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Small button with a built-in spinner, used for the main action on this screen.
function PrimaryButton({ title, onPress, loading }: { title: string; onPress: () => void; loading: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  logo: { fontSize: 34, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  tagline: { color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xl, marginTop: spacing.xs },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.xl, gap: spacing.md },
  label: { fontSize: fontSize.md, color: colors.text, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  otpInput: { textAlign: 'center', letterSpacing: 8, fontSize: fontSize.xl },
  hint: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
  error: { color: colors.danger, fontSize: fontSize.md },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
  linkButton: { alignItems: 'center', padding: spacing.sm },
  link: { color: colors.primary, fontWeight: '600' },
});
