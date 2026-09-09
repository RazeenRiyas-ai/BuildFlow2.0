// Minimal test double for expo-notifications — only the surface push-service.ts actually uses.
// State is controllable via the double-underscore helpers below so tests can simulate every
// permission scenario (undetermined -> granted, undetermined -> denied, already granted, already
// denied) without a real device/OS. Never used by the shipped app — see test-alias-loader.mjs,
// which only wires this in under `node --test`.

let currentStatus = 'undetermined';
let nextRequestResult = 'granted';
let expoPushToken = 'ExponentPushToken[test-device]';
let throwOnGetToken = false;
const callCounts = { getPermissions: 0, requestPermissions: 0, getToken: 0, setChannel: 0 };

export function __resetExpoNotificationsMock() {
  currentStatus = 'undetermined';
  nextRequestResult = 'granted';
  expoPushToken = 'ExponentPushToken[test-device]';
  throwOnGetToken = false;
  callCounts.getPermissions = 0;
  callCounts.requestPermissions = 0;
  callCounts.getToken = 0;
  callCounts.setChannel = 0;
}

export function __setCurrentPermissionStatus(status) {
  currentStatus = status;
}

/** What a subsequent requestPermissionsAsync() call resolves to — mirrors the real OS behavior
 * that request only meaningfully changes anything from 'undetermined'; tests that want to assert
 * "denied stays denied" should set __setCurrentPermissionStatus('denied') and leave this alone. */
export function __setNextRequestResult(status) {
  nextRequestResult = status;
}

export function __setExpoPushToken(token) {
  expoPushToken = token;
}

export function __setThrowOnGetToken(shouldThrow) {
  throwOnGetToken = shouldThrow;
}

export function __getCallCounts() {
  return { ...callCounts };
}

export async function getPermissionsAsync() {
  callCounts.getPermissions += 1;
  return { status: currentStatus };
}

export async function requestPermissionsAsync() {
  callCounts.requestPermissions += 1;
  currentStatus = nextRequestResult;
  return { status: currentStatus };
}

export async function getExpoPushTokenAsync() {
  callCounts.getToken += 1;
  if (throwOnGetToken) throw new Error('getExpoPushTokenAsync failed (test double)');
  return { data: expoPushToken };
}

export async function setNotificationChannelAsync() {
  callCounts.setChannel += 1;
}

export function addNotificationResponseReceivedListener(_callback) {
  return { remove() {} };
}

export async function getLastNotificationResponseAsync() {
  return null;
}

export async function clearLastNotificationResponseAsync() {}

export const PermissionStatus = { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' };
export const AndroidImportance = { MAX: 5, DEFAULT: 3 };
