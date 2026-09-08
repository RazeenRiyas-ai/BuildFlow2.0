import { router, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { SiteCard } from '@/components/site-card';
import { useSites } from '@/context/sites-context';
import { Spacing } from '@/constants/theme';
import { AppIcon } from '@/types';

const SITE_ICON: AppIcon = { ios: 'mappin.circle.fill', android: 'location_on', web: 'location_on' };

export default function SitesScreen() {
  const { sites, isLoading, error, refetch } = useSites();

  return (
    <>
      <Stack.Screen options={{ title: 'Construction Sites' }} />
      <ScreenContainer>
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        {sites.length === 0 && !isLoading && !error ? (
          <EmptyState
            icon={SITE_ICON}
            title="No construction sites yet"
            message="Add a site so you can select it when placing a request."
          />
        ) : (
          <View style={styles.list}>
            {sites.map((site) => (
              <SiteCard key={site.id} site={site} />
            ))}
          </View>
        )}

        <PrimaryButton label="+ Add Site" variant="outline" onPress={() => router.push('/sites/new')} />
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
});
