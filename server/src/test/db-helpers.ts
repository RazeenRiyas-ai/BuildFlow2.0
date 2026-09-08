import { pool } from '../config/db';

export async function deleteUserByPhone(phone: string) {
  await pool.query('DELETE FROM users WHERE phone = $1', [phone]);
}

export function uniquePhone(): string {
  return `+91 ${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}
