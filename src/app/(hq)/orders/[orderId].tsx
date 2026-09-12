import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { OrderSummaryRow } from '@/components/order-summary-row';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ORDER_TRANSITIONS } from '@/constants/order-transitions';
import { Colors, Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { useOrderRoom } from '@/hooks/use-order-room';
import {
  assignDriver,
  assignSupplier,
  createDriver,
  getDrivers,
  getHqOrderById,
  getSuppliers,
  recordDeliveryUpdate,
  recordSupplierContact,
  updateHqOrderStatus,
} from '@/services/hq-service';
import { AppIcon, Driver, HqOrderDetail, OrderStatus, Supplier } from '@/types';
import { toUserMessage } from '@/utils/format-error';
import { pluralizeUnit } from '@/types/unit';

const CHECK_ICON: AppIcon = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };
const ADD_ICON: AppIcon = { ios: 'plus.circle', android: 'add_circle_outline', web: 'add_circle_outline' };

/** Target-status → button label, driven strictly by ORDER_TRANSITIONS — never hand-listed per screen. */
const STATUS_ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  supplier_contacted: 'Mark Supplier Contacted',
  supplier_confirmed: 'Mark Supplier Confirmed',
  supplier_rejected: 'Mark Supplier Rejected',
  driver_assigned: 'Mark Driver Assigned',
  out_for_delivery: 'Mark Out for Delivery',
  delivered: 'Mark Delivered',
};

const HISTORY_LABELS: Record<string, string> = {
  status_change: 'Status Updated',
  supplier_contact: 'Supplier Contacted',
  supplier_assigned: 'Supplier Assigned',
  driver_assigned: 'Driver Assigned',
  delivery_update: 'Delivery Update',
};

interface OrderDetailData {
  order: HqOrderDetail | null;
  suppliers: Supplier[];
  drivers: Driver[];
}

const EMPTY_DETAIL: OrderDetailData = { order: null, suppliers: [], drivers: [] };

