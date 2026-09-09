import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Imported by relative path, not the bare 'expo-notifications'/'react-native' specifiers: tsc
// resolves those against the real packages' own type declarations (which obviously don't export
// test-control helpers), while `node --test` resolves the bare specifiers to these exact same mock
// files via scripts/test-alias-loader.mjs — same resolved file URL, same live module instance
// either way, so state set through this import is the same state push-service.ts's own
// `import * as Notifications from 'expo-notifications'` reads and mutates.
import {
  __resetExpoNotificationsMock,
  __setCurrentPermissionStatus,
  __setNextRequestResult,
  __setThrowOnGetToken,
  __getCallCounts,
} from '../../scripts/test-mocks/expo-notifications.mjs';
import { __setTestPlatformOS } from '../../scripts/test-mocks/react-native.mjs';
import { clearSession } from '@/services/session-manager';
import {
  __resetPushServiceStateForTests,
  dismissPushPermissionPrompt,
  getPushPermissionStatus,
  hasPromptedForPushPermission,
  registerPushTokenIfPermissionGranted,
  requestPushPermissionAndRegister,
  unregisterCurrentPushToken,
} from '@/services/push-service';

const originalFetch = globalThis.fetch;

interface CapturedCall {
  path: string;
  body: any;
}

function installFetchRecorder(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = '/' + url.split('/').slice(3).join('/');
    calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : null });
    // A 204 response must have no body (Fetch spec) — matches what /push/register and
    // /push/unregister actually return, and what api-client.ts's request() special-cases.
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return calls;
}

beforeEach(async () => {
  __resetExpoNotificationsMock();
  __setTestPlatformOS('ios');
  globalThis.fetch = originalFetch;
  await clearSession();
  await __resetPushServiceStateForTests();
});

describe('getPushPermissionStatus', () => {
  test('never prompts — reports "unsupported" on web without touching expo-notifications at all', async () => {
    __setTestPlatformOS('web');
    const status = await getPushPermissionStatus();
    assert.equal(status, 'unsupported');
    assert.equal(__getCallCounts().getPermissions, 0);
  });

  test('reports the real OS status on a native platform, without prompting', async () => {
    __setCurrentPermissionStatus('denied');
    const status = await getPushPermissionStatus();
    assert.equal(status, 'denied');
    assert.equal(__getCallCounts().requestPermissions, 0, 'must never call requestPermissionsAsync');
  });
});

describe('hasPromptedForPushPermission / dismissPushPermissionPrompt', () => {
  test('starts false, and dismissing the soft prompt marks it true without touching OS permission', async () => {
    assert.equal(await hasPromptedForPushPermission(), false);

    await dismissPushPermissionPrompt();

    assert.equal(await hasPromptedForPushPermission(), true);
    assert.equal(__getCallCounts().requestPermissions, 0);
  });
});

describe('requestPushPermissionAndRegister — the one function allowed to show the real OS prompt', () => {
  test('web: reports "unsupported" and never touches expo-notifications or the network', async () => {
    __setTestPlatformOS('web');
    const calls = installFetchRecorder();

    const result = await requestPushPermissionAndRegister();

    assert.equal(result, 'unsupported');
    assert.equal(calls.length, 0);
  });

  test('undetermined -> granted: registers the token and marks the device as prompted', async () => {
    __setCurrentPermissionStatus('undetermined');
    __setNextRequestResult('granted');
    const calls = installFetchRecorder();

    const result = await requestPushPermissionAndRegister();

    assert.equal(result, 'granted');
    assert.equal(await hasPromptedForPushPermission(), true);
    const registerCall = calls.find((c) => c.path === '/push/register');
    assert.ok(registerCall, 'expected a POST /push/register call');
    assert.equal(registerCall!.body.platform, 'ios');
    assert.equal(typeof registerCall!.body.expoPushToken, 'string');
  });

  test('undetermined -> denied: never registers, but still marks the device as prompted (never nags again)', async () => {
    __setCurrentPermissionStatus('undetermined');
    __setNextRequestResult('denied');
    const calls = installFetchRecorder();

    const result = await requestPushPermissionAndRegister();

    assert.equal(result, 'denied');
    assert.equal(await hasPromptedForPushPermission(), true);
    assert.equal(calls.find((c) => c.path === '/push/register'), undefined);
  });
});

describe('registerPushTokenIfPermissionGranted — never prompts', () => {
  test('no-ops when permission has not been granted, and never calls requestPermissionsAsync', async () => {
    __setCurrentPermissionStatus('undetermined');
    const calls = installFetchRecorder();

    await registerPushTokenIfPermissionGranted();

    assert.equal(calls.length, 0);
    assert.equal(__getCallCounts().requestPermissions, 0);
  });

  test('no-ops when permission was denied — must not re-prompt or register', async () => {
    __setCurrentPermissionStatus('denied');
    const calls = installFetchRecorder();

    await registerPushTokenIfPermissionGranted();

    assert.equal(calls.length, 0);
    assert.equal(__getCallCounts().requestPermissions, 0);
  });

  test('silently (re-)registers the current token when permission is already granted', async () => {
    __setCurrentPermissionStatus('granted');
    const calls = installFetchRecorder();

    await registerPushTokenIfPermissionGranted();

    assert.equal(__getCallCounts().requestPermissions, 0, 'already-granted path must never prompt');
    const registerCall = calls.find((c) => c.path === '/push/register');
    assert.ok(registerCall, 'expected a POST /push/register call');
  });

  test('a failure fetching the token is swallowed — never throws, never surfaces to the caller', async () => {
    __setCurrentPermissionStatus('granted');
    __setThrowOnGetToken(true);
    installFetchRecorder();

    await assert.doesNotReject(() => registerPushTokenIfPermissionGranted());
  });
});

describe('unregisterCurrentPushToken', () => {
  test('no-ops when this device never registered a token', async () => {
    const calls = installFetchRecorder();

    await unregisterCurrentPushToken();

    assert.equal(calls.length, 0);
  });

  test('unregisters exactly the token this device last registered, then a second call no-ops', async () => {
    __setCurrentPermissionStatus('undetermined');
    __setNextRequestResult('granted');
    const registerCalls = installFetchRecorder();
    await requestPushPermissionAndRegister();
    const registeredToken = registerCalls.find((c) => c.path === '/push/register')!.body.expoPushToken;

    const unregisterCalls = installFetchRecorder();
    await unregisterCurrentPushToken();

    assert.equal(unregisterCalls.length, 1);
    assert.equal(unregisterCalls[0].path, '/push/unregister');
    assert.equal(unregisterCalls[0].body.expoPushToken, registeredToken);

    const secondRoundCalls = installFetchRecorder();
    await unregisterCurrentPushToken();
    assert.equal(secondRoundCalls.length, 0, 'the locally-stored token was already cleared — nothing left to unregister');
  });

  test('a network/server failure is swallowed — logout must never be blocked by this', async () => {
    __setCurrentPermissionStatus('undetermined');
    __setNextRequestResult('granted');
    installFetchRecorder();
    await requestPushPermissionAndRegister();

    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    await assert.doesNotReject(() => unregisterCurrentPushToken());
  });
});
