import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { HqDriverRow } from '@/components/hq-driver-row';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { StatusFilterChip } from '@/components/status-filter-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { createDriver, getDrivers, updateDriver } from '@/services/hq-service';
import { AppIcon, Driver } from '@/types';
import { toUserMessage } from '@/utils/format-error';

const TRUCK_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'local_shipping', web: 'local_shipping' };

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
      />
    </View>
  );
}

function AddDriverForm({ onCreated }: { onCreated: (driver: Driver) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const driver = await createDriver({ name: name.trim(), phone: phone.trim() || undefined });
      setName('');
      setPhone('');
      onCreated(driver);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.formCard}>
      <ThemedText type="smallBold">Add Driver</ThemedText>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Ramesh Kumar" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="e.g. +91 90000 00000" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Add Driver" variant="outline" disabled={!canSave} loading={saving} onPress={handleSave} />
    </ThemedView>
  );
}

function EditDriverForm({ driver, onSaved, onCancel }: { driver: Driver; onSaved: (driver: Driver) => void; onCancel: () => void }) {
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDriver(driver.id, { name: name.trim(), phone: phone.trim() || null });
      onSaved(updated);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  async function handleToggleActive() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDriver(driver.id, { isActive: !driver.isActive });
      onSaved(updated);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.formCard}>
      <ThemedText type="smallBold">Edit Driver</ThemedText>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Ramesh Kumar" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="e.g. +91 90000 00000" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <View style={styles.editActions}>
        <PrimaryButton label="Save" disabled={!canSave} loading={saving} onPress={handleSave} />
        <PrimaryButton
          label={driver.isActive ? 'Deactivate' : 'Reactivate'}
          variant="outline"
          loading={saving}
          onPress={handleToggleActive}
        />
        <Pressable onPress={onCancel} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="link" themeColor="textSecondary" style={styles.cancelLink}>
            Cancel
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

export default function HqDriversListScreen() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchDrivers = useCallback(() => getDrivers(includeInactive), [includeInactive]);
  const { data: drivers, isLoading, error, refetch, setData: setDrivers } = useAsyncData<Driver[]>(fetchDrivers, [], { auto: false });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  function handleCreated(driver: Driver) {
    setDrivers((prev) => [...prev, driver].sort((a, b) => a.name.localeCompare(b.name)));
    setAdding(false);
  }

  function handleSaved(updated: Driver) {
    setDrivers((prev) => {
      // A driver deactivated while the list is showing active-only drops out of view entirely,
      // rather than lingering with a now-stale "Inactive" badge the contractor never re-fetched.
      if (!includeInactive && !updated.isActive) return prev.filter((d) => d.id !== updated.id);
      return prev.map((d) => (d.id === updated.id ? updated : d));
    });
    setEditingId(null);
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => setAdding((v) => !v)}>
              <ThemedText type="link">{adding ? 'Cancel' : 'New'}</ThemedText>
            </Pressable>
          ),
        }}
      />
      <ScreenContainer>
        <ThemedText type="subtitle">Drivers</ThemedText>

        {error && <ErrorBanner message={error} onRetry={refetch} />}

        {adding && <AddDriverForm onCreated={handleCreated} />}

        <View style={styles.chipRow}>
          <StatusFilterChip label="Show inactive" active={includeInactive} onPress={() => setIncludeInactive((v) => !v)} />
        </View>

        {!isLoading && !error && drivers.length === 0 && (
          <EmptyState icon={TRUCK_ICON} title="No drivers yet" message="Add a driver so HQ can pick them when assigning a delivery." />
        )}

        <View style={styles.list}>
          {drivers.map((driver) =>
            editingId === driver.id ? (
              <EditDriverForm key={driver.id} driver={driver} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
            ) : (
              <Pressable key={driver.id} onPress={() => setEditingId(driver.id)} style={({ pressed }) => pressed && styles.pressed}>
                <HqDriverRow driver={driver} />
              </Pressable>
            ),
          )}
        </View>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
  formCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.half,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    padding: Spacing.two,
    color: Colors.text,
  },
  editActions: {
    gap: Spacing.two,
    alignItems: 'stretch',
  },
  cancelLink: {
    textAlign: 'center',
  },
});
