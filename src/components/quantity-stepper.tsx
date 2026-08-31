import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon, UnitOfMeasure } from '@/types';
import { pluralizeUnit } from '@/types/unit';

const MINUS_ICON: AppIcon = { ios: 'minus', android: 'remove', web: 'remove' };
const PLUS_ICON: AppIcon = { ios: 'plus', android: 'add', web: 'add' };

interface QuantityStepperProps {
  quantity: number;
  minQuantity: number;
  step: number;
  unit: UnitOfMeasure;
  onChange: (quantity: number) => void;
}

export function QuantityStepper({ quantity, minQuantity, step, unit, onChange }: QuantityStepperProps) {
  const canDecrease = quantity - step >= minQuantity;

  return (
    <View style={styles.row}>
      <StepperButton icon={MINUS_ICON} disabled={!canDecrease} onPress={() => onChange(Math.max(minQuantity, quantity - step))} />
      <View style={styles.valueWrapper}>
        <ThemedText type="smallBold" style={{ fontVariant: ['tabular-nums'] }}>
          {quantity}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {pluralizeUnit(unit, quantity)}
        </ThemedText>
      </View>
      <StepperButton icon={PLUS_ICON} onPress={() => onChange(quantity + step)} />
    </View>
  );
}

function StepperButton({
  icon,
  disabled,
  onPress,
}: {
  icon: AppIcon;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed]}>
      <SymbolView name={icon} size={16} weight="bold" tintColor={Colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.backgroundElement,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    padding: Spacing.two,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.7,
  },
  valueWrapper: {
    alignItems: 'center',
    gap: Spacing.half,
  },
});
