import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, StatusColors } from '@/constants/theme';
import { Category, MaterialFormInput, StockStatus, Supplier, UnitOfMeasure } from '@/types';
import { UNIT_LABEL } from '@/types/unit';

const STOCK_STATUS_OPTIONS: { value: StockStatus; label: string }[] = [
  { value: 'in_stock', label: 'In Stock' },
  { value: 'limited_stock', label: 'Limited' },
  { value: 'out_of_stock', label: 'Out of Stock' },
];

/** The contractor-facing app (pluralizeUnit, order screens, etc.) hard-depends on `unit` being one
 * of these exact values — a free-text field here previously let HQ create a material with a unit
 * string ("Bag") the contractor UI couldn't render ("10 undefineds"). A chip picker makes that
 * class of mismatch structurally impossible instead of relying on operator discipline. */
const UNIT_OPTIONS: { value: UnitOfMeasure; label: string }[] = (Object.keys(UNIT_LABEL) as UnitOfMeasure[]).map((unit) => ({
  value: unit,
  label: UNIT_LABEL[unit],
}));

interface MaterialFormProps {
  categories: Category[];
  suppliers: Supplier[];
  initialValues: MaterialFormInput;
  submitLabel: string;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (values: MaterialFormInput) => void;
  /** Only shown when editing an existing material — a brand-new material is always created active. */
  showActiveToggle?: boolean;
  /** Rendered directly beneath the submit button — deliberately not at the top of the form, since
   * the form can be tall enough that the user's scroll position is at the bottom (right where the
   * button they just pressed is) when a save actually completes. */
  successMessage?: string | null;
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

function TextField(props: { value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: 'default' | 'numeric'; multiline?: boolean }) {
  return (
    <TextInput
      style={[styles.input, props.multiline && styles.multilineInput]}
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={Colors.textSecondary}
      keyboardType={props.keyboardType}
      multiline={props.multiline}
    />
  );
}

function ChipPicker<T extends string>(props: { options: { value: T; label: string }[]; selected: T; onSelect: (value: T) => void }) {
  return (
    <View style={styles.chipRow}>
      {props.options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          onPress={() => props.onSelect(option.value)}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type={props.selected === option.value ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
            <ThemedText type="small" themeColor={props.selected === option.value ? 'text' : 'textSecondary'}>
              {option.label}
            </ThemedText>
          </ThemedView>
        </Pressable>
      ))}
    </View>
  );
}

/** Shared create/edit form for HQ material management — both src/app/(hq)/materials/new.tsx and
 * .../[materialId]/index.tsx render this with different initialValues/submitLabel/onSubmit, so the
 * field list and validation-relevant input types only exist in one place. */
export function MaterialForm({ categories, suppliers, initialValues, submitLabel, isSubmitting, error, onSubmit, showActiveToggle, successMessage }: MaterialFormProps) {
  const [values, setValues] = useState<MaterialFormInput>(initialValues);

  function set<K extends keyof MaterialFormInput>(key: K, value: MaterialFormInput[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const isValid =
    values.name.trim().length > 0 &&
    Boolean(values.unit) &&
    values.estimatedDeliveryDays.trim().length > 0 &&
    values.categoryId &&
    values.supplierId &&
    Number(values.pricePerUnit) > 0 &&
    Number(values.minOrderQuantity) > 0 &&
    Number(values.quantityStep) > 0;

  return (
    <View style={styles.form}>
      {error && <ErrorBanner message={error} />}

      <FormField label="Name">
        <TextField value={values.name} onChangeText={(v) => set('name', v)} placeholder="e.g. OPC 43 Grade Cement" />
      </FormField>

      <FormField label="Category">
        <ChipPicker
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          selected={values.categoryId}
          onSelect={(v) => set('categoryId', v)}
        />
      </FormField>

      <FormField label="Supplier">
        <ChipPicker
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          selected={values.supplierId}
          onSelect={(v) => set('supplierId', v)}
        />
      </FormField>

      <FormField label="Unit">
        <ChipPicker options={UNIT_OPTIONS} selected={values.unit} onSelect={(v) => set('unit', v)} />
      </FormField>

      <FormField label="Price per unit (₹)">
        <TextField value={String(values.pricePerUnit || '')} onChangeText={(v) => set('pricePerUnit', Number(v) || 0)} keyboardType="numeric" />
      </FormField>

      <FormField label="Stock status">
        <ChipPicker options={STOCK_STATUS_OPTIONS} selected={values.stockStatus} onSelect={(v) => set('stockStatus', v)} />
      </FormField>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <FormField label="Min order quantity">
            <TextField value={String(values.minOrderQuantity || '')} onChangeText={(v) => set('minOrderQuantity', Number(v) || 0)} keyboardType="numeric" />
          </FormField>
        </View>
        <View style={styles.rowItem}>
          <FormField label="Quantity step">
            <TextField value={String(values.quantityStep || '')} onChangeText={(v) => set('quantityStep', Number(v) || 0)} keyboardType="numeric" />
          </FormField>
        </View>
      </View>

      <FormField label="Estimated delivery">
        <TextField value={values.estimatedDeliveryDays} onChangeText={(v) => set('estimatedDeliveryDays', v)} placeholder="e.g. 1-2 days" />
      </FormField>

      <FormField label="Description / specifications">
        <TextField value={values.description ?? ''} onChangeText={(v) => set('description', v)} multiline placeholder="Specifications, grade, packaging, notes…" />
      </FormField>

      <View style={styles.toggleRow}>
        <ThemedText type="default">Featured</ThemedText>
        <Switch value={values.isFeatured} onValueChange={(v) => set('isFeatured', v)} />
      </View>

      {showActiveToggle && (
        <View style={styles.toggleRow}>
          <View>
            <ThemedText type="default">Active</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Inactive materials are hidden from contractors and cannot be ordered.
            </ThemedText>
          </View>
          <Switch value={values.isActive} onValueChange={(v) => set('isActive', v)} />
        </View>
      )}

      <PrimaryButton label={submitLabel} loading={isSubmitting} disabled={!isValid} onPress={() => onSubmit(values)} />

      {successMessage && (
        <View style={styles.successBanner}>
          <ThemedText type="small" style={styles.successText}>
            {successMessage}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  rowItem: {
    flex: 1,
  },
  input: {
    minHeight: 48,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    backgroundColor: Colors.backgroundElement,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: Colors.text,
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    borderCurve: 'continuous',
  },
  pressed: {
    opacity: 0.7,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  successBanner: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    backgroundColor: StatusColors.positiveBackground,
  },
  successText: {
    color: StatusColors.positive,
  },
});
