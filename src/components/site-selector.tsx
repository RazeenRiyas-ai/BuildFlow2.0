import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { SiteCard } from '@/components/site-card';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon, ConstructionSite } from '@/types';

const ADD_ICON: AppIcon = { ios: 'plus.circle', android: 'add_circle_outline', web: 'add_circle_outline' };

interface SiteSelectorProps {
  sites: ConstructionSite[];
  selectedSiteId: string | null;
  onSelect: (siteId: string) => void;
  onAddNew: () => void;
}

export function SiteSelector({ sites, selectedSiteId, onSelect, onAddNew }: SiteSelectorProps) {
  return (
    <View style={styles.list}>
      {sites.map((site) => (
        <SiteCard key={site.id} site={site} selected={site.id === selectedSiteId} onPress={() => onSelect(site.id)} />
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={onAddNew}
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}>
        <SymbolView name={ADD_ICON} size={20} tintColor={Colors.text} />
        <ThemedText type="smallBold">Add new site</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  pressed: {
    opacity: 0.7,
  },
});
