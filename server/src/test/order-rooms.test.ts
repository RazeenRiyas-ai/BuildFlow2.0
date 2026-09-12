import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { pool } from '../config/db';
import { env } from '../config/env';
import { initRealtime } from '../realtime/socket-server';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

interface JoinAck {
  ok: boolean;
  error?: string;
}

describe('Order rooms + order events (Socket.io)', () => {
  const contractorPhone = uniquePhone();
  const otherContractorPhone = uniquePhone();
  const password = 'password123';

  let contractorToken: string;
  let otherContractorToken: string;
  let hqToken: string;
  let siteId: string;
  let materialId: string;
  let materialQuantity: number;
  let supplierId: string;
  let driverId: string;
  let orderId: string;

  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'Order Room Contractor', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;
    const contractorId = reg.body.user.id;

    const otherReg = await request(app)
      .post('/auth/register')
      .send({ name: 'Other Contractor', phone: otherContractorPhone, password });
    otherContractorToken = otherReg.body.accessToken;

    const siteInsertSql = 'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id';
    const siteResult = await pool.query(siteInsertSql, [contractorId, 'Order Room Site', 'Order Room Address']);
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    materialQuantity = inStock.minOrderQuantity;
    supplierId = inStock.supplierId;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;

    const driverRes = await request(app)
      .post('/hq/drivers')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ name: 'Ramesh', phone: '+91 90000 55555' });
    driverId = driverRes.body.id;

    httpServer = http.createServer(app);
    initRealtime(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    for (const socket of clientSockets) socket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.query('DELETE FROM orders WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await pool.query('DELETE FROM drivers WHERE id = $1', [driverId]);
    await deleteUserByPhone(contractorPhone);
    await deleteUserByPhone(otherContractorPhone);
    await pool.end();
  });

  // Fresh order per test so status-transition tests don't interfere with each other.
  beforeEach(async () => {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: materialQuantity }] });
    orderId = orderRes.body.id;
  });

  function connect(auth: Record<string, unknown>) {
    const socket = ioClient(serverUrl, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    clientSockets.push(socket);
    return socket;
  }

  async function connected(auth: Record<string, unknown>): Promise<ClientSocket> {
    const socket = connect(auth);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    return socket;
  }

  function join(socket: ClientSocket, orderIdToJoin: string): Promise<JoinAck> {
    return new Promise((resolve) => socket.emit('order:join', { orderId: orderIdToJoin }, resolve));
  }

  function leave(socket: ClientSocket, orderIdToLeave: string): Promise<JoinAck> {
    return new Promise((resolve) => socket.emit('order:leave', { orderId: orderIdToLeave }, resolve));
  }

  /** Drives `orderId` through the real /hq/orders/:id/status endpoint, in sequence, up to (and
   * including) `status`. Needed because HQ's operational actions (assign-supplier, assign-driver,
   * delivery-update) now authoritatively validate the order's current status server-side — a
   * freshly-created 'requested' order (see the per-test beforeEach above) is no longer a valid
   * precondition for any of them, so tests exercising those actions' realtime events must first
   * put the order into a status that actually allows the action, exactly as a real HQ operator's
   * own sequence of taps would. */
  async function advanceStatusTo(status: 'supplier_contacted' | 'supplier_confirmed' | 'driver_assigned') {
    const sequence = ['supplier_contacted', 'supplier_confirmed', 'driver_assigned'] as const;
    for (const step of sequence) {
      await request(app)
        .patch('/hq/orders/' + orderId + '/status')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ status: step });
      if (step === status) break;
    }
  }

  function waitForEvent(socket: ClientSocket, event: string, timeoutMs = 1000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function waitForNoEvent(socket: ClientSocket, event: string, timeoutMs = 300): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, timeoutMs);
      socket.once(event, () => {
        clearTimeout(timer);
        reject(new Error(`unexpected ${event} event`));
      });
    });
  }

  describe('room authorization', () => {
    it('lets a contractor join their own order room', async () => {
      const socket = await connected({ token: contractorToken });
      const ack = await join(socket, orderId);
      expect(ack).toEqual({ ok: true });
    });

    it("rejects a contractor joining another contractor's order room", async () => {
      const socket = await connected({ token: otherContractorToken });
      const ack = await join(socket, orderId);
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/not authorized/i);
      // Must not leak *why* — same generic message regardless of existence vs. ownership.
      expect(ack.error).not.toMatch(/exist/i);
    });

    it('lets hq_admin join any order room', async () => {
      const socket = await connected({ token: hqToken });
      const ack = await join(socket, orderId);
      expect(ack).toEqual({ ok: true });
    });

    it('rejects joining with a malformed orderId', async () => {
      const socket = await connected({ token: contractorToken });
      const ack = await join(socket, 'not-a-uuid');
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/invalid orderid/i);
    });

    it('rejects a token with an unsupported role', async () => {
      const rogueToken = jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role: 'unsupported_role' }, env.JWT_ACCESS_SECRET);
      const socket = await connected({ token: rogueToken });
      const ack = await join(socket, orderId);
      expect(ack.ok).toBe(false);
    });

    it('stops receiving events after leaving the room', async () => {
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);
      await leave(socket, orderId);

      const noEvent = waitForNoEvent(socket, 'order.status_changed');
      await request(app)
        .patch('/hq/orders/' + orderId + '/status')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ status: 'supplier_contacted' });
      await noEvent;
    });
  });

  describe('order.status_changed', () => {
    it('emits exactly once to room subscribers on a successful transition, with a minimal payload', async () => {
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);

      const eventPromise = waitForEvent(socket, 'order.status_changed');
      const res = await request(app)
        .patch('/hq/orders/' + orderId + '/status')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ status: 'supplier_contacted' });
      expect(res.status).toBe(204);

      const payload = await eventPromise;
      expect(payload).toEqual({
        orderId,
        fromStatus: 'requested',
        toStatus: 'supplier_contacted',
        occurredAt: expect.any(String),
      });
    });

    it('emits no event when the transition is rejected as invalid', async () => {
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);

      const noEvent = waitForNoEvent(socket, 'order.status_changed');
      const res = await request(app)
        .patch('/hq/orders/' + orderId + '/status')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ status: 'delivered' }); // requested -> delivered is not a legal transition
      expect(res.status).toBe(409);
      await noEvent;
    });
  });

  describe('supplier / driver / delivery events', () => {
    it('emits order.supplier_contacted with only orderId, supplierId, outcome, occurredAt', async () => {
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);

      const eventPromise = waitForEvent(socket, 'order.supplier_contacted');
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/supplier-contact')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ supplierId, contactMethod: 'phone', outcome: 'confirmed', note: 'internal note, never broadcast' });
      expect(res.status).toBe(204);

      const payload = await eventPromise;
      expect(payload).toEqual({ orderId, supplierId, outcome: 'confirmed', occurredAt: expect.any(String) });
    });

    it('emits order.supplier_assigned with only orderId, supplierId, occurredAt', async () => {
      await advanceStatusTo('supplier_contacted');
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);

      const eventPromise = waitForEvent(socket, 'order.supplier_assigned');
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ supplierId });
      expect(res.status).toBe(204);

      const payload = await eventPromise;
      expect(payload).toEqual({ orderId, supplierId, occurredAt: expect.any(String) });
    });

    it('emits order.driver_assigned with only orderId and occurredAt (no driver name/phone)', async () => {
      await advanceStatusTo('supplier_confirmed');
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);

      const eventPromise = waitForEvent(socket, 'order.driver_assigned');
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId });
      expect(res.status).toBe(204);

      const payload = await eventPromise;
      expect(payload).toEqual({ orderId, occurredAt: expect.any(String) });
    });

    it('emits order.delivery_updated with only orderId and occurredAt (no note text)', async () => {
      await advanceStatusTo('driver_assigned');
      const socket = await connected({ token: contractorToken });
      await join(socket, orderId);

      const eventPromise = waitForEvent(socket, 'order.delivery_updated');
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/delivery-update')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ note: 'Truck departed warehouse, private op note' });
      expect(res.status).toBe(204);

      const payload = await eventPromise;
      expect(payload).toEqual({ orderId, occurredAt: expect.any(String) });
    });
  });
});
