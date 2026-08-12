-- ============================================================
-- SHRS: Safety Hazard Reporting System
-- Run this entire file in the Supabase SQL Editor:
--   Project Dashboard → SQL Editor → New Query → Paste → Run
--
-- NOTE: Shares the public.companies and public.managers tables
-- with SRTS (same "AutoRise MVPs" Supabase project).
-- Only adds the hazard_reports table and storage bucket.
-- ============================================================


-- ============================================================
-- 1. HAZARD_REPORTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hazard_reports (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Location (4-level hierarchy, same as SRTS)
    plant           TEXT        NOT NULL DEFAULT '',
    department      TEXT        NOT NULL DEFAULT '',
    zone            TEXT        NOT NULL DEFAULT '',
    area            TEXT        NOT NULL DEFAULT '',

    -- Hazard classification
    hazard_type     TEXT        NOT NULL DEFAULT 'Other',
    severity        TEXT        NOT NULL DEFAULT 'Medium'
                                CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
    description     TEXT        NOT NULL DEFAULT '',

    -- Photo (uploaded to Supabase Storage bucket: hazard-photos)
    photo_url       TEXT        NOT NULL DEFAULT '',

    -- Reporter (optional — anonymous by default)
    reporter_name   TEXT        NOT NULL DEFAULT 'Anonymous',
    assigned_to     TEXT        NOT NULL DEFAULT '',

    -- Lifecycle
    status          TEXT        NOT NULL DEFAULT 'Open'
                                CHECK (status IN ('Open', 'In Progress', 'Resolved')),
    notes           TEXT        NOT NULL DEFAULT '',
    resolved_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.hazard_reports             IS 'One row per employee hazard report submission.';
COMMENT ON COLUMN public.hazard_reports.company_id  IS 'Tenant isolation key — all queries must filter by this.';
COMMENT ON COLUMN public.hazard_reports.severity    IS 'Low / Medium / High / Critical';
COMMENT ON COLUMN public.hazard_reports.status      IS 'Lifecycle: Open → In Progress → Resolved';
COMMENT ON COLUMN public.hazard_reports.photo_url   IS 'Public URL from Supabase Storage bucket: hazard-photos';

-- Indexes for dashboard and real-time queries
CREATE INDEX IF NOT EXISTS idx_hr_company_status
    ON public.hazard_reports (company_id, status);

CREATE INDEX IF NOT EXISTS idx_hr_created_at
    ON public.hazard_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_severity
    ON public.hazard_reports (company_id, severity);


-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.hazard_reports ENABLE ROW LEVEL SECURITY;

-- Anyone (anon) can INSERT a hazard report — floor workers submit without login
CREATE POLICY "anon_insert_hazard_reports"
    ON public.hazard_reports
    FOR INSERT
    TO anon
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies)
    );

-- Anyone (anon) can SELECT — safety dashboard reads without auth
CREATE POLICY "anon_read_hazard_reports"
    ON public.hazard_reports
    FOR SELECT
    TO anon
    USING (true);

-- Anyone (anon) can UPDATE — safety team updates status and notes
CREATE POLICY "anon_update_hazard_reports"
    ON public.hazard_reports
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

-- Anyone (anon) can DELETE — safety team can remove resolved/invalid reports
CREATE POLICY "anon_delete_hazard_reports"
    ON public.hazard_reports
    FOR DELETE
    TO anon
    USING (true);


-- ============================================================
-- 3. SUPABASE STORAGE BUCKET: hazard-photos
--
-- Run this block separately in the SQL editor.
-- Creates a public bucket for hazard photo uploads.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('hazard-photos', 'hazard-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anon to upload photos
CREATE POLICY "anon_upload_hazard_photos"
    ON storage.objects
    FOR INSERT
    TO anon
    WITH CHECK (bucket_id = 'hazard-photos');

-- Public read (photos are accessible via public URL)
CREATE POLICY "public_read_hazard_photos"
    ON storage.objects
    FOR SELECT
    TO anon
    USING (bucket_id = 'hazard-photos');

-- Allow anon to delete (safety team cleanup)
CREATE POLICY "anon_delete_hazard_photos"
    ON storage.objects
    FOR DELETE
    TO anon
    USING (bucket_id = 'hazard-photos');


-- ============================================================
-- 4. VERIFY
-- ============================================================

-- SELECT * FROM public.hazard_reports LIMIT 10;
-- SELECT * FROM storage.buckets WHERE id = 'hazard-photos';
