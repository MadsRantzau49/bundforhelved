drop function if exists public.list_peer_review_attempts(integer, timestamptz, uuid);

revoke all on function public.list_peer_review_attempts() from public, anon, authenticated, service_role;
grant execute on function public.list_peer_review_attempts() to authenticated;

notify pgrst, 'reload schema';
