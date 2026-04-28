-- Fix: reassign the latest clinic to user 394ef5ea-ea02-4592-a276-c738f2f36a75
-- Run this once in the Supabase SQL editor.

DO $$
DECLARE
  v_clinic_id uuid;
  v_new_owner uuid := '394ef5ea-ea02-4592-a276-c738f2f36a75';
BEGIN
  SELECT id INTO v_clinic_id
  FROM clinics
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'No clinics found in the database';
  END IF;

  UPDATE clinics
  SET owner_id = v_new_owner
  WHERE id = v_clinic_id;

  -- Keep the owner staff record's user_id in sync
  UPDATE staff
  SET user_id = v_new_owner
  WHERE clinic_id = v_clinic_id
    AND role = 'owner';

  RAISE NOTICE 'Done. Clinic % is now owned by %', v_clinic_id, v_new_owner;
END;
$$;
