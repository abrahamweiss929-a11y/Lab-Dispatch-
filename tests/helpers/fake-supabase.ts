/**
 * In-memory fake of the subset of `@supabase/supabase-js`'s `SupabaseClient`
 * that the real storage adapter (`interfaces/storage.real.ts`) touches.
 *
 * Design:
 *   - Every terminal query enqueues a "canned response" via
 *     `client.__enqueue(table, op, response)` where `op` is one of
 *     `"select" | "insert" | "update" | "delete"`. When the adapter
 *     awaits the query, the fake drains the first queued response for
 *     that `(table, op)` pair.
 *   - All chained builder methods (`.eq`, `.select`, `.order`, …) are
 *     recorded into `calls` for assertion and return the builder itself
 *     so the adapter's chains compose identically to supabase-js.
 *   - `.single()` and `.maybeSingle()` are terminal: they mark the query
 *     for single-row treatment and resolve to `{ data: row | null, error }`.
 *     The fake does NOT transform queued responses — the test author is
 *     responsible for enqueueing `{ data: row, error: null }` or
 *     `{ data: null, error: null }` (for `maybeSingle` miss) shaped to
 *     match what the adapter expects.
 *   - The fake also exposes an `auth` namespace with `admin.listUsers`
 *     as a `vi.fn()` so tests can set the return value per-test.
 *
 * This helper intentionally doesn't model filter semantics — the real
 * "does a WHERE clause match" check is a pure-unit test concern handled
 * by the mock storage suite. These tests verify the adapter ISSUES the
 * right calls and MAPS the returned data through the mappers.
 */
import { vi } from "vitest";

export interface CannedResponse<T = unknown> {
  data: T | null;
  error: null | { code?: string; message?: string; details?: string };
  count?: number;
}

export interface RecordedCall {
  table: string;
  op: string;
  method: string;
  args: unknown[];
}

export interface FakeSupabase {
  from(table: string): FakeQuery;
  auth: {
    admin: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listUsers: ReturnType<typeof vi.fn<any, any>>;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: ReturnType<typeof vi.fn<any, any>>;
  __enqueue<T = unknown>(
    table: string,
    op: string,
    response: CannedResponse<T>,
  ): void;
  __calls(): RecordedCall[];
  __reset(): void;
}

export interface FakeQuery extends PromiseLike<CannedResponse> {
  select: (...args: unknown[]) => FakeQuery;
  insert: (...args: unknown[]) => FakeQuery;
  update: (...args: unknown[]) => FakeQuery;
  delete: (...args: unknown[]) => FakeQuery;
  eq: (...args: unknown[]) => FakeQuery;
  neq: (...args: unknown[]) => FakeQuery;
  in: (...args: unknown[]) => FakeQuery;
  gte: (...args: unknown[]) => FakeQuery;
  lte: (...args: unknown[]) => FakeQuery;
  is: (...args: unknown[]) => FakeQuery;
  ilike: (...args: unknown[]) => FakeQuery;
  or: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => FakeQuery;
  single: () => FakeQuery;
  maybeSingle: () => FakeQuery;
}

export function makeFakeSupabase(): FakeSupabase {
  const queues = new Map<string, CannedResponse[]>();
  const calls: RecordedCall[] = [];

  function queueKey(table: string, op: string): string {
    return `${table}::${op}`;
  }

  function dequeue(table: string, op: string): CannedResponse {
    const key = queueKey(table, op);
    const q = queues.get(key);
    if (!q || q.length === 0) {
      throw new Error(
        `fake-supabase: no response queued for ${key}. Enqueue one with client.__enqueue("${table}", "${op}", { data, error }).`,
      );
    }
    return q.shift() as CannedResponse;
  }

  function makeQuery(table: string): FakeQuery {
    let currentOp = "select";

    const recordAndReturn = (method: string, args: unknown[]) => {
      calls.push({ table, op: currentOp, method, args });
      return query;
    };

    const query: FakeQuery = {
      select: (...args: unknown[]) => recordAndReturn("select", args),
      insert: (...args: unknown[]) => {
        currentOp = "insert";
        return recordAndReturn("insert", args);
      },
      update: (...args: unknown[]) => {
        currentOp = "update";
        return recordAndReturn("update", args);
      },
      delete: (...args: unknown[]) => {
        currentOp = "delete";
        return recordAndReturn("delete", args);
      },
      eq: (...args: unknown[]) => recordAndReturn("eq", args),
      neq: (...args: unknown[]) => recordAndReturn("neq", args),
      in: (...args: unknown[]) => recordAndReturn("in", args),
      gte: (...args: unknown[]) => recordAndReturn("gte", args),
      lte: (...args: unknown[]) => recordAndReturn("lte", args),
      is: (...args: unknown[]) => recordAndReturn("is", args),
      ilike: (...args: unknown[]) => recordAndReturn("ilike", args),
      or: (...args: unknown[]) => recordAndReturn("or", args),
      order: (...args: unknown[]) => recordAndReturn("order", args),
      limit: (...args: unknown[]) => recordAndReturn("limit", args),
      single: () => recordAndReturn("single", []),
      maybeSingle: () => recordAndReturn("maybeSingle", []),
      then<TResult1 = CannedResponse, TResult2 = never>(
        onFulfilled?:
          | ((value: CannedResponse) => TResult1 | PromiseLike<TResult1>)
          | null,
        onRejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ): PromiseLike<TResult1 | TResult2> {
        try {
          const response = dequeue(table, currentOp);
          return Promise.resolve(response).then(onFulfilled, onRejected);
        } catch (err) {
          return Promise.reject(err).then(
            onFulfilled as never,
            onRejected,
          ) as PromiseLike<TResult1 | TResult2>;
        }
      },
    };
    return query;
  }

  const fake: FakeSupabase = {
    from(table: string): FakeQuery {
      return makeQuery(table);
    },
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: { users: [] },
          error: null,
        })),
      },
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    __enqueue<T>(table: string, op: string, response: CannedResponse<T>): void {
      const key = queueKey(table, op);
      const q = queues.get(key) ?? [];
      q.push(response as CannedResponse);
      queues.set(key, q);
    },
    __calls(): RecordedCall[] {
      return calls.slice();
    },
    __reset(): void {
      queues.clear();
      calls.length = 0;
      fake.auth.admin.listUsers.mockReset();
      fake.auth.admin.listUsers.mockImplementation(async () => ({
        data: { users: [] },
        error: null,
      }));
      fake.rpc.mockReset();
      fake.rpc.mockImplementation(async () => ({ data: null, error: null }));
    },
  };

  return fake;
}
