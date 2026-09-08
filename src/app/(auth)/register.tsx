import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/auth-context';
import { toUserMessage } from '@/utils/format-error';
import { Colors, Spacing, StatusColors } from '@/constants/theme';
import { AppIcon } from '@/types';

const EYE_ICON: AppIcon = { ios: 'eye', android: 'visibility', web: 'visibility' };
const EYE_SLASH_ICON: AppIcon = { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' };

export default function RegisterScreen() {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = name.trim().length > 0 && phone.trim().length > 0 && password.length >= 8;

  async function handleRegister() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await register({
        name: name.trim(),
        companyName: companyName.trim() || undefined,
        phone: phone.trim(),
        password,
      });
      router.replace('/');
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenContainer edges={['top']}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to log in"
        hitSlop={8}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={18} tintColor={Colors.textSecondary} />
        <ThemedText type="link" themeColor="textSecondary">
          Back
        </ThemedText>
      </Pressable>

      <ThemedText type="subtitle">Create Account</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Set up your BuildFlow account to start requesting materials.
      </ThemedText>

      <Field
        label="Full Name"
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        returnKeyType="next"
        onSubmitEditing={() => companyNameRef.current?.focus()}
      />
      <Field
        label="Company Name (optional)"
        value={companyName}
        onChangeText={setCompanyName}
        placeholder="Your company"
        inputRef={companyNameRef}
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
      />
      <Field
        label="Phone Number"
        value={phone}
        onChangeText={setPhone}
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        inputRef={phoneRef}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry={!showPassword}
        inputRef={passwordRef}
        returnKeyType="go"
        onSubmitEditing={handleRegister}
        rightAccessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setShowPassword((value) => !value)}>
            <SymbolView name={showPassword ? EYE_SLASH_ICON : EYE_ICON} size={20} tintColor={Colors.textSecondary} />
          </Pressable>
        }
      />

      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      <PrimaryButton label="Create Account" disabled={!canSubmit} loading={submitting} onPress={handleRegister} />
    </ScreenContainer>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  returnKeyType,
  onSubmitEditing,
  inputRef,
  rightAccessory,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'phone-pad' | 'default';
  returnKeyType?: 'next' | 'go';
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
  rightAccessory?: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.inputBox}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize="none"
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={returnKeyType !== 'next'}
        />
        {rightAccessory}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.6,
  },
  field: {
    gap: Spacing.two,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: Colors.text,
  },
  error: {
    color: StatusColors.negative,
  },
});
