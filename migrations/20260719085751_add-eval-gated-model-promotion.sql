alter table public.model_registry
  add column if not exists promoted_at timestamptz,
  add column if not exists promoted_by text,
  add column if not exists approval_id text;

create unique index if not exists model_registry_one_promoted_per_name_idx
  on public.model_registry (model_name)
  where promoted = true;

create index if not exists eval_results_model_suite_status_idx
  on public.eval_results (model_registry_id, eval_suite, status, created_at desc);

create or replace function public.record_model_eval_result(
  p_model_name text,
  p_model_version text,
  p_eval_suite text,
  p_status text,
  p_metrics jsonb default '{}'::jsonb,
  p_modal_endpoint text default null
)
returns table (
  model_registry_id uuid,
  eval_result_id uuid,
  eval_status text,
  promoted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  model_row public.model_registry;
  result_row public.eval_results;
  next_eval_status text;
begin
  if nullif(p_model_name, '') is null then
    raise exception 'model_name_required';
  end if;

  if nullif(p_model_version, '') is null then
    raise exception 'model_version_required';
  end if;

  if p_status not in ('passing', 'failing', 'blocked') then
    raise exception 'invalid_eval_status';
  end if;

  insert into public.model_registry (
    model_name,
    model_version,
    modal_endpoint,
    eval_status,
    promoted,
    metadata
  )
  values (
    p_model_name,
    p_model_version,
    p_modal_endpoint,
    p_status,
    false,
    jsonb_build_object('source', 'record_model_eval_result')
  )
  on conflict (model_name, model_version) do update set
    modal_endpoint = coalesce(excluded.modal_endpoint, public.model_registry.modal_endpoint),
    eval_status = case
      when public.model_registry.promoted then public.model_registry.eval_status
      when excluded.eval_status = 'failing' then 'failing'
      when public.model_registry.eval_status = 'failing' then 'failing'
      when excluded.eval_status = 'blocked' then 'blocked'
      else excluded.eval_status
    end,
    metadata = public.model_registry.metadata || jsonb_build_object('last_eval_suite', p_eval_suite)
  returning * into model_row;

  insert into public.eval_results (
    model_registry_id,
    eval_suite,
    status,
    metrics
  )
  values (
    model_row.id,
    p_eval_suite,
    p_status,
    coalesce(p_metrics, '{}'::jsonb)
  )
  returning * into result_row;

  select case
    when exists (
      select 1
      from public.eval_results er
      where er.model_registry_id = model_row.id
        and er.status = 'failing'
    ) then 'failing'
    when exists (
      select 1
      from public.eval_results er
      where er.model_registry_id = model_row.id
        and er.status = 'blocked'
    ) then 'blocked'
    when not exists (
      select 1
      from unnest(array['scoring_workflow', 'detector_regression', 'privacy_cleaning']) required_suite
      where not exists (
        select 1
        from public.eval_results er
        where er.model_registry_id = model_row.id
          and er.eval_suite = required_suite
          and er.status = 'passing'
      )
    ) then 'passing'
    else 'blocked'
  end into next_eval_status;

  update public.model_registry mr
  set eval_status = next_eval_status,
      metadata = mr.metadata || jsonb_build_object('last_eval_result_id', result_row.id)
  where mr.id = model_row.id
  returning * into model_row;

  return query select model_row.id, result_row.id, model_row.eval_status, model_row.promoted;
end;
$$;

create or replace function public.promote_model_version(
  p_model_name text,
  p_model_version text,
  p_approval_id text,
  p_promoted_by text default null
)
returns public.model_registry
language plpgsql
security definer
set search_path = public
as $$
declare
  model_row public.model_registry;
begin
  if nullif(p_approval_id, '') is null then
    raise exception 'human_approval_required';
  end if;

  select * into model_row
  from public.model_registry mr
  where mr.model_name = p_model_name
    and mr.model_version = p_model_version;

  if not found then
    raise exception 'model_version_not_found';
  end if;

  if model_row.eval_status <> 'passing' then
    raise exception 'evals_not_passing';
  end if;

  if exists (
    select 1
    from unnest(array['scoring_workflow', 'detector_regression', 'privacy_cleaning']) required_suite
    where not exists (
      select 1
      from public.eval_results er
      where er.model_registry_id = model_row.id
        and er.eval_suite = required_suite
        and er.status = 'passing'
    )
  ) then
    raise exception 'required_eval_suite_missing';
  end if;

  update public.model_registry
  set promoted = false
  where model_name = p_model_name
    and promoted = true
    and id <> model_row.id;

  update public.model_registry mr
  set promoted = true,
      promoted_at = now(),
      promoted_by = p_promoted_by,
      approval_id = p_approval_id,
      metadata = mr.metadata || jsonb_build_object(
        'promotion_gate',
        'human_approved_after_required_evals'
      )
  where mr.id = model_row.id
  returning * into model_row;

  return model_row;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.record_model_eval_result(text, text, text, text, jsonb, text) to anon;
    grant execute on function public.promote_model_version(text, text, text, text) to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.record_model_eval_result(text, text, text, text, jsonb, text) to authenticated;
    grant execute on function public.promote_model_version(text, text, text, text) to authenticated;
  end if;
end $$;
