-- Fix "function_search_path_mutable" lint warnings.
-- Uses ALTER FUNCTION to set search_path without modifying function bodies.

-- SECURITY DEFINER functions (9)
ALTER FUNCTION public.is_trip_owner(UUID) SET search_path = public;
ALTER FUNCTION public.has_approved_trip_tag(UUID) SET search_path = public;
ALTER FUNCTION public.is_trip_participant(UUID) SET search_path = public;
ALTER FUNCTION public.soft_delete_list(UUID) SET search_path = public;
ALTER FUNCTION public.soft_delete_entry(UUID) SET search_path = public;
ALTER FUNCTION public.purge_soft_deleted(INT) SET search_path = public;
ALTER FUNCTION public.update_display_name(TEXT) SET search_path = public;
ALTER FUNCTION public.atomic_update_entry_with_place(UUID, JSONB, TEXT, JSONB) SET search_path = public;
ALTER FUNCTION public.atomic_create_entry_with_place(UUID, JSONB, JSONB, INTEGER) SET search_path = public;

-- SECURITY INVOKER functions (10)
ALTER FUNCTION public.generate_list_slug(TEXT) SET search_path = public;
ALTER FUNCTION public.generate_trip_share_slug(TEXT) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_list_timestamp() SET search_path = public;
ALTER FUNCTION public.update_outbound_link_timestamp() SET search_path = public;
ALTER FUNCTION public.set_list_slug() SET search_path = public;
ALTER FUNCTION public.soft_delete() SET search_path = public;
ALTER FUNCTION public.sync_place_trip_id() SET search_path = public;
ALTER FUNCTION public.sync_place_trip_id_on_entry_move() SET search_path = public;
ALTER FUNCTION public.get_first_media_per_trip(uuid[]) SET search_path = public;
