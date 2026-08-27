-- Drizzle metadata baseline for the already-applied manual migrations
-- 0019 through 0025. This is deliberately a D1 no-op: schema changes are
-- exclusively in those preceding migrations; the paired snapshot prevents a
-- future drizzle-kit generate from re-emitting their tables and indexes.
SELECT 1;
