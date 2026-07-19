
CREATE OR REPLACE FUNCTION public.user_owns_negotiation(_negotiation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.negotiations
    WHERE id = _negotiation_id AND user_id = auth.uid()
  )
$$;
