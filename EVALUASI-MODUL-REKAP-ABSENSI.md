# Evaluasi Audit Modul Rekap Absensi — Fokus Bagian Private

> Objek: `modules/rekap-absensi-module.js` (933 baris, READ-ONLY) + skema & data Supabase.
> Metode: telaah kode lengkap (state, scope, fetch, render) + verifikasi lintas modul (Gallery & Kurikulum sebagai acuan) + telaah `schema.sql` & `LAPORAN-DATABASE-SUPABASE.md`.
> Tanggal audit: 2026-09-10

## 1. Ringkasan Modul

- Modul mandiri (tab navbar `rekap-absensi-module`), menampilkan laporan **read-only** absensi & materi per kelas.
- Dua konteks: **Sekolah** (`classes`/`students`/`pertemuan_kelas`/`attendance`) dan **Private** (`class_private`/`students_private`/`pertemuan_private`/`attendance_private`).
- Konteks private **tidak terikat semester/tahun ajaran**; daftar sesi & materi urut **terbaru dulu**.
- `attendance_private` **tidak punya kolom `status`** → kehadiran diturunkan dari ada/tidaknya data penilaian (sikap/fokus/pemahaman/detail).

## 2. Kekuatan

1. `escapeHtml` dipakai menyeluruh untuk data dari DB → higiene XSS baik.
2. Pemetaan awal konteks (`init`) disamakan dengan Gallery Module (privileged → `school`; role lain → `private` hanya bila `class_private_id` tanpa `class_id`).
3. Jalur student terkunci ke kelas miliknya + auto-load laporan (`isiDropdownKelasStudent`).
4. Semua daftar sesi/materi private dijamin terurut menurun di sisi klien.
5. Query join memakai bentuk `!inner` pada `pertemuan` sehingga baris `attendance_private` tidak bertabrakan lintas kelas.

## 3. Peta Proses Private (alur kode)

```
init(canvas, profile)
  └─ activeCtx = 'school' (privileged) atau 'private' (class_private_id tanpa class_id)
  └─ renderLayout → renderContextSwitcher (via canSeeContext)
        canSeeContext('private') = super_admin|teacher || class_private_id
  └─ loadInitialTermsAndClasses -> isiDropdownKelas()
        student              → isiDropdownKelasStudent()  (terkunci ke class_private_id, auto-load)
        ctx private & staff  → isiDropdownKelasPrivate()  (SEMUA kelas, PIC dibatasi group_id)
  └─ handleLoadRekap → fetchPrivateData()
  └─ renderAbsensiWorksheet / renderMateriTable
```

## 4. Temuan — KRITIS (Privasi/Keamanan)

### S1 — Tidak ada proteksi level database untuk data private (ROOT CAUSE)

| Buruk di sisi | Kode/Data |
|---|---|
| `schema.sql` TIDAK berisi `ALTER TABLE … ENABLE ROW LEVEL SECURITY` maupun `CREATE POLICY` untuk **satupun** tabel private. | `schema.sql` (tabel private 129–244) |
| `LAPORAN-DATABASE-SUPABASE.md §2` mengonfirmasi `class_private`, `students_private`, `pertemuan_private`, `attendance_private`, bahkan `user_profiles` (berisi email & role semua user) **terbaca oleh klien anonim** lewat REST. Hanya `schools` & `menu_categories/app_menus` tertutup RLS. | `LAPORAN-DATABASE-SUPABASE.md` baris 25–38 |
| `config.js` menyimpan **key publishable** (anon) hardcoded di bundle klien. | `assets/js/config.js:5` |

**Dampak:** "Privasi" bagian rekap private saat ini **hanya penyembunyian UI**. Siapa pun — bahkan tanpa login — dapat memanggil mis. `GET /rest/v1/attendance_private?select=*`, `…/students_private?select=*`, dan membaca nama siswa, jadwal, materi, serta nilai sikap/fokus/pemahaman seluruh pengguna, karena filter scope di client tidak pernah sampai ke server.

**Arah perbaikan (di Supabase, bukan hanya kode):**
```sql
ALTER TABLE public.class_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pertemuan_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
-- policy SELECT berbasis keanggotaan class (sesuaikan aturan bisnis; admin/super_admin full)
```
Baris `user_profiles` sebaiknya dibatasi `select … where id = auth.uid()`.
### S2 — Teacher melihat SEMUA kelas private (scope tidak difilter)

- Rekap: `isiDropdownKelasPrivate()` hanya memfilter **PIC via `group_id`**; teacher & super_admin memuat **semua** `class_private` tanpa syarat. → `rekap-absensi-module.js:344-346`
- **Gallery** — acuan yang diklaim "disamakan persis": pada konteks private, teacher dengan `level_id` difilter `query.eq('level_id', userProfile.level_id)`. → `gallery-module.js:137-148`
- **Kurikulum** juga membatasi teacher (Terapi Wicara → privat saja, Kiddy/Beginner → sekolah saja). → `kurikulum-module.js:339-357`

**Dampak:** guru mana pun dapat melihat rekap, nama siswa, dan nilai **seluruh kelas private lintas family**, bukan hanya kelas yang menjadi tanggung jawab/tingkatnya. Rekap lebih longgar daripada modul lain yang sama-sama dipakai.

**Aksi:** terapkan pemfilteran yang sama dengan Gallery di `isiDropdownKelasPrivate()` (minimal `level_id`).

### S3 — Statistik "Rata-rata Hadir" selalu 100% di private (dan bias di sekolah)

