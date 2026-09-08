import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';

describe('GET /materials', () => {
  it('returns all 37 seeded materials', async () => {
    const res = await request(app).get('/materials');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(37);
  });

  it('filters to featured materials only', async () => {
    const res = await request(app).get('/materials?featured=true');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
  });
});

describe('GET /materials/:id', () => {
  let materialId: string;

  it('returns a material by id', async () => {
    const list = await request(app).get('/materials');
    materialId = list.body[0].id;

    const res = await request(app).get('/materials/' + materialId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(materialId);
    expect(res.body.name).toBeTruthy();
    expect(res.body.pricePerUnit).toEqual(expect.any(Number));
  });

  it('returns 400 for a malformed id', async () => {
    const res = await request(app).get('/materials/does-not-exist');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const res = await request(app).get('/materials/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('GET /categories/:id/materials', () => {
  it('returns only materials in that category', async () => {
    const res = await request(app).get('/categories/cement/materials');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    for (const material of res.body) {
      expect(material.categoryId).toBe('cement');
    }
  });
});

describe('GET /materials/search', () => {
  it('finds materials matching a case-insensitive substring', async () => {
    const res = await request(app).get('/materials/search?q=cement');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const material of res.body) {
      expect(material.name.toLowerCase()).toContain('cement');
    }
  });

  it('returns all materials for an empty query', async () => {
    const res = await request(app).get('/materials/search');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(37);
  });
});

afterAll(async () => {
  await pool.end();
});
