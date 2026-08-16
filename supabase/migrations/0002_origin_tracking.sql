-- Origin tracking for cross-backend migration dedup (see dataMigration.ts). NULL means native to
-- this backend (never migrated in from the other side). No FK/CHECK constraint — only two backends
-- exist and origin_backend is validated in application code, not the database.
alter table cards add column origin_backend text;
alter table cards add column origin_id text;
alter table folders add column origin_backend text;
alter table folders add column origin_id text;
