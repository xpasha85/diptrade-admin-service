import Database from 'better-sqlite3';
import { resolveSqlitePath } from './sqlite.js';

function openDb(env) {
  return new Database(resolveSqlitePath(env));
}

export function createOrder(env, { name, phone, message }) {
  const db = openDb(env);
  try {
    const result = db.prepare(`
      INSERT INTO orders (name, phone, message)
      VALUES (?, ?, ?)
    `).run(name, phone, message ?? null);

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
    return row;
  } finally {
    db.close();
  }
}

export function listOrders(env) {
  const db = openDb(env);
  try {
    return db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`).all();
  } finally {
    db.close();
  }
}
