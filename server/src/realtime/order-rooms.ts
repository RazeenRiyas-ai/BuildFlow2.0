/** Every socket subscribed to updates for a given order joins this one room. Centralized here
 * so the join/leave handlers and the event emitters can never disagree on the room name format. */
export function orderRoomName(orderId: string): string {
  return `order:${orderId}`;
}
