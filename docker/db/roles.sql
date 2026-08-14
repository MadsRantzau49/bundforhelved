\set authpass `echo "$AUTH_DB_PASSWORD"`
\set restpass `echo "$REST_DB_PASSWORD"`
\set storagepass `echo "$STORAGE_DB_PASSWORD"`
\set poolerpass `echo "$POOLER_DB_PASSWORD"`

alter user authenticator with password :'restpass';
alter user pgbouncer with password :'poolerpass';
alter user supabase_auth_admin with password :'authpass';
alter user supabase_storage_admin with password :'storagepass';

-- The Postgres image ships these helpers as postgres, while GoTrue's first
-- migration replaces them as supabase_auth_admin.
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