export default function HqOrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const fetchDetail = useCallback(async (): Promise<OrderDetailData> => {
    const [order, suppliers, drivers] = await Promise.all([getHqOrderById(orderId), getSuppliers(), getDrivers()]);
    return { order: order ?? null, suppliers, drivers };
  }, [orderId]);

  const { data, isLoading, error, refetch, setData } = useAsyncData<OrderDetailData>(fetchDetail, EMPTY_DETAIL);
  const { order, suppliers, drivers } = data;

  function handleDriverCreated(driver: Driver) {
    setData((prev) => ({ ...prev, drivers: [...prev.drivers, driver] }));
  }

  useOrderRoom(orderId, refetch);

  async function handleStatusChange(status: OrderStatus) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatusError(null);
    try {
      await updateHqOrderStatus(orderId, status);
      await refetch();
    } catch (err) {
      setStatusError(toUserMessage(err));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  if (isLoading && !order) return null;

  if (error && !order) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Order Detail' }} />
        <ErrorBanner message={error} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  if (!order) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Order Detail' }} />
        <ThemedText type="small" themeColor="textSecondary">
          This order could not be found.
        </ThemedText>
      </ScreenContainer>
    );
  }

  const nextStatuses = ORDER_TRANSITIONS[order.status].filter((status) => status !== 'cancelled');
  const canCancel = ORDER_TRANSITIONS[order.status].includes('cancelled');
  /** These four gates mirror the same status sets the backend now authoritatively enforces (see
   * server/src/modules/orders/orders.service.ts's HQ_ACTION_ALLOWED_STATUSES) — kept here too so
   * the operator never even sees an action that doesn't make sense yet, rather than tapping it and
   * getting a 409. The backend check is what actually prevents a stale/raced request from applying
   * (e.g. another staffer cancelling the order a moment earlier); this is purely the UI's own
   * head start on the same rule. */
  const canContactSupplier = ['requested', 'supplier_contacted', 'supplier_rejected'].includes(order.status);
  const canAssignSupplier = ['supplier_contacted', 'supplier_confirmed'].includes(order.status);
  const canAssignDriver = ['supplier_confirmed', 'driver_assigned'].includes(order.status);
  const canLogDelivery = ['driver_assigned', 'out_for_delivery'].includes(order.status);

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: 'Order Detail' }} />

      {error && <ErrorBanner message={error} onRetry={refetch} />}

      <View style={styles.headerRow}>
        <ThemedText type="subtitle">{order.contractorName}</ThemedText>
        <StatusBadge orderStatus={order.status} />
      </View>
      {order.contractorCompanyName && (
        <ThemedText type="small" themeColor="textSecondary">
          {order.contractorCompanyName} · {order.contractorPhone}
        </ThemedText>
      )}

      <ThemedView type="backgroundElement" style={styles.card}>
        {order.items.map((orderItem, index) => (
          <OrderSummaryRow
            key={`${orderItem.materialId}-${index}`}
            label={orderItem.materialName}
            value={`${orderItem.quantity} ${pluralizeUnit(orderItem.unit, orderItem.quantity)}`}
          />
        ))}
        <OrderSummaryRow label="Delivery Site" value={order.siteLabel} subvalue={order.siteAddress} />
        <OrderSummaryRow label="Estimated Delivery" value={order.estimatedDeliveryDays} />
        {order.contractorNote && <OrderSummaryRow label="Contractor Note" value={order.contractorNote} />}
        {order.driverName && <OrderSummaryRow label="Driver" value={order.driverName} subvalue={order.driverPhone} />}
      </ThemedView>

      {(nextStatuses.length > 0 || canCancel) && (
        <View style={styles.section}>
          <ThemedText type="smallBold">Update Status</ThemedText>
          {nextStatuses.map((status) => (
            <PrimaryButton
              key={status}
              label={STATUS_ACTION_LABELS[status] ?? status}
              loading={busy}
              onPress={() => handleStatusChange(status)}
            />
          ))}
          {canCancel && (
            <PrimaryButton label="Cancel Order" variant="outline" loading={busy} onPress={() => handleStatusChange('cancelled')} />
          )}
          {statusError && <ErrorBanner message={statusError} />}
        </View>
      )}

      {canContactSupplier && (
        <SupplierContactForm suppliers={suppliers} orderId={orderId} onDone={refetch} />
      )}

      {canAssignSupplier && (
        <AssignSupplierForm suppliers={suppliers} orderId={orderId} onDone={refetch} />
      )}

      {canAssignDriver && (
        <AssignDriverForm drivers={drivers} orderId={orderId} onDone={refetch} onDriverCreated={handleDriverCreated} />
      )}

      {canLogDelivery && <DeliveryUpdateForm orderId={orderId} onDone={refetch} />}

      {order.history.length > 0 && (
        <ThemedView type="backgroundElement" style={styles.historyCard}>
          <ThemedText type="smallBold">History</ThemedText>
          {order.history.map((entry) => (
            <View key={entry.id} style={styles.historyEntry}>
              <View style={styles.historyRowTop}>
                <ThemedText type="small">{HISTORY_LABELS[entry.type] ?? entry.type}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </ThemedText>
              </View>
              {entry.contactMethod && (
                <ThemedText type="small" themeColor="textSecondary">
                  {entry.contactMethod} · {entry.outcome}
                </ThemedText>
              )}
              {entry.carrierInfo && (
                <ThemedText type="small" themeColor="textSecondary">
                  {entry.carrierInfo}
                </ThemedText>
              )}
              {entry.note && (
                <ThemedText type="small" themeColor="textSecondary">
                  {entry.note}
                </ThemedText>
              )}
            </View>
          ))}
        </ThemedView>
      )}
    </ScreenContainer>
  );
}

function SupplierPicker({
  suppliers,
  selectedId,
  onSelect,
}: {
  suppliers: Supplier[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.supplierList}>
      {suppliers.map((supplier) => {
        const selected = supplier.id === selectedId;
        return (
          <Pressable
            key={supplier.id}
            accessibilityRole="button"
            onPress={() => onSelect(supplier.id)}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.supplierRow}>
              <View style={styles.supplierTextWrapper}>
                <ThemedText type="smallBold">{supplier.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {supplier.locality}
                </ThemedText>
              </View>
              {selected && <SymbolView name={CHECK_ICON} size={18} tintColor={Colors.text} />}
            </ThemedView>
          </Pressable>
        );
      })}
    </View>
  );
}

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

