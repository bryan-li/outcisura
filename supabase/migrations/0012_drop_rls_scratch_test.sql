-- Cleanup: rls_scratch_test (0010) was a throwaway diagnostic table used to isolate the
-- authenticated-role INSERT/RETURNING RLS mystery — see 0011's header for the actual root cause
-- and fix. Never part of the real app schema.
drop table if exists rls_scratch_test;
