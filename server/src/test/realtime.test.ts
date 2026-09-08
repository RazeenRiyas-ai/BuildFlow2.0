import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { pool } from '../config/db';
import { env } from '../config/env';
import { initRealtime, getRealtimeServer } from '../realtime/socket-server';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

interface SocketConnectError extends Error {
  data?: { code?: string };
}

describe('Realtime (Socket.io) foundation', () => {
  const phone = uniquePhone();
  const password = 'password123';
  let accessToken: string;
  let contractorId: string;
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'Realtime Test', phone, password });
    accessToken = reg.body.accessToken;
    contractorId = reg.body.user.id;

    httpServer = http.createServer(app);
    initRealtime(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    for (const socket of clientSockets) socket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await deleteUserByPhone(phone);
    await pool.end();
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

  it('rejects a connection with no token', async () => {
    const socket = connect({});
    const err = await new Promise<SocketConnectError>((resolve) => {
      socket.on('connect_error', resolve);
      socket.on('connect', () => resolve(new Error('should not have connected')));
    });
    expect(socket.connected).toBe(false);
    expect(err.message).toMatch(/missing token/i);
    expect(err.data?.code).toBe('MISSING_TOKEN');
  });

  it('rejects a connection with a malformed token, coded distinctly from an expired one', async () => {
    const socket = connect({ token: 'not-a-real-token' });
    const err = await new Promise<SocketConnectError>((resolve) => {
      socket.on('connect_error', resolve);
      socket.on('connect', () => resolve(new Error('should not have connected')));
    });
    expect(socket.connected).toBe(false);
    expect(err.message).toMatch(/invalid access token/i);
    expect(err.data?.code).toBe('ACCESS_TOKEN_INVALID');
  });

  it('rejects a connection with an expired token, coded distinctly from a malformed one', async () => {
    const expiredToken = jwt.sign({ sub: contractorId, role: 'contractor' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '-1s',
    });
    const socket = connect({ token: expiredToken });
    const err = await new Promise<SocketConnectError>((resolve) => {
      socket.on('connect_error', resolve);
      socket.on('connect', () => resolve(new Error('should not have connected')));
    });
    expect(socket.connected).toBe(false);
    expect(err.message).toMatch(/expired/i);
    expect(err.data?.code).toBe('ACCESS_TOKEN_EXPIRED');
  });

  it('accepts a connection with a valid token and attaches the correct authenticated user identity', async () => {
    const socket = connect({ token: accessToken });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    expect(socket.connected).toBe(true);

    // Verify server-side what identity actually got attached — never trust the client's own view.
    const serverSocket = getRealtimeServer().sockets.sockets.get(socket.id!);
    expect(serverSocket).toBeDefined();
    expect(serverSocket!.data.user.sub).toBe(contractorId);
    expect(serverSocket!.data.user.role).toBe('contractor');
  });

  it('also accepts the token via a Bearer authorization header, matching the REST convention', async () => {
    const socket = ioClient(serverUrl, {
      extraHeaders: { Authorization: `Bearer ${accessToken}` },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    clientSockets.push(socket);

    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    expect(socket.connected).toBe(true);
  });

  it('does not affect existing REST behavior', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