function SupplierContactForm({
  suppliers,
  orderId,
  onDone,
}: {
  suppliers: Supplier[];
  orderId: string;
  onDone: () => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [contactMethod, setContactMethod] = useState('');
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = !!supplierId && contactMethod.trim().length > 0 && outcome.trim().length > 0;

  async function handleSave() {
    if (!supplierId || !canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await recordSupplierContact(orderId, {
        supplierId,
        contactMethod: contactMethod.trim(),
        outcome: outcome.trim(),
        note: note.trim() || undefined,
      });
      setContactMethod('');
      setOutcome('');
      setNote('');
      await onDone();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Log Supplier Contact</ThemedText>
      <SupplierPicker suppliers={suppliers} selectedId={supplierId} onSelect={setSupplierId} />
      <Field label="Contact Method" value={contactMethod} onChangeText={setContactMethod} placeholder="e.g. Phone call" />
      <Field label="Outcome" value={outcome} onChangeText={setOutcome} placeholder="e.g. Confirmed availability" />
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Additional detail" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Log Contact" variant="outline" disabled={!canSave} loading={saving} onPress={handleSave} />
    </View>
  );
}

function AssignSupplierForm({
  suppliers,
  orderId,
  onDone,
}: {
  suppliers: Supplier[];
  orderId: string;
  onDone: () => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function handleSave() {
    if (!supplierId) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await assignSupplier(orderId, { supplierId, note: note.trim() || undefined });
      setNote('');
      await onDone();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Assign Supplier</ThemedText>
      <SupplierPicker suppliers={suppliers} selectedId={supplierId} onSelect={setSupplierId} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Additional detail" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Assign Supplier" variant="outline" disabled={!supplierId} loading={saving} onPress={handleSave} />
    </View>
  );
}

/** Mirrors SupplierPicker exactly, plus an inline "add new driver" row at the bottom so HQ never
 * has to leave the assignment flow to register a driver it hasn't coordinated with before — the
 * same "don't interrupt the task" reasoning SiteSelector's own "Add new site" row already applies
 * for a contractor picking a delivery site. */
function DriverPicker({
  drivers,
  selectedId,
  onSelect,
  onCreated,
}: {
  drivers: Driver[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (driver: Driver) => void;
}) {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <InlineNewDriverForm
        onCreated={(driver) => {
          onCreated(driver);
          onSelect(driver.id);
          setAdding(false);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  return (
    <View style={styles.supplierList}>
      {drivers.map((driver) => {
        const selected = driver.id === selectedId;
        return (
          <Pressable
            key={driver.id}
            accessibilityRole="button"
            onPress={() => onSelect(driver.id)}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.supplierRow}>
              <View style={styles.supplierTextWrapper}>
                <ThemedText type="smallBold">{driver.name}</ThemedText>
                {driver.phone && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {driver.phone}
                  </ThemedText>
                )}
              </View>
              {selected && <SymbolView name={CHECK_ICON} size={18} tintColor={Colors.text} />}
            </ThemedView>
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.addDriverRow}>
          <SymbolView name={ADD_ICON} size={18} tintColor={Colors.text} />
          <ThemedText type="smallBold">Add new driver</ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

function InlineNewDriverForm({ onCreated, onCancel }: { onCreated: (driver: Driver) => void; onCancel: () => void }) {
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
      onCreated(driver);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <View style={styles.section}>
      <Field label="Driver Name" value={name} onChangeText={setName} placeholder="e.g. Ramesh Kumar" />
      <Field label="Driver Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+91 ..." />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Add Driver" disabled={!canSave} loading={saving} onPress={handleSave} />
      <Pressable onPress={onCancel} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="link" themeColor="textSecondary">
          Cancel
        </ThemedText>
      </Pressable>
    </View>
  );
}

function AssignDriverForm({
  drivers,
  orderId,
  onDone,
  onDriverCreated,
}: {
  drivers: Driver[];
  orderId: string;
  onDone: () => Promise<void>;
  onDriverCreated: (driver: Driver) => void;
}) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function handleSave() {
    if (!driverId) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await assignDriver(orderId, { driverId, note: note.trim() || undefined });
      setNote('');
      await onDone();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Assign Driver</ThemedText>
      <DriverPicker drivers={drivers} selectedId={driverId} onSelect={setDriverId} onCreated={onDriverCreated} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Vehicle number, ETA, etc." />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Assign Driver" variant="outline" disabled={!driverId} loading={saving} onPress={handleSave} />
    </View>
  );
}

function DeliveryUpdateForm({ orderId, onDone }: { orderId: string; onDone: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const canSave = note.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await recordDeliveryUpdate(orderId, note.trim());
      setNote('');
      await onDone();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Delivery Update</ThemedText>
      <Field label="Note" value={note} onChangeText={setNote} placeholder="e.g. Left warehouse at 2pm" />
      {error && <ErrorBanner message={error} onRetry={handleSave} />}
      <PrimaryButton label="Log Update" variant="outline" disabled={!canSave} loading={saving} onPress={handleSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  section: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
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
  supplierList: {
    gap: Spacing.one,
  },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
  },
  supplierTextWrapper: {
    flex: 1,
    gap: Spacing.half,
  },
  addDriverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  pressed: {
    opacity: 0.7,
  },
  historyCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.two,
  },
  historyRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyEntry: {
    gap: Spacing.half,
    paddingVertical: Spacing.half,
  },
});
