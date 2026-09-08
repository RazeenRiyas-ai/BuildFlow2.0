import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app';
import { pool } from '../config/db';
import { env } from '../config/env';
import { requestIdMiddleware } from '../middleware/request-id';
import { errorHandler } from '../middleware/errorHandler';
import { AppError, NotFoundError, ConflictError, ForbiddenError, UnauthorizedError } from '../utils/app-error';
import { ErrorCode } from '../errors/error-codes';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('AppError', () => {
  it('creates an error carrying status, message, code, and details', () => {
    const err = new AppError(418, "I'm a teapot", 'IM_A_TEAPOT', { hint: 'brew coffee instead' });
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe("I'm a teapot");
    expect(err.code).toBe('IM_A_TEAPOT');
    expect(err.details).toEqual({ hint: 'brew coffee instead' });
  });

  it('is a real Error instance (stack, instanceof)', () => {
    const err = new AppError(400, 'bad', 'BAD');
    expect(err).toBeInstanceOf(Error);
    expect(typeof err.stack).toBe('string');
  });

  it('subclasses default to a stable generic code when none is given', () => {
    expect(new NotFoundError().code).toBe(ErrorCode.NOT_FOUND);
    expect(new UnauthorizedError().code).toBe(ErrorCode.UNAUTHORIZED);
    expect(new ForbiddenError().code).toBe(ErrorCode.FORBIDDEN);
    expect(new ConflictError().code).toBe(ErrorCode.CONFLICT);
  });

  it('subclasses still preserve an explicit code and message over the default', () => {
    const err = new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Order not found');
    expect(err.code).toBe(ErrorCode.ORDER_NOT_FOUND);
  });
});

/** A minimal, real Express app — not a mock of errorHandler — wired with the actual
 * requestIdMiddleware and errorHandler, for edge cases (an unexpected native Error, a
 * database-shaped error) that don't correspond to any real business route in the app. */
function buildErrorHandlerTestApp() {
  const testApp = express();
  testApp.use(requestIdMiddleware);

  testApp.get('/known-app-error', () => {
    throw new NotFoundError('Widget not found', 'WIDGET_NOT_FOUND');
  });

  testApp.get('/unexpected-error', () => {
    throw new Error('leaked internal detail: /etc/secrets/db-password.txt and SELECT * FROM users');
  });

  testApp.get('/db-unique-violation', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "users_phone_key"'), {
      code: '23505',
      constraint: 'users_phone_key',
      table: 'users',
      detail: 'Key (phone)=(+1234567890) already exists.',
    });
    throw err;
  });

  testApp.use(errorHandler);
  return testApp;
}

describe('errorHandler — edge cases via a minimal real Express app', () => {
  const testApp = buildErrorHandlerTestApp();

  it('a known AppError: correct status, code, message, and a requestId in both body and header', async () => {
    const res = await request(testApp).get('/known-app-error');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Widget not found');
    expect(res.body.code).toBe('WIDGET_NOT_FOUND');
    expect(typeof res.body.requestId).toBe('string');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('an unexpected native Error becomes a generic 500 with no internal details leaked', async () => {
    const res = await request(testApp).get('/unexpected-error');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(res.body.error).toBe('InternalServerError');
    expect(res.body.stack).toBeUndefined();

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('/etc/secrets');
    expect(raw).not.toContain('SELECT * FROM users');
    expect(raw).not.toContain('leaked internal detail');
  });

  it('a malformed/native database-style error (unique violation) maps to 409 CONFLICT without leaking the raw DB error', async () => {
    const res = await request(testApp).get('/db-unique-violation');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.CONFLICT);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('+1234567890');
    expect(raw).not.toContain('users_phone_key');
    expect(raw).not.toContain('violates unique constraint');
  });

  it('propagates a caller-supplied X-Request-ID into the error response body, matching the header', async () => {
    const res = await request(testApp).get('/known-app-error').set('X-Request-ID', 'test-req-777');
    expect(res.body.requestId).toBe('test-req-777');
    expect(res.headers['x-request-id']).toBe('test-req-777');
  });

  it('a fresh request ID is generated and still propagated when the caller sends none', async () => {
    const res = await request(testApp).get('/known-app-error');
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error taxonomy — real API routes', () => {
  it('validation error (Zod): 400, VALIDATION_ERROR code, and the exact "ValidationError" message the frontend depends on', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(res.body.details).toBeDefined();
    expect(typeof res.body.requestId).toBe('string');
  });

  it('authentication error: no bearer token -> 401 MISSING_TOKEN', async () => {
    const res = await request(app).get('/orders');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.MISSING_TOKEN);
  });

  it('authorization error: authenticated but wrong role -> 403 INSUFFICIENT_ROLE', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Role Test', phone, password: 'password123' });

    const res = await request(app).get('/suppliers').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.INSUFFICIENT_ROLE);

    await deleteUserByPhone(phone);
  });

  it('not-found error: unknown material -> 404 MATERIAL_NOT_FOUND', async () => {
    const res = await request(app).get('/materials/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.MATERIAL_NOT_FOUND);
  });

  it('conflict error: registering an already-used phone number -> 409 PHONE_ALREADY_REGISTERED', async () => {
    const phone = uniquePhone();
    await request(app).post('/auth/register').send({ name: 'First', phone, password: 'password123' });

    const res = await request(app).post('/auth/register').send({ name: 'Second', phone, password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.PHONE_ALREADY_REGISTERED);

    await deleteUserByPhone(phone);
  });

  it('an unmatched route still returns the standard JSON error shape (404 NOT_FOUND) instead of Express\'s default page', async () => {
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.NOT_FOUND);
    expect(typeof res.body.requestId).toBe('string');
  });
});

describe('error taxonomy — authentication code compatibility (pre-existing, must not regress)', () => {
  it('ACCESS_TOKEN_INVALID for a garbage/malformed token', async () => {
    const res = await request(app).get('/orders').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.ACCESS_TOKEN_INVALID);
  });

  it('ACCESS_TOKEN_EXPIRED for a validly-signed but expired access token', async () => {
    const expiredAccessToken = jwt.sign({ sub: 'some-user-id', role: 'contractor' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '-1s',
    });
    const res = await request(app).get('/orders').set('Authorization', `Bearer ${expiredAccessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.ACCESS_TOKEN_EXPIRED);
  });

  it('MISSING_TOKEN, ACCESS_TOKEN_INVALID, and ACCESS_TOKEN_EXPIRED are all distinguishable at the same 401 status', async () => {
    const expiredAccessToken = jwt.sign({ sub: 'some-user-id', role: 'contractor' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '-1s',
    });

    const missing = await request(app).get('/orders');
    const invalid = await request(app).get('/orders').set('Authorization', 'Bearer garbage');
    const expired = await request(app).get('/orders').set('Authorization', `Bearer ${expiredAccessToken}`);

    expect([missing.status, invalid.status, expired.status]).toEqual([401, 401, 401]);
    expect(missing.body.code).toBe(ErrorCode.MISSING_TOKEN);
    expect(invalid.body.code).toBe(ErrorCode.ACCESS_TOKEN_INVALID);
    expect(expired.body.code).toBe(ErrorCode.ACCESS_TOKEN_EXPIRED);

    const codes = new Set([missing.body.code, invalid.body.code, expired.body.code]);
    expect(codes.size).toBe(3);
  });
});

afterAll(async () => {
  await pool.end();
});
