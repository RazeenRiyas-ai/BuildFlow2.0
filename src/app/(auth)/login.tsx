import { SymbolView } from 'expo-symbols';
import { Link } from 'expo-router';
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

export default function LoginScreen() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = phone.trim().length > 0 && password.length > 0;

  async function handleLogin() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(phone.trim(), password);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenContainer edges={['top']}>
      <ThemedText type="subtitle">BuildFlow</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Log in to manage your material orders.
      </ThemedText>

      <Field
        label="Phone Number"
        value={phone}
        onChangeText={setPhone}
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry={!showPassword}
        inputRef={passwordRef}
        returnKeyType="go"
        onSubmitEditing={handleLogin}
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

      <PrimaryButton label="Log In" disabled={!canSubmit} loading={submitting} onPress={handleLogin} />

      <Link href="/(auth)/register" style={styles.link}>
        <ThemedText type="smallBold">New here? Create an account</ThemedText>
      </Link>
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
  link: {
    alignSelf: 'center',
  },
});
