/* eslint-disable */
exports.shorthands = undefined;

// No down migration: reversing an added enum value requires recreating the type in Postgres,
// which would risk any 'stale_reminder' rows already written by then — same reasoning as
// 1735510000000_order_fulfillment_and_payment.js's own supplier_assigned/driver_assigned adds.
//
// Phase 3.7: lets sendStaleOrderReminders (orders.service.ts) record its own action as a
// permanent, HQ-visible order_status_history entry — previously the reminder existed purely as a
// push notification with no in-app trace. Safe to add and use in ordinary application code
// afterward: the new value is never referenced by this migration itself, only by later,
// separate transactions.
exports.up = (pgm) => {
  pgm.sql("ALTER TYPE coordination_type ADD VALUE 'stale_reminder';");
};
