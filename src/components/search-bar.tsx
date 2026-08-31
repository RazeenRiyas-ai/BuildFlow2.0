import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon } from '@/types';

const SEARCH_ICON: AppIcon = { ios: 'magnifyingglass', android: 'search', web: 'search' };

interface SearchBarLinkProps {
  variant: 'link';
  placeholder: string;
  onPress: () => void;
}

interface SearchBarInputProps {
  variant: 'input';
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
}

type SearchBarProps = SearchBarLinkProps | SearchBarInputProps;

export function SearchBar(props: SearchBarProps) {
  if (props.variant === 'link') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={props.onPress}
        style={({ pressed }) => [styles.shell, pressed && styles.pressed]}>
        <SymbolView name={SEARCH_ICON} size={18} tintColor={Colors.textSecondary} />
        <ThemedText type="default" themeColor="textSecondary">
          {props.placeholder}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.shell}>
      <SymbolView name={SEARCH_ICON} size={18} tintColor={Colors.textSecondary} />
      <TextInput
        style={styles.input}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.textSecondary}
        value={props.value}
        onChangeText={props.onChangeText}
        autoFocus={props.autoFocus}
        returnKeyType="search"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 48,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    backgroundColor: Colors.backgroundElement,
  },
  pressed: {
    opacity: 0.7,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
  },
});
