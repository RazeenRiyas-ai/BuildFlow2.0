import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';

describe('GET /categories', () => {
  it('returns all 10 seeded categories', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
  });

  it('returns a shape matching the frontend Category type', async () => {
    const res = await request(app).get('/categories');
    const cement = res.body.find((c: any) => c.id === 'cement');
    expect(cement).toBeDefined();
    expect(cement.name).toBe('Cement');
    expect(cement.icon).toEqual({ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' });
  });
});

describe('GET /categories/:id', () => {
  it('returns a single category by id', async () => {
    const res = await request(app).get('/categories/steel');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('steel');
    expect(res.body.name).toBe('Steel');
  });

  it('returns 404 for an unknown category id', async () => {
    const res = await request(app).get('/categories/does-not-exist');
    expect(res.status).toBe(404);
  });
});

afterAll(async () => {
  await pool.end();
});
