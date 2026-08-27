alter type public.attempt_status
  add value if not exists 'pending_review';
