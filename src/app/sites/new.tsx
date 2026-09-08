import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { useSites } from '@/context/sites-context';
import { Colors, Spacing } from '@/constants/theme';
import { toUserMessage } from '@/utils/format-error';

export default function AddSiteScreen() {
  const { addSite } = useSites();
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = label.trim().length > 0 && address.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await addSite({ label: label.trim(), address: address.trim(), notes: notes.trim() || undefined });
      router.back();
    } catch (err) {
      // Fields are intentionally left as-is so the contractor can retry without retyping anything.
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <ScreenContainer>
      <Field label="Site Name" value={label} onChangeText={setLabel} placeholder="e.g. Sunrise Residency — Block C" />
      <Field
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="Plot / street, area, city, PIN code"
        multiline
      />
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Gate code, landmark, etc." />

      {error && <ErrorBanner message={error} onRetry={handleSave} />}

      <PrimaryButton label="Save Site" disabled={!canSave} loading={saving} onPress={handleSave} />
    </ScreenContainer>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: Colors.text,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
