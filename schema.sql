-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.schools (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  headmaster text,
  npsn text,
  phone text,
  email text,
  logo_url text,
  is_active boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid,
  CONSTRAINT schools_pkey PRIMARY KEY (id),
  CONSTRAINT schools_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.academic_years (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid,
  year text NOT NULL,
  is_active boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT academic_years_pkey PRIMARY KEY (id),
  CONSTRAINT academic_years_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id)
);
CREATE TABLE public.semesters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  academic_year_id uuid,
  name text NOT NULL CHECK (name = ANY (ARRAY['Semester 1'::text, 'Semester 2'::text])),
  is_active boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT semesters_pkey PRIMARY KEY (id),
  CONSTRAINT semesters_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id)
);
CREATE TABLE public.classes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  school_id uuid,
  academic_year_id uuid,
  semester text CHECK (semester = ANY (ARRAY['Semester 1'::text, 'Semester 2'::text])),
  level text CHECK (level = ANY (ARRAY['Kiddy'::text, 'Beginner'::text])),
  jadwal text,
  created_at timestamp with time zone DEFAULT now(),
  semester_id uuid,
  sub_level_id uuid,
  CONSTRAINT classes_pkey PRIMARY KEY (id),
  CONSTRAINT classes_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT classes_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id),
  CONSTRAINT fk_classes_semester FOREIGN KEY (semester_id) REFERENCES public.semesters(id),
  CONSTRAINT classes_sub_level_id_fkey FOREIGN KEY (sub_level_id) REFERENCES public.sub_levels(id)
);
CREATE TABLE public.students (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  class_id uuid,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  school_id uuid,
  grade text,
  is_active boolean DEFAULT true,
  CONSTRAINT students_pkey PRIMARY KEY (id),
  CONSTRAINT fk_students_class_id FOREIGN KEY (class_id) REFERENCES public.classes(id),
  CONSTRAINT fk_students_school_id FOREIGN KEY (school_id) REFERENCES public.schools(id)
);
CREATE TABLE public.teachers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text CHECK (role = ANY (ARRAY['guru'::text, 'asisten'::text])),
  CONSTRAINT teachers_pkey PRIMARY KEY (id)
);
CREATE TABLE public.materi (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  class_id uuid,
  guru_id uuid,
  asisten_id uuid,
  date date,
  description text,
  detail text,
  level text,
  created_at timestamp with time zone DEFAULT now(),
  level_id uuid,
  image_url text,
  sub_level_id uuid,
  order_index integer,
  CONSTRAINT materi_pkey PRIMARY KEY (id),
  CONSTRAINT materi_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES public.teachers(id),
  CONSTRAINT fk_materi_level FOREIGN KEY (level_id) REFERENCES public.levels(id),
  CONSTRAINT materi_sub_level_id_fkey FOREIGN KEY (sub_level_id) REFERENCES public.sub_levels(id)
);
CREATE TABLE public.attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid,
  status text,
  created_at timestamp with time zone DEFAULT now(),
  pertemuan_id uuid,
  sikap text,
  achievement text,
  tanggal date,
  fokus text,
  CONSTRAINT attendance_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT fk_pertemuan FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_kelas(id)
);
CREATE TABLE public.levels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kode text NOT NULL UNIQUE,
  detail text,
  order_index integer,
  CONSTRAINT levels_pkey PRIMARY KEY (id)
);
CREATE TABLE public.pertemuan_kelas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid,
  materi_id uuid,
  guru_id uuid,
  asisten_id uuid,
  class_id uuid,
  tanggal date NOT NULL,
  CONSTRAINT pertemuan_kelas_pkey PRIMARY KEY (id),
  CONSTRAINT pertemuan_kelas_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT pertemuan_kelas_materi_id_fkey FOREIGN KEY (materi_id) REFERENCES public.materi(id),
  CONSTRAINT pertemuan_kelas_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES public.teachers(id),
  CONSTRAINT pertemuan_kelas_asisten_id_fkey FOREIGN KEY (asisten_id) REFERENCES public.teachers(id),
  CONSTRAINT pertemuan_kelas_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id)
);
CREATE TABLE public.group_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text,
  owner text,
  address text,
  created_at timestamp with time zone,
  CONSTRAINT group_private_pkey PRIMARY KEY (id)
);
CREATE TABLE public.materi_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  judul text,
  deskripsi text,
  detail text,
  level text,
  created_at timestamp with time zone DEFAULT now(),
  level_id uuid,
  image_url text,
  sub_level_id uuid,
  order_index integer,
  CONSTRAINT materi_private_pkey PRIMARY KEY (id),
  CONSTRAINT materi_private_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id),
  CONSTRAINT materi_private_sub_level_id_fkey FOREIGN KEY (sub_level_id) REFERENCES public.sub_levels(id)
);
CREATE TABLE public.achievement_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  main_achievement text,
  level text,
  catatan text,
  created_at timestamp with time zone,
  level_id uuid,
  sub_achievement text,
  materi_id uuid,
  sub_level_id uuid,
  CONSTRAINT achievement_private_pkey PRIMARY KEY (id),
  CONSTRAINT achievement_private_materi_id_fkey FOREIGN KEY (materi_id) REFERENCES public.materi_private(id),
  CONSTRAINT achievement_private_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id),
  CONSTRAINT achievement_private_sub_level_id_fkey FOREIGN KEY (sub_level_id) REFERENCES public.sub_levels(id)
);
CREATE TABLE public.class_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid,
  name text,
  level text,
  created_at timestamp with time zone,
  level_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  sub_level_id uuid,
  CONSTRAINT class_private_pkey PRIMARY KEY (id),
  CONSTRAINT fk_class_level FOREIGN KEY (level_id) REFERENCES public.levels(id),
  CONSTRAINT class_private_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group_private(id),
  CONSTRAINT class_private_sub_level_id_fkey FOREIGN KEY (sub_level_id) REFERENCES public.sub_levels(id)
);
CREATE TABLE public.students_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_id uuid,
  name text,
  created_at timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT students_private_pkey PRIMARY KEY (id),
  CONSTRAINT students_private_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class_private(id)
);
CREATE TABLE public.pertemuan_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_id uuid,
  pertemuan_ke integer,
  tanggal date,
  materi_id uuid,
  teacher_id uuid,
  created_at timestamp with time zone,
  jumlah_sesi integer NOT NULL DEFAULT 1 CHECK (jumlah_sesi >= 1),
  CONSTRAINT pertemuan_private_pkey PRIMARY KEY (id),
  CONSTRAINT pertemuan_private_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class_private(id),
  CONSTRAINT pertemuan_private_materi_id_fkey FOREIGN KEY (materi_id) REFERENCES public.materi_private(id),
  CONSTRAINT pertemuan_private_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id)
);
CREATE TABLE public.achievement_target (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pertemuan_id uuid,
  achievement_id uuid,
  catatan text,
  created_at timestamp with time zone,
  CONSTRAINT achievement_target_pkey PRIMARY KEY (id),
  CONSTRAINT achievement_target_pertemuan_id_fkey FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_private(id),
  CONSTRAINT achievement_target_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievement_private(id)
);
CREATE TABLE public.achievement_pertemuan (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pertemuan_id uuid,
  student_id uuid,
  achievement_id uuid,
  indikator integer,
  catatan text,
  created_at timestamp with time zone,
  CONSTRAINT achievement_pertemuan_pkey PRIMARY KEY (id),
  CONSTRAINT achievement_pertemuan_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievement_private(id),
  CONSTRAINT achievement_pertemuan_pertemuan_id_fkey FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_private(id),
  CONSTRAINT achievement_pertemuan_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students_private(id)
);
CREATE TABLE public.attendance_private (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pertemuan_id uuid NOT NULL,
  student_id uuid NOT NULL,
  materi_id uuid,
  sikap integer,
  fokus integer,
  pemahaman integer,
  detail text,
  catatan text,
  CONSTRAINT attendance_private_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_private_pertemuan_id_fkey FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_private(id),
  CONSTRAINT attendance_private_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students_private(id),
  CONSTRAINT attendance_private_materi_id_fkey FOREIGN KEY (materi_id) REFERENCES public.materi_private(id)
);
CREATE TABLE public.achievement_sekolah (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  main_achievement text NOT NULL,
  sub_achievement text NOT NULL,
  level_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  sub_level_id uuid,
  CONSTRAINT achievement_sekolah_pkey PRIMARY KEY (id),
  CONSTRAINT fk_ach_sekolah_level FOREIGN KEY (level_id) REFERENCES public.levels(id),
  CONSTRAINT achievement_sekolah_sub_level_id_fkey FOREIGN KEY (sub_level_id) REFERENCES public.sub_levels(id)
);
CREATE TABLE public.achievement_kelas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pertemuan_id uuid NOT NULL,
  class_id uuid NOT NULL,
  achievement_sekolah_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT achievement_kelas_pkey PRIMARY KEY (id),
  CONSTRAINT fk_pertemuan_kelas FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_kelas(id),
  CONSTRAINT fk_class_target FOREIGN KEY (class_id) REFERENCES public.classes(id),
  CONSTRAINT fk_ach_sekolah FOREIGN KEY (achievement_sekolah_id) REFERENCES public.achievement_sekolah(id)
);
CREATE TABLE public.achievement_siswa (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pertemuan_id uuid NOT NULL,
  class_id uuid NOT NULL,
  achievement_kelas_id uuid NOT NULL,
  student_id uuid NOT NULL,
  score integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT achievement_siswa_pkey PRIMARY KEY (id),
  CONSTRAINT fk_pertemuan_shortcut FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_kelas(id),
  CONSTRAINT fk_kelas_shortcut FOREIGN KEY (class_id) REFERENCES public.classes(id),
  CONSTRAINT fk_target_sesi FOREIGN KEY (achievement_kelas_id) REFERENCES public.achievement_kelas(id),
  CONSTRAINT fk_student_sekolah FOREIGN KEY (student_id) REFERENCES public.students(id)
);
CREATE TABLE public.user_profiles (
  id uuid NOT NULL,
  role text DEFAULT 'student'::user_role,
  is_active boolean DEFAULT true,
  level_id uuid,
  school_id uuid,
  class_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  email text,
  group_id uuid,
  class_private_id uuid,
  name text,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT user_profiles_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id),
  CONSTRAINT user_profiles_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT user_profiles_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id),
  CONSTRAINT user_profiles_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group_private(id),
  CONSTRAINT user_profiles_class_private_id_fkey FOREIGN KEY (class_private_id) REFERENCES public.class_private(id)
);
CREATE TABLE public.app_menus (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  route text NOT NULL,
  category uuid NOT NULL,
  allowed_roles ARRAY,
  allowed_level_ids ARRAY,
  icon_class text DEFAULT 'fa-solid fa-circle'::text,
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT app_menus_pkey PRIMARY KEY (id),
  CONSTRAINT fk_menu_category FOREIGN KEY (category) REFERENCES public.menu_categories(id)
);
CREATE TABLE public.menu_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category_key text NOT NULL UNIQUE,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  target_app text DEFAULT 'admin'::text,
  is_active boolean DEFAULT true,
  CONSTRAINT menu_categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.cloudinary_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  cloud_name text NOT NULL,
  api_key text NOT NULL,
  api_secret text NOT NULL,
  upload_preset text NOT NULL,
  usage_limit_gb numeric DEFAULT 10,
  current_usage_gb numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cloudinary_accounts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.gallery_contents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  pertemuan_id uuid,
  title text,
  description text,
  media_type text DEFAULT 'image'::text,
  file_url text NOT NULL,
  public_id text,
  cloudinary_account_id uuid,
  thumbnail_url text,
  category text,
  is_deleted boolean DEFAULT false,
  class_id uuid,
  caption text DEFAULT ''::text,
  is_published boolean DEFAULT false,
  pertemuan_private_id uuid,
  CONSTRAINT gallery_contents_pkey PRIMARY KEY (id),
  CONSTRAINT fk_gallery_pertemuan FOREIGN KEY (pertemuan_id) REFERENCES public.pertemuan_kelas(id),
  CONSTRAINT fk_gallery_account FOREIGN KEY (cloudinary_account_id) REFERENCES public.cloudinary_accounts(id),
  CONSTRAINT gallery_contents_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id),
  CONSTRAINT fk_gallery_pertemuan_private FOREIGN KEY (pertemuan_private_id) REFERENCES public.pertemuan_private(id)
);
CREATE TABLE public.activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  activity_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT activity_logs_pkey PRIMARY KEY (id),
  CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.sub_levels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL,
  kode text NOT NULL,
  name text NOT NULL,
  kit_alat text,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  order_index integer,
  CONSTRAINT sub_levels_pkey PRIMARY KEY (id),
  CONSTRAINT sub_levels_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id)
);
CREATE TABLE public.billing_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'prepaid'::text CHECK (mode = ANY (ARRAY['prepaid'::text, 'postpaid'::text])),
  periode_label text,
  start_date date NOT NULL,
  end_date date,
  quota_sessions integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'aktif'::text CHECK (status = ANY (ARRAY['aktif'::text, 'selesai'::text])),
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT billing_periods_pkey PRIMARY KEY (id),
  CONSTRAINT billing_periods_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group_private(id)
);
CREATE TABLE public.billing_periods_sekolah (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  class_id uuid NOT NULL,
  periode_label text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  contract_price numeric NOT NULL CHECK (contract_price >= 0::numeric),
  contract_sessions integer NOT NULL DEFAULT 4 CHECK (contract_sessions >= 1),
  status text NOT NULL DEFAULT 'aktif'::text CHECK (status = ANY (ARRAY['aktif'::text, 'selesai'::text])),
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT billing_periods_sekolah_pkey PRIMARY KEY (id),
  CONSTRAINT billing_periods_sekolah_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT billing_periods_sekolah_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id)
);
CREATE TABLE public.invoices_sekolah (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL UNIQUE,
  school_id uuid NOT NULL,
  class_id uuid NOT NULL,
  periode_label text,
  jumlah_anak integer NOT NULL,
  jumlah_pertemuan integer NOT NULL,
  price_per_session numeric NOT NULL,
  total numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invoices_sekolah_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_sekolah_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.billing_periods_sekolah(id),
  CONSTRAINT invoices_sekolah_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT invoices_sekolah_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id)
);