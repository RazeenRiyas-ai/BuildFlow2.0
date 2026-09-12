import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { HqSupplierRow } from '@/components/hq-supplier-row';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { StatusFilterChip } from '@/components/status-filter-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { createSupplier, getSuppliers, updateSupplier } from '@/services/hq-service';
import { AppIcon, Supplier } from '@/types';
import { toUserMessage } from '@/utils/format-error';

const SUPPLIER_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'storefront', web: 'storefront' };

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

function AddSupplierForm({ onCreated }: { onCreated: (supplier: Supplier) => void }) {
  const [name, setName] = useState('');
  const [locality, setLocality] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = name.trim().length > 0 && locality.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const supplier = await createSupplier({ name: name.trim(), locality: locality.trim(), phone: phone.trim() || undefined });
      setName('');
      setLocality('');
      setPhone('');
      onCreated(supplier);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.formCard}>
      <ThemedText type="smallBold">Add Supplier</ThemedText>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Balaji Hardware" />
      <Field label="Locality" value={locality} onChangeText={setLocality} placeholder="e.g. Wagholi" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="e.g. +91 90000 00000" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Add Supplier" variant="outline" disabled={!canSave} loading={saving} onPress={handleSave} />
    </ThemedView>
  );
}

function EditSupplierForm({
  supplier,
  onSaved,
  onCancel,
}: {
  supplier: Supplier;
  onSaved: (supplier: Supplier) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(supplier.name);
  const [locality, setLocality] = useState(supplier.locality);
  const [phone, setPhone] = useState(supplier.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = name.trim().length > 0 && locality.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSupplier(supplier.id, { name: name.trim(), locality: locality.trim(), phone: phone.trim() || null });
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
      const updated = await updateSupplier(supplier.id, { isActive: !supplier.isActive });
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
      <ThemedText type="smallBold">Edit Supplier</ThemedText>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Balaji Hardware" />
      <Field label="Locality" value={locality} onChangeText={setLocality} placeholder="e.g. Wagholi" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="e.g. +91 90000 00000" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <View style={styles.editActions}>
        <PrimaryButton label="Save" disabled={!canSave} loading={saving} onPress={handleSave} />
        <PrimaryButton
          label={supplier.isActive === false ? 'Reactivate' : 'Deactivate'}
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

export default function HqSuppliersListScreen() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchSuppliers = useCallback(() => getSuppliers(includeInactive), [includeInactive]);
  const {
    data: suppliers,
    isLoading,
    error,
    refetch,
    setData: setSuppliers,
  } = useAsyncData<Supplier[]>(fetchSuppliers, [], { auto: false });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  function handleCreated(supplier: Supplier) {
    setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
    setAdding(false);
  }

  function handleSaved(updated: Supplier) {
    setSuppliers((prev) => {
      // A supplier deactivated while the list is showing active-only drops out of view entirely,
      // rather than lingering with a now-stale "Inactive" badge the contractor never re-fetched.
      if (!includeInactive && updated.isActive === false) return prev.filter((s) => s.id !== updated.id);
      return prev.map((s) => (s.id === updated.id ? updated : s));
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
        <ThemedText type="subtitle">Suppliers</ThemedText>

        {error && <ErrorBanner message={error} onRetry={refetch} />}

        {adding && <AddSupplierForm onCreated={handleCreated} />}

        <View style={styles.chipRow}>
          <StatusFilterChip label="Show inactive" active={includeInactive} onPress={() => setIncludeInactive((v) => !v)} />
        </View>

        {!isLoading && !error && suppliers.length === 0 && (
          <EmptyState
            icon={SUPPLIER_ICON}
            title="No suppliers yet"
            message="Add a supplier so HQ can pick them when contacting or assigning an order."
          />
        )}

        <View style={styles.list}>
          {suppliers.map((supplier) =>
            editingId === supplier.id ? (
              <EditSupplierForm key={supplier.id} supplier={supplier} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
            ) : (
              <Pressable key={supplier.id} onPress={() => setEditingId(supplier.id)} style={({ pressed }) => pressed && styles.pressed}>
                <HqSupplierRow supplier={supplier} />
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
