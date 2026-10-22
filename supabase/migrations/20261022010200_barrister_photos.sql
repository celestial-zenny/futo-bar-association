-- Public bucket for barrister profile photos (2 MB, JPEG/PNG/WebP).
-- Admins upload anywhere in it; a barrister only inside a folder named after
-- their own user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('barrister-photos', 'barrister-photos', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Photo uploads by admins or the barrister"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'barrister-photos'
    and ((select public.is_admin())
         or (storage.foldername(name))[1] = (select auth.uid())::text)
  );
