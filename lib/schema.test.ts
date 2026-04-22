import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

const SCHEMA_PATH = path.resolve(__dirname, "../supabase/schema.sql");

const ENUM_NAMES = [
  "user_role",
  "request_channel",
  "request_status",
  "route_status",
] as const;

const TABLE_NAMES = [
  "profiles",
  "offices",
  "doctors",
  "drivers",
  "pickup_requests",
  "routes",
  "stops",
  "driver_locations",
  "messages",
] as const;

const NAMED_INDEXES = [
  "idx_pickup_requests_status_created_at",
  "idx_stops_route_id_position",
  "idx_driver_locations_driver_id_recorded_at",
  "idx_offices_slug",
] as const;

describe("supabase/schema.sql", () => {
  let sql = "";

  beforeAll(() => {
    sql = readFileSync(SCHEMA_PATH, "utf8");
  });

  it("file exists, is non-empty, and begins with the v1 header", () => {
    expect(sql.length).toBeGreaterThan(500);
    expect(sql.startsWith("-- Lab Dispatch v1 schema.")).toBe(true);
  });

  it("enables the pgcrypto extension", () => {
    expect(sql).toMatch(/create extension if not exists pgcrypto/i);
  });

  it("declares every required enum type", () => {
    for (const name of ENUM_NAMES) {
      const pattern = new RegExp(
        String.raw`create type (public\.)?${name} as enum`,
        "i",
      );
      expect(sql, `missing enum ${name}`).toMatch(pattern);
    }
  });

  it("declares every required table", () => {
    for (const name of TABLE_NAMES) {
      const pattern = new RegExp(
        String.raw`create table if not exists (public\.)?${name}`,
        "i",
      );
      expect(sql, `missing table ${name}`).toMatch(pattern);
    }
  });

  it("creates every required named index", () => {
    for (const name of NAMED_INDEXES) {
      const pattern = new RegExp(
        String.raw`create index if not exists ${name}`,
        "i",
      );
      expect(sql, `missing index ${name}`).toMatch(pattern);
    }
  });

  it("enables row level security on every user-facing table", () => {
    for (const name of TABLE_NAMES) {
      const pattern = new RegExp(
        String.raw`alter table (public\.)?${name} enable row level security`,
        "i",
      );
      expect(sql, `RLS not enabled on ${name}`).toMatch(pattern);
    }
  });

  it("retains at least one TODO(auth) comment alongside RLS enablement", () => {
    expect(sql).toMatch(/--\s*TODO\(auth\)/i);
  });
});
