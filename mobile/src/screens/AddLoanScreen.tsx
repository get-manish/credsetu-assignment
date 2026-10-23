import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../App';
import { createLoan, getErrorMessage, getFieldErrors } from '../api/client';
import { colors, fontSize, radius, spacing } from '../theme';
import { addDays, formatDate, toIsoDate } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'AddLoan'>;
type FieldErrors = { friend_name?: string; amount?: string; due_date?: string; receipt?: string };

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Same rules as the server (backend/src/routes/loans.ts), so most mistakes are caught instantly.
function validateForm(name: string, amount: string): FieldErrors {
  const errors: FieldErrors = {};
  const trimmed = name.trim();
  if (trimmed.length < 1) errors.friend_name = 'Friend name is required';
  else if (trimmed.length > 100) errors.friend_name = 'Friend name must be at most 100 characters';

  const amt = amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amt)) errors.amount = 'Enter a positive amount with at most 2 decimal places';
  else if (Number(amt) <= 0) errors.amount = 'Amount must be greater than 0';
  else if (Number(amt) > 10_000_000) errors.amount = 'Amount must be at most 10,000,000';
  return errors;
}

export default function AddLoanScreen({ navigation }: Props) {
  const [friendName, setFriendName] = useState('');
  const [amount, setAmount] = useState('');
  // Default due date: one week from now. Past dates are allowed (e.g. recording an old loan).
  const [dueDate, setDueDate] = useState<Date>(addDays(new Date(), 7));
  const [showPicker, setShowPicker] = useState(false); // Android shows the picker as a popup
  const [receipt, setReceipt] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleDateChange(_event: DateTimePickerEvent, selected?: Date) {
    setShowPicker(false); // closes the Android popup (harmless on iOS)
    if (selected) setDueDate(selected);
  }

  // ----- receipt picking -----

  function chooseReceiptSource() {
    Alert.alert('Attach receipt', 'Where is the photo?', [
      { text: 'Take photo', onPress: () => void pickReceipt('camera') },
      { text: 'Choose from gallery', onPress: () => void pickReceipt('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickReceipt(source: 'camera' | 'gallery') {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access in Settings to take a photo.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      }
      if (result.canceled) return;

      const asset = result.assets[0];
      if (asset.mimeType && !ALLOWED_MIME.includes(asset.mimeType)) {
        setErrors((e) => ({ ...e, receipt: 'Receipt must be a JPEG, PNG or WebP image' }));
        return;
      }
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        setErrors((e) => ({ ...e, receipt: 'Receipt must be 5MB or smaller' }));
        return;
      }
      setErrors((e) => ({ ...e, receipt: undefined }));
      setReceipt(asset);
    } catch {
      Alert.alert('Could not open the picker', 'Please try again.');
    }
  }

  // ----- submit -----

  async function handleSubmit() {
    const clientErrors = validateForm(friendName, amount);
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) return;

    // multipart/form-data: text fields are strings; the file is {uri, name, type}.
    const form = new FormData();
    form.append('friend_name', friendName.trim());
    form.append('amount', amount.trim());
    form.append('due_date', toIsoDate(dueDate));
    if (receipt) {
      const type = receipt.mimeType ?? 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      // React Native's FormData accepts this object shape; the cast is needed because
      // TypeScript's built-in FormData type only knows about Blob.
      form.append('receipt', { uri: receipt.uri, name: `receipt.${ext}`, type } as unknown as Blob);
    }

    setSubmitting(true);
    try {
      await createLoan(form);
      navigation.goBack(); // LoansScreen reloads itself when it regains focus
    } catch (err) {
      // Show server-side validation messages next to the right fields, if any.
      const fieldErrors = getFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else setFormError(getErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Friend's name</Text>
          <TextInput
            style={[styles.input, errors.friend_name && styles.inputError]}
            value={friendName}
            onChangeText={setFriendName}
            placeholder="e.g. Rahul Sharma"
            maxLength={100}
            editable={!submitting}
          />
          {errors.friend_name && <Text style={styles.error}>{errors.friend_name}</Text>}

          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput
            style={[styles.input, errors.amount && styles.inputError]}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            editable={!submitting}
          />
          {errors.amount && <Text style={styles.error}>{errors.amount}</Text>}

          <Text style={styles.label}>Due date</Text>
          {Platform.OS === 'ios' ? (
            // iOS: a compact inline picker that is always visible.
            <View style={styles.iosPicker}>
              <DateTimePicker value={dueDate} mode="date" display="compact" onChange={handleDateChange} />
            </View>
          ) : (
            // Android: a button that opens the system date dialog.
            <>
              <Pressable style={styles.input} onPress={() => setShowPicker(true)} disabled={submitting}>
                <Text style={styles.dateText}>{formatDate(toIsoDate(dueDate))}</Text>
              </Pressable>
              {showPicker && <DateTimePicker value={dueDate} mode="date" onChange={handleDateChange} />}
            </>
          )}
          {errors.due_date && <Text style={styles.error}>{errors.due_date}</Text>}

          <Text style={styles.label}>Receipt (optional)</Text>
          {receipt ? (
            <View style={styles.receiptBox}>
              <Image source={{ uri: receipt.uri }} style={styles.preview} resizeMode="cover" />
              <Pressable onPress={() => setReceipt(null)} disabled={submitting}>
                <Text style={styles.removeText}>Remove photo</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.attachButton} onPress={chooseReceiptSource} disabled={submitting}>
              <Text style={styles.attachText}>Attach receipt photo</Text>
            </Pressable>
          )}
          {errors.receipt && <Text style={styles.error}>{errors.receipt}</Text>}

          {formError && <Text style={[styles.error, styles.formError]}>{formError}</Text>}

          <Pressable
            style={({ pressed }) => [styles.submit, (pressed || submitting) && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitText}>Save loan</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: '600', color: colors.text, marginTop: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  dateText: { fontSize: fontSize.lg, color: colors.text },
  iosPicker: { alignItems: 'flex-start' },
  error: { color: colors.danger, fontSize: fontSize.md },
  formError: { marginTop: spacing.md },
  attachButton: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: 'center',
  },
  attachText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.lg },
  receiptBox: { gap: spacing.sm, alignItems: 'flex-start' },
  preview: { width: 160, height: 160, borderRadius: radius.sm, backgroundColor: colors.border },
  removeText: { color: colors.danger, fontWeight: '600' },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: spacing.xl,
  },
  submitText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
});