- `fetchPrivateData()` memetakan `attendance_private` → `status = '1' (ada penilaian)` atau `null` (belum ada penilaian). → `rekap-absensi-module.js:549-555`
- `updateStatsBadges()` hanya menghitung record dengan `a.status !== null && a.status !== 0 && a.status !== '0'` → yang dihitung **hanya baris '1'**, sehingga `totalPresent == totalRecords` → **badge "Rata-rata Hadir" selalu 100% pada mode private**. → `rekap-absensi-module.js:582-592`
- Untuk konteks sekolah, baris `status='0'` (tidak hadir) **keluar dari denominator** → rata-rata cenderung overestimate.
- Tabel worksheet memakai definisi berbeda (`String(rec.status) === '1'` per sesi) → angka badge header **tidak sinkron** dengan tabel. → `rekap-absensi-module.js:658-667`

**Aksi:** untuk private, ganti badge "Rata-rata Hadir" dengan **"Sesi Dinilai"** (mis. `Sesi Dinilai: 3/8`) karena konsep "alpa" memang tidak ada; untuk sekolah, masukkan `'0'` ke denominator agar angka rata-rata akurat (tidak overestimate).

## 5. Temuan Lain (P1/P2)

| ID | Temuan | Bukti | Prioritas |
|---|---|---|---|
| **F1** | Di private tidak ada indikasi `pertemuan_ke`/`jumlah_sesi` meski tersedia di DB `pertemuan_private`; tabel hanya menandai "Sesi N" dari urutan tanggal. | `fetchPrivateData` tidak select kolom itu | Sedang |
| **F2** | Label pseudo-"sekolah" di rekap private memakai `group_private.owner` (nama pengelola) — ikut bocor bila RLS belum aktif (lihat S1). | `rekap:360` | Rendah (menyatu dengan S1) |
| **F3** | `restoreLastFilter()` menyimpan `classId` localStorage lintas konteks; aman karena dicek `hasOption`. | Kode sudah benar | — |
| **F4** | Tanpa export/cetak, sesuai desain read-only; rentang sesi & statistik sudah membantu. | Fitur desain | — |

## 6. Kesimpulan

Fondasi UI/UX modul sudah rapi, konsisten dengan modul lain, dan XSS-safe. Namun **bagian "Private" saat ini tidak benar-benar privat**:

1. **Masalah terbesar di sisi database** — tabel berisi data pribadi (nama siswa & penilaian private) dapat diambil oleh klien anonim karena tidak ada RLS/policy. Ini **meniadakan semua proteksi yang dilakukan di UI**. Perbaikan wajib dilakukan di Supabase (RLS), bukan hanya JavaScript.
2. **Scope teacher di modul ini lebih luas daripada Gallery/Kurikulum** — perlu disejajarkan (filter `level_id`).
3. **Angka statistik private menyesatkan** (selalu 100%) dan tidak konsisten dengan tabel.

> Prioritas: (1) RLS + filter `auth.uid()` di Supabase, (2) samakan scope teacher di `isiDropdownKelasPrivate()`, (3) perbaiki statistik private, (4) tampilkan `pertemuan_ke` sesuai kebijakan produk.
## 7. Log Perbaikan

| Tanggal | Perbaikan | File |
|---|---|---|
| 2026-09-10 | **Bug embed ambigu** — perbaikan akhir: `attendance_private` ditarik **tanpa embed join** lalu disaring manual per kelas via `pertemuan_id` (Solusi hint nama constraint di baris 534 gagal karena nama constraint di live DB tidak dikenali PostgREST "_Could not find a relationship_"). Nama siswa dibangun dari map `students_private` (termasuk non-aktif). | `rekap-absensi-module.js:530-574` |
| 2026-09-10 | **Bump `APP_VERSION` 7.6 → 7.7** — error "Could not find a relationship" masih muncul karena browser mengeksekusi modul lama dari cache (`import(...?v=7.6)`). Tanpa bump versi, perbaikan modul tidak pernah dimuat. | `assets/js/index.js:29` |
| 2026-09-10 | **Billing cycle di Rekap (v2.3)** — sesuai pilihan: dropdown **"Siklus"** (dari `billing_periods` private per `group_id` / `billing_periods_sekolah` per `class_id`) + **section/kelompok "Siklus N"** di tab Absensi (baris header colspan) dan tab Materi (baris judul grup). Sesi dipetakan ke siklus secara kronologis (tanggal naik, `quota_sessions`/`contract_sessions` per siklus). `APP_VERSION` → 7.8. | `rekap-absensi-module.js` (state, `fetchBillingPeriods`/`buildPeriodMap`/`populatePeriodFilter`/`buildPeriodGroups`), `assets/js/index.js:29` |

Catatan: skema billing sudah dicek live ke Supabase (`billing_periods`: 7+ baris; `billing_periods_sekolah`: 1 baris). `pertemuan_ke` NULL → pengelompokan memakai urutan tanggal + kuota sesi per periode.

Migration opsional di database live (agar relasi bersih, tanpa mengubah query kode):
```sql
ALTER TABLE public.attendance_private DROP CONSTRAINT fk_pertemuan;
ALTER TABLE public.attendance_private DROP CONSTRAINT fk_student;
```
(Query modul tetap memakai hint `attendance_private_pertemuan_id_fkey` / `attendance_private_student_id_fkey`, jadi tetap aman baik sebelum maupun sesudah migrasi.