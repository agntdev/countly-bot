/** Durable Counter Tracker data access. D1 is the Worker application's database. */

export type CounterType = "personal" | "shared";
export interface Counter {
  id: string;
  name: string;
  type: CounterType;
  current_value: number;
  creator_id: number;
  created_at: string;
  last_modified_at: string;
}
export interface CounterEvent {
  counter_id: string;
  delta: number;
  new_value: number;
  user_id: number;
  timestamp: string;
  action: "create" | "adjust" | "set" | "rename" | "delete";
  detail?: string;
}

interface D1Result<T> { results?: T[] }
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
export interface D1Database { prepare(sql: string): D1Statement; exec(sql: string): Promise<unknown> }
export type DataCtx = { env?: { DB?: unknown } };

export class StorageUnavailable extends Error {}
export const now = (): Date => new Date();
const stamp = () => now().toISOString();
const dbFor = (ctx: DataCtx): D1Database => {
  const db = ctx.env?.DB as D1Database | undefined;
  if (!db || typeof db.prepare !== "function") throw new StorageUnavailable();
  return db;
};
async function ready(ctx: DataCtx): Promise<D1Database> {
  const db = dbFor(ctx);
  await db.exec(`CREATE TABLE IF NOT EXISTS counters (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, current_value INTEGER NOT NULL, creator_id INTEGER NOT NULL, created_at TEXT NOT NULL, last_modified_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS counters_personal_name ON counters(creator_id, name) WHERE type = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS counters_shared_name ON counters(name) WHERE type = 'shared';
CREATE INDEX IF NOT EXISTS counters_personal_index ON counters(creator_id, type, last_modified_at);
CREATE INDEX IF NOT EXISTS counters_shared_index ON counters(type, last_modified_at);
CREATE TABLE IF NOT EXISTS counter_events (event_id TEXT PRIMARY KEY, counter_id TEXT NOT NULL, delta INTEGER NOT NULL, new_value INTEGER NOT NULL, user_id INTEGER NOT NULL, timestamp TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS counter_events_recent ON counter_events(timestamp);
CREATE TABLE IF NOT EXISTS counter_admins (user_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS counter_admin_invites (code TEXT PRIMARY KEY, created_at TEXT NOT NULL);`);
  return db;
}
function id(): string { return crypto.randomUUID(); }
async function log(ctx: DataCtx, event: CounterEvent): Promise<void> {
  const db = await ready(ctx);
  await db.prepare("INSERT INTO counter_events (event_id,counter_id,delta,new_value,user_id,timestamp,action,detail) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id(), event.counter_id, event.delta, event.new_value, event.user_id, event.timestamp, event.action, event.detail ?? null).run();
}
export async function listCounters(ctx: DataCtx, type: CounterType, userId: number): Promise<Counter[]> {
  const db = await ready(ctx);
  const sql = type === "personal"
    ? "SELECT * FROM counters WHERE type = 'personal' AND creator_id = ? ORDER BY last_modified_at DESC"
    : "SELECT * FROM counters WHERE type = 'shared' ORDER BY last_modified_at DESC";
  return ((await db.prepare(sql).bind(...(type === "personal" ? [userId] : [])).all<Counter>()).results ?? []);
}
export async function getCounter(ctx: DataCtx, counterId: string): Promise<Counter | null> {
  return (await (await ready(ctx)).prepare("SELECT * FROM counters WHERE id = ?").bind(counterId).first<Counter>());
}
export async function createCounter(ctx: DataCtx, name: string, type: CounterType, userId: number): Promise<Counter> {
  const db = await ready(ctx); const at = stamp();
  const counter: Counter = { id: id(), name, type, current_value: 0, creator_id: userId, created_at: at, last_modified_at: at };
  try { await db.prepare("INSERT INTO counters VALUES (?,?,?,?,?,?,?)").bind(counter.id, counter.name, counter.type, 0, userId, at, at).run(); }
  catch { throw new Error("duplicate"); }
  await log(ctx, { counter_id: counter.id, delta: 0, new_value: 0, user_id: userId, timestamp: at, action: "create" });
  return counter;
}
export async function adjustCounter(ctx: DataCtx, counter: Counter, delta: number, userId: number): Promise<Counter> {
  const at = stamp(); const value = counter.current_value + delta; const db = await ready(ctx);
  await db.prepare("UPDATE counters SET current_value = ?, last_modified_at = ? WHERE id = ?").bind(value, at, counter.id).run();
  const updated = { ...counter, current_value: value, last_modified_at: at };
  await log(ctx, { counter_id: counter.id, delta, new_value: value, user_id: userId, timestamp: at, action: "adjust" }); return updated;
}
export async function setCounter(ctx: DataCtx, counter: Counter, value: number, userId: number): Promise<Counter> {
  const at = stamp(); const db = await ready(ctx); await db.prepare("UPDATE counters SET current_value = ?, last_modified_at = ? WHERE id = ?").bind(value, at, counter.id).run();
  const updated = { ...counter, current_value: value, last_modified_at: at };
  await log(ctx, { counter_id: counter.id, delta: value - counter.current_value, new_value: value, user_id: userId, timestamp: at, action: "set" }); return updated;
}
export async function renameCounter(ctx: DataCtx, counter: Counter, name: string, userId: number): Promise<Counter> {
  const at = stamp(); const db = await ready(ctx);
  try { await db.prepare("UPDATE counters SET name = ?, last_modified_at = ? WHERE id = ?").bind(name, at, counter.id).run(); } catch { throw new Error("duplicate"); }
  const updated = { ...counter, name, last_modified_at: at }; await log(ctx, { counter_id: counter.id, delta: 0, new_value: counter.current_value, user_id: userId, timestamp: at, action: "rename", detail: name }); return updated;
}
export async function deleteCounter(ctx: DataCtx, counter: Counter, userId: number): Promise<void> {
  const at = stamp(); await log(ctx, { counter_id: counter.id, delta: 0, new_value: counter.current_value, user_id: userId, timestamp: at, action: "delete", detail: counter.name });
  await (await ready(ctx)).prepare("DELETE FROM counters WHERE id = ?").bind(counter.id).run();
}
export async function isListedAdmin(ctx: DataCtx, userId: number): Promise<boolean> { return !!(await (await ready(ctx)).prepare("SELECT user_id FROM counter_admins WHERE user_id = ?").bind(userId).first()); }
export async function addAdmin(ctx: DataCtx, userId: number): Promise<void> { await (await ready(ctx)).prepare("INSERT OR IGNORE INTO counter_admins (user_id) VALUES (?)").bind(userId).run(); }
export async function removeAdmin(ctx: DataCtx, userId: number): Promise<void> { await (await ready(ctx)).prepare("DELETE FROM counter_admins WHERE user_id = ?").bind(userId).run(); }
export async function listAdminIds(ctx: DataCtx): Promise<number[]> { return ((await (await ready(ctx)).prepare("SELECT user_id FROM counter_admins ORDER BY user_id").all<{ user_id: number }>()).results ?? []).map((row) => row.user_id); }
export async function recentEvents(ctx: DataCtx): Promise<CounterEvent[]> { return ((await (await ready(ctx)).prepare("SELECT counter_id,delta,new_value,user_id,timestamp,action,detail FROM counter_events ORDER BY timestamp DESC LIMIT 10").all<CounterEvent>()).results ?? []); }
export async function createInvite(ctx: DataCtx): Promise<string> { const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10); await (await ready(ctx)).prepare("INSERT INTO counter_admin_invites VALUES (?,?)").bind(code, stamp()).run(); return code; }
export async function redeemInvite(ctx: DataCtx, code: string, userId: number): Promise<boolean> { const db = await ready(ctx); const found = await db.prepare("SELECT code FROM counter_admin_invites WHERE code = ?").bind(code).first(); if (!found) return false; await addAdmin(ctx, userId); await db.prepare("DELETE FROM counter_admin_invites WHERE code = ?").bind(code).run(); return true; }
