/**
 * Project: Robopanda Client (Public/Student)
 * File: modules/rekap-absensi-module.js
 * Version: 2.5 - Private = gabungan per GROUP (semua kelas group digabungan)
 *
 * Description:
 *  Laporan absensi & materi/silabus terajarkan per kelas, mengikuti
 *  semester & tahun ajaran aktif. Kini berdiri sendiri sebagai tab navbar
 *  (dimuat via loadModule), tidak lagi dibuka dari dalam Gallery Module.
 *
 *  v2.2: Mapping user-role disamakan persis dengan Gallery Module:
 *    - privileged (super_admin/teacher/pic) -> default konteks 'school'
 *    - role lain -> 'private' hanya jika punya class_private_id tanpa class_id
 *    - student: dropdown kelas & semester disembunyikan, langsung terkunci
 *      ke kelas miliknya (class_id / class_private_id) + auto-load laporan.
 *    - Kompatibilitas pemanggil: init(canvas, userProfile) ATAU
 *      init(canvas, { userProfile, onBack, initialClassId }).
 *  v2.1: Switcher konteks Sekolah | Private (mirip Gallery Module).
 *  - Private memakai tabel: class_private, students_private, pertemuan_private,
 *    materi_private, attendance_private (tanpa kolom `status` -> kehadiran
 *    diturunkan dari adanya data penilaian: sikap/fokus/pemahaman/detail).
 *  - Private tidak terikat Semester/Tahun Ajaran (filter periode disembunyikan).
 *  - Semua daftar sesi & materi diurutkan TERBARU DULU (descending).

 *
 * Catatan: Hanya menampilkan data sesuai yang ada di database (read-only).
 *  Tidak ada agregasi/ringkasan, tidak ada fitur export/cetak.
 */

import { supabase } from '../assets/js/config.js';
import { escapeHtml } from '../assets/js/utils.js';

// Client Supabase singleton dibagikan dari config.js

// [UX] Kunci penyimpanan pilihan filter terakhir,
// agar tidak perlu memilih ulang Tahun Ajaran -> Semester -> Kelas setiap buka modul.
const RK_LAST_FILTER_KEY = 'rekap_absensi_last_filter';

// ---------------------------------------------------------------
// ---------------------------------------------------------------
// STATE
// ---------------------------------------------------------------
let app = {
    userProfile: null,      // profil dari user_profiles (role mapping)
    activeCtx: 'school',    // konteks laporan aktif: 'school' | 'private'
    onBack: null,           // callback kembali (opsional; default ke Beranda)
    initialClassId: null,   // kelas awal yang diteruskan pemanggil jika ada
    activeClass: null,      // { id, name, jadwal, level, schoolName }
    students: [],           // [{ id, name, grade }] siswa kelas aktif
    pertemuanList: [],      // [{ id, tanggal, judul, uraian }] urut ascending
    attendance: [],         // baris attendance (semua pertemuan) untuk kelas ini
    activeTab: 'absensi',   // tab yang sedang tampil ('absensi' | 'materi')
    periods: [],            // [{ id, label, start_date, quota, status, pakai, sisa, habis, overflow }]
    periodMap: {},          // pertemuan_id -> index di app.periods; -1 = tidak berperiode
    periodFilter: null,     // null = 'Semua'; index periode / -1 = filter siklus aktif
    periodAlloc: {},        // [private] pertemuan_id -> { periodIdx } alokasi global grup
    periodAllocDone: false, // [private] alokasi global grup siap
    privateClassMap: new Map() // [private] student_id -> className (gabungan per GROUP)
};

// ---------------------------------------------------------------
// 0. KONTEKS LAPORAN: SEKOLAH | PRIVATE (meniru Gallery Module)
// ---------------------------------------------------------------
function canSeeContext(ctx) {
    const role = app.userProfile?.role;
    if (ctx === 'school') {
        return ['super_admin', 'teacher', 'pic'].includes(role) || !!app.userProfile?.class_id;
    }
    // private: hanya guru/admin, atau user yang terdaftar di kelas private
    return ['super_admin', 'teacher'].includes(role) || !!app.userProfile?.class_private_id;
}

function renderContextSwitcher() {
    const showSchool = canSeeContext('school');
    const showPrivate = canSeeContext('private');
    if (!showSchool && !showPrivate) return ''; // tamu/siswa tanpa akses -> tanpa switcher

    const btn = (ctx, icon, label) =>
        `<button type="button" class="rk-ctx-btn ${app.activeCtx === ctx ? 'active' : ''}" id="rk-ctx-${ctx}" data-ctx="${ctx}">
            <i class="fa-solid ${icon}"></i> ${label}
        </button>`;

    return `<div class="rk-ctx-bar" id="rk-ctx-bar" role="tablist" aria-label="Konteks Laporan">
        ${showSchool ? btn('school', 'fa-school', 'Sekolah') : ''}
        ${showPrivate ? btn('private', 'fa-house-chimney-user', 'Private') : ''}
    </div>`;
}

// Visibilitas filter mengikuti Gallery Module:
// - Student: SEMUA filter disembunyikan (kelas terkunci ke miliknya, auto-load).
// - Konteks private: Tahun Ajaran/Semester disembunyikan (kelas private
//   tidak terikat semester).
function updateFilterVisibility() {
    const isStudent = app.userProfile?.role === 'student';
    const pf = document.getElementById('rk-period-field');
    const cf = document.getElementById('rk-class-field');
    if (pf) pf.style.display = (app.activeCtx === 'private' || isStudent) ? 'none' : '';
    if (cf) cf.style.display = isStudent ? 'none' : '';

    // Label dinamik: Private = per GROUP (gabungan), Sekolah = per Kelas
    const label = document.querySelector('#rk-class-field label');
    if (label) {
        label.innerHTML = (app.activeCtx === 'private')
            ? '<i class="fa-solid fa-users"></i> Pilih Group'
            : '<i class="fa-solid fa-chalkboard-user"></i> Pilih Kelas';
    }
}

async function switchContext(ctx) {
    if (!canSeeContext(ctx) || app.activeCtx === ctx) return;
    app.activeCtx = ctx;

    document.querySelectorAll('.rk-ctx-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.ctx === ctx));
    updateFilterVisibility();

    const termLabel = document.getElementById('rk-active-term-label');
    if (termLabel) {
        if (ctx === 'private') termLabel.textContent = 'Program Private';
        else if (termLabel.dataset.schoolTerm) termLabel.textContent = termLabel.dataset.schoolTerm;
    }

    hideReport();
    await isiDropdownKelas();
}

// ---------------------------------------------------------------
// 1. INITIALIZATION
// ---------------------------------------------------------------
export async function init(canvas, opts = {}) {
    // [MAPPING GALLERY] index.js memanggil module.init(contentArea, userProfile)
    // dengan objek profil LANGSUNG (bukan dibungkus properti). Pemanggil lama
    // mungkin masih mengirim { userProfile, onBack, initialClassId } -> dukung
    // kedua bentuk agar mapping user tidak gagal (bug v2.1: selalu kebaca guest).
    const profile = (opts && opts.userProfile !== undefined) ? opts.userProfile : opts;
    app.userProfile = (profile && typeof profile.role === 'string') ? profile : { role: 'guest' };
    app.onBack = opts.onBack || null;
    app.initialClassId = opts.initialClassId || null;
    app.activeClass = null;
    app.pertemuanList = [];
    app.activeTab = 'absensi';
    app.periods = [];
    app.periodMap = {};
    app.periodFilter = null;
    app.periodAlloc = {};
    app.periodAllocDone = false;
    app.privateClassMap = new Map();

    // [MAPPING GALLERY] Konteks awal persis seperti Gallery Module:
    // - privileged (super_admin/teacher/pic) -> selalu 'school'
    // - role lain -> 'private' hanya bila punya class_private_id tanpa class_id
    const privilegedRoles = ['super_admin', 'teacher', 'pic'];
    if (privilegedRoles.includes(app.userProfile.role)) {
        app.activeCtx = 'school';
    } else {
        app.activeCtx = (app.userProfile.class_private_id && !app.userProfile.class_id) ? 'private' : 'school';
    }

    injectStyles();

    canvas.innerHTML = `
        <div class="rk-container">
            <div class="rk-top">
                <div class="rk-title-area">
                    <h2>📋 Rekap Absensi & Materi</h2>
                    <span class="rk-active-term-badge" id="rk-active-term-label">Memuat Semester...</span>
                </div>
                <button id="rk-back" class="rk-btn rk-btn-ghost"><i class="fa-solid fa-arrow-left"></i> Beranda</button>
            </div>

            <!-- Filter Cepat: Langsung Pilih Kelas (Semester Aktif Terpilih Otomatis) -->
            <section class="rk-card rk-search">
                ${renderContextSwitcher()}
                <div class="rk-filter-row">
                    <div class="rk-field rk-field-class" id="rk-class-field">
                        <label><i class="fa-solid fa-chalkboard-user"></i> Pilih Kelas</label>
                        <select id="rk-class" class="rk-input">
                            <option value="" disabled selected>Memuat daftar kelas...</option>
                        </select>
                    </div>
                    <div class="rk-field rk-field-period-toggle" id="rk-period-field">
                        <label><i class="fa-solid fa-calendar-days"></i> Semester</label>
                        <div class="rk-period-box">
                            <select id="rk-semester" class="rk-input-period"></select>
                            <select id="rk-year" class="rk-input-period" style="display:none;"></select>
                            <button id="rk-toggle-all-years" class="rk-btn-link" title="Ganti Tahun Ajaran">Ubah TA</button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Ringkasan & Header Laporan -->
            <div class="rk-card rk-report-header" id="rk-report-header" style="display:none;">
                <div class="rk-header-main">
                    <div>
                        <h2 id="rk-school" class="rk-school-title">-</h2>
                        <div class="rk-meta" id="rk-meta-class"></div>
                        <div class="rk-meta-sub" id="rk-meta-year"></div>
                    </div>
                    <div class="rk-stats-badges" id="rk-stats-badges"></div>
                </div>
            </div>

            <!-- Kontrol Tab & Rentang Pertemuan -->
            <div class="rk-card rk-control" id="rk-control" style="display:none;">
                <div class="rk-tabs">
                    <button class="rk-tab active" id="rk-tab-absensi"><i class="fa-solid fa-clipboard-check"></i> Absensi</button>
                    <button class="rk-tab" id="rk-tab-materi"><i class="fa-solid fa-book-open"></i> Silabus / Materi Terajarkan</button>
                </div>
                <div class="rk-range">
                    <label><i class="fa-solid fa-sliders"></i> Rentang Sesi:</label>
                    <select id="rk-range-start" class="rk-input-mini"></select>
                    <span>s/d</span>
                    <select id="rk-range-end" class="rk-input-mini"></select>
                </div>
                <div class="rk-range" id="rk-period-row" style="display:none;">
                    <label><i class="fa-solid fa-route"></i> Siklus:</label>
                    <select id="rk-period" class="rk-input-mini"></select>
                    <span class="rk-period-note" id="rk-period-note"></span>
                </div>
            </div>

            <!-- Bagian Tabel Laporan (Hanya Absensi & Materi) -->
            <section class="rk-section" id="rk-section-absensi" style="display:none;">
                <div id="rk-wrap-absensi" class="rk-table-wrapper">
                    <table class="rk-table" id="rk-table-absensi"></table>
                </div>
            </section>
            <section class="rk-section" id="rk-section-materi" style="display:none;">
                <div id="rk-wrap-materi" class="rk-table-wrapper">
                    <table class="rk-table" id="rk-table-materi"></table>
                </div>
            </section>
        </div>`;

    setupEvents();
    await loadInitialTermsAndClasses();
}

// ---------------------------------------------------------------
// 2. SMART DATA LOADING (Auto-Active Term -> Fast Class List)
// ---------------------------------------------------------------
async function loadInitialTermsAndClasses() {
    // Mode Private: tidak terikat Tahun Ajaran/Semester -> langsung daftar kelas private
    if (app.activeCtx === 'private') {
        updateFilterVisibility();
        const termLabel = document.getElementById('rk-active-term-label');
        if (termLabel) termLabel.textContent = 'Program Private';
        await isiDropdownKelas();
        if (app.userProfile.role !== 'student') await restoreLastFilter();
        return;
    }

    try {
        // 1. Ambil Tahun Ajaran
        const { data: years, error: yErr } = await supabase
            .from('academic_years')
            .select('id, year, is_active')
            .order('year', { ascending: false });

        if (yErr) throw yErr;

        const selYear = document.getElementById('rk-year');
        selYear.innerHTML = (years || []).map(y =>
            `<option value="${y.id}" ${y.is_active ? 'selected' : ''}>${escapeHtml(y.year)}${y.is_active ? ' (Aktif)' : ''}</option>`
        ).join('');

        // Cari tahun aktif (atau tahun pertama)
        const activeYear = (years || []).find(y => y.is_active) || years?.[0];
        if (!activeYear) return;

        // 2. Ambil Semester di tahun tersebut
        const { data: semesters, error: sErr } = await supabase
            .from('semesters')
            .select('id, name, is_active, academic_year_id')
            .eq('academic_year_id', activeYear.id)
            .order('name');

        if (sErr) throw sErr;

        const selSem = document.getElementById('rk-semester');
        selSem.innerHTML = (semesters || []).map(s =>
            `<option value="${s.id}" ${s.is_active ? 'selected' : ''}>${escapeHtml(s.name)}${s.is_active ? ' (Aktif)' : ''}</option>`
        ).join('');

        const activeSemester = (semesters || []).find(s => s.is_active) || semesters?.[0];

        // Tampilkan badge semester aktif di header
        const termLabel = document.getElementById('rk-active-term-label');
        if (termLabel) {
            termLabel.textContent = `${activeYear.year} • ${activeSemester ? activeSemester.name : 'Semester'}`;
            termLabel.dataset.schoolTerm = termLabel.textContent; // dipulihkan saat kembali dari konteks Private
        }

        // 3. Langsung isi daftar kelas untuk semester ini
        updateFilterVisibility();
        await isiDropdownKelas();

        // Student sudah auto-load ke kelasnya sendiri (tidak ada pilihan lain)
        if (app.userProfile.role === 'student') return;

        // 4. Jika ada initialClassId dari Galeri atau tersimpan di localStorage, buka langsung
        if (app.initialClassId && hasOption(document.getElementById('rk-class'), app.initialClassId)) {
            document.getElementById('rk-class').value = app.initialClassId;
            await handleLoadRekap();
        } else {
            await restoreLastFilter();
        }

    } catch (err) {
        console.error("Gagal inisialisasi filter rekap:", err);
        alert('Gagal memuat filter rekap: ' + err.message);
    }
}

async function isiDropdownKelas() {
    // [MAPPING GALLERY] Student tidak memilih kelas: langsung terkunci ke kelas
    // miliknya sesuai konteks aktif (Gallery menyembunyikan filter lalu memakai
    // userProfile.class_id / userProfile.class_private_id + auto-load).
    if (app.userProfile.role === 'student') return isiDropdownKelasStudent();

    if (app.activeCtx === 'private') return isiDropdownKelasPrivate();

    const sid = document.getElementById('rk-semester').value;
    const selClass = document.getElementById('rk-class');
    selClass.innerHTML = '<option value="" disabled selected>-- Pilih Kelas --</option>';

    if (!sid) return;

    let query = supabase
        .from('classes')
        .select('id, name, jadwal, level, schools(name)')
        .eq('semester_id', sid)
        .order('name');

    if (app.userProfile.role === 'pic' && app.userProfile.school_id) {
        query = query.eq('school_id', app.userProfile.school_id);
    }

    const { data, error } = await query;
    if (error) return alert('Gagal memuat kelas: ' + error.message);

    if (!data || data.length === 0) {
        selClass.innerHTML = '<option value="" disabled selected>Tidak ada kelas di semester ini</option>';
        hideReport();
        return;
    }

    selClass.innerHTML = '<option value="" disabled selected>-- Pilih Kelas --</option>' +
        data.map(c =>
            `<option value="${c.id}" data-name="${escapeHtml(c.name)}" data-jadwal="${escapeHtml(c.jadwal || '')}" data-level="${escapeHtml(c.level || '')}" data-school="${escapeHtml(c.schools?.name || '')}">
                ${escapeHtml(c.name)}${c.schools?.name ? ' (' + escapeHtml(c.schools.name) + ')' : ''}
            </option>`
        ).join('');

    hideReport();
}

// [GROUP MODE] Konteks Private = gabungan per GROUP (jangan per kelas).
// List hanya group yang masih punya minimal satu KELAS AKTIF (mirip Billing).
async function isiDropdownKelasPrivate() {
    const selClass = document.getElementById('rk-class');
    selClass.innerHTML = '<option value="" disabled selected>Memuat daftar group...</option>';

    const [rGroups, rClasses] = await Promise.all([
        supabase.from('group_private').select('id, code, owner').order('owner'),
        supabase.from('class_private').select('group_id, is_active')
    ]);
    if (rGroups.error) return alert('Gagal memuat group private: ' + rGroups.error.message);
    if (rClasses.error) return alert('Gagal memuat kelas private: ' + rClasses.error.message);

    const withActiveClass = new Set(
        (rClasses.data || []).filter(c => c.is_active).map(c => c.group_id)
    );
    let groups = (rGroups.data || []).filter(g => withActiveClass.has(g.id));

    // PIC hanya melihat group milik sendiri (guard keamanan)
    if (app.userProfile.role === 'pic' && app.userProfile.group_id) {
        groups = groups.filter(g => g.id === app.userProfile.group_id);
    }

    if (!groups.length) {
        selClass.innerHTML = '<option value="" disabled selected>Tidak ada group dengan kelas aktif</option>';
        hideReport();
        return;
    }

    selClass.innerHTML = '<option value="" disabled selected>-- Pilih Group --</option>' +
        groups.map(g =>
            `<option value="${g.id}" data-name="${escapeHtml(g.code || g.owner || 'Group')}" data-jadwal="" data-level="" data-school="${escapeHtml(g.owner || '')}" data-group="${escapeHtml(g.id)}">
                ${escapeHtml(g.code || g.owner || 'Group')}${g.owner ? ' (' + escapeHtml(g.owner) + ')' : ''}
            </option>`
        ).join('');

    hideReport();
}

// [MAPPING GALLERY] Path student: kunci ke kelas milik profil & auto-load laporan.
async function isiDropdownKelasStudent() {
    const selClass = document.getElementById('rk-class');
    const ctx = app.activeCtx;
    const cid = (ctx === 'school') ? app.userProfile.class_id : app.userProfile.class_private_id;

    if (!cid) {
        selClass.innerHTML = '<option value="" disabled selected>Anda belum terdaftar di kelas</option>';
        hideReport();
        return;
    }

    // Ambil detail kelas untuk label header laporan
    let opt = null;
    if (ctx === 'school') {
        const { data } = await supabase.from('classes')
            .select('id, name, jadwal, level, schools(name)').eq('id', cid).maybeSingle();
        if (data) opt = {
            id: data.id, name: data.name || '', jadwal: data.jadwal || '',
            level: data.level || '', school: data.schools?.name || '',
            label: `${data.name || '(tanpa nama)'}${data.schools?.name ? ' (' + data.schools.name + ')' : ''}`
        };
    } else {
        // [GROUP MODE] Student private -> resolve group milik kelasnya, laporan gabung per group
        const { data } = await supabase.from('class_private')
            .select('id, name, level, group_id, is_active, group_private:group_id(owner, code)').eq('id', cid).maybeSingle();
        if (data && data.is_active === false) {
            // [HIDE] Kelas tidak aktif -> jangan tampil laporan group (privasi + konsistensi)
            selClass.innerHTML = '<option value="" disabled selected>Kelas Anda tidak aktif</option>';
            hideReport();
            return;
        }
        if (data) opt = {
            id: data.group_id || data.id,
            name: data.group_private?.code || data.group_private?.owner || data.name || '',
            jadwal: '',
            level: data.level || '',
            school: data.group_private?.owner || '',
            group_id: data.group_id || '',
            label: `${data.group_private?.code || data.group_private?.owner || data.name || '(tanpa nama)'}`
        };
    }

    if (!opt) {
        selClass.innerHTML = '<option value="" disabled selected>Kelas tidak ditemukan</option>';
        hideReport();
        return;
    }

    selClass.innerHTML = `<option value="${opt.id}" selected data-name="${escapeHtml(opt.name)}" data-jadwal="${escapeHtml(opt.jadwal)}" data-level="${escapeHtml(opt.level)}" data-school="${escapeHtml(opt.school)}">${escapeHtml(opt.label)}</option>`;
    await handleLoadRekap();
}

// ---------------------------------------------------------------
// 2b. REMEMBER FILTER & AUTO RESTORE
// ---------------------------------------------------------------
function saveLastFilter() {
    try {
        localStorage.setItem(RK_LAST_FILTER_KEY, JSON.stringify({
            ctx: app.activeCtx,
            yearId: document.getElementById('rk-year')?.value || '',
            semesterId: document.getElementById('rk-semester')?.value || '',
            classId: document.getElementById('rk-class')?.value || ''
        }));
    } catch (_) { }
}

function hasOption(sel, value) {
    return Array.from(sel.options).some(o => o.value === value);
}

async function restoreLastFilter() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RK_LAST_FILTER_KEY) || 'null'); } catch (_) { saved = null; }
    if (!saved) return;

    // Pulihkan konteks Sekolah/Private terakhir (jika role masih berhak melihatnya)
    if (saved.ctx && saved.ctx !== app.activeCtx && canSeeContext(saved.ctx)) {
        await switchContext(saved.ctx);
    }

    const selClass = document.getElementById('rk-class');
    if (saved.classId && hasOption(selClass, saved.classId)) {
        selClass.value = saved.classId;
        await handleLoadRekap();
    }
}

// ---------------------------------------------------------------
// 3. LOAD REKAP DATA
// ---------------------------------------------------------------
async function handleLoadRekap() {
    const selClass = document.getElementById('rk-class');
    const cls = selClass.value;
    if (!cls) return;

    const opt = selClass.selectedOptions[0];
    app.activeClass = {
        id: cls,
        name: opt.dataset.name || '',
        jadwal: opt.dataset.jadwal || '',
        level: opt.dataset.level || '',
        schoolName: opt.dataset.school || '',
        group_id: opt.dataset.group || (app.activeCtx === 'private' ? cls : '')   // Private: id = group_id
    };
    app.periodFilter = null;
    app.periodAlloc = {};
    app.periodAllocDone = false;

    fillReportHeader();
    document.getElementById('rk-range-start').innerHTML = '<option value="-1">Memuat...</option>';
    document.getElementById('rk-range-end').innerHTML = '<option value="-1">Memuat...</option>';
    
    if (!(await loadClassData())) return;
    saveLastFilter();

    app.activeTab = 'absensi';
    showSection('rk-section-absensi');
    updateActiveBtn('rk-tab-absensi');
    renderAbsensiWorksheet();
}

async function loadClassData() {
    const ok = (app.activeCtx === 'private') ? await fetchPrivateData() : await fetchSchoolData();
    if (!ok) return false;

    // Gabungkan siswa yang tercatat di absensi tapi belum ada di list aktif
    const seen = new Map(app.students.map(s => [s.id, s]));
    app.attendance.forEach(r => {
        if (r.student && !seen.has(r.student_id)) {
            seen.set(r.student_id, { id: r.student_id, name: r.student.name || '', grade: r.student.grade || '' });
        }
    });
    app.students = [...seen.values()].sort((a, b) =>
        String(a.grade || '').localeCompare(String(b.grade || '')) ||
        String(a.name).localeCompare(String(b.name))
    );

    // [GROUP MODE] Private: siswa yang dimerge dari absensi (non-aktif) juga dapat class tag
    if (app.activeCtx === 'private' && app.privateClassMap) {
        app.students.forEach(s => {
            s.className = s.className || app.privateClassMap.get(s.id) || '';
        });
    }

    // [URUTAN TANGGAL] Wajib terbaru dulu (descending).
    // Dijamin ulang di sisi client agar konsisten apapun hasil ordering DB.
    app.pertemuanList.sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));

    // [BILLING CYCLE] Muat siklus billing kelas aktif, petakan sesi -> siklus,
    // lalu isi dropdown filter "Siklus" (kalau ada data periode).
    await fetchBillingPeriods();
    // [PRIVATE] Alokasi siklus berbasis model Billing global grup (Regula):
    // periode lebih old wajib digi pieni dahulu, sesi dikonsumsi kronologis
    // GABUNGAN semua kelas dalam group (unit = pertemuan_private, bobot jumlah_sesi).
    if (app.activeCtx === 'private') await buildGlobalPeriodAllocation();
    buildPeriodMap();

    populateRange();
    populatePeriodFilter();
    updateStatsBadges();
    return true;
}

// --- Konteks SEKOLAH: students / pertemuan_kelas / attendance (kolom `status`) ---
async function fetchSchoolData() {
    const [rStudents, rPert, rAtt] = await Promise.all([
        supabase.from('students').select('id, name, grade').eq('class_id', app.activeClass.id).eq('is_active', true).order('grade').order('name'),
        supabase.from('pertemuan_kelas').select('id, tanggal, materi(title, description, detail)').eq('class_id', app.activeClass.id).order('tanggal', { ascending: false }),
        supabase.from('attendance').select('id, status, student_id, pertemuan_id, student:student_id(name, grade), pertemuan:pertemuan_id!inner(tanggal, materi:materi_id(title))').eq('pertemuan.class_id', app.activeClass.id)
    ]);

    if (rStudents.error) { alert('Gagal memuat siswa: ' + rStudents.error.message); return false; }
    if (rPert.error) { alert('Gagal memuat pertemuan: ' + rPert.error.message); return false; }
    if (rAtt.error) { alert('Gagal memuat absensi: ' + rAtt.error.message); return false; }

    app.students = (rStudents.data || []).map(s => ({ id: s.id, name: s.name || '', grade: s.grade || '' }));
    app.pertemuanList = (rPert.data || []).map(p => ({
        id: p.id,
        tanggal: p.tanggal,
        judul: p.materi?.title || '(tanpa judul)',
        uraian: (p.materi?.description || p.materi?.detail || '').trim()
    }));
    app.attendance = rAtt.data || [];
    return true;
}

// --- Konteks PRIVATE: students_private / pertemuan_private / attendance_private ---
// attendance_private TIDAK punya kolom `status`. Baris absensi private tersimpan
// sebagai penilaian saat sesi berlangsung (sikap/fokus/pemahaman/detail), sehingga:
//   ada data penilaian  -> Hadir ('1')
//   baris ada tapi kosong -> Belum Dinilai (null)
//   tidak ada baris      -> Belum Dinilai (null)
// (Alpa tidak pernah muncul di mode private karena tidak ada field statusnya.)
async function fetchPrivateData() {
    // [GROUP MODE] Private = gabungan PER GROUP: semua kelas dalam group digabungan,
    // lalu siswa & sesi diambil lewat .in('class_id', classIds).
    // Attendance_private tetap ditarik TANPA embed (aman FK duplikat live DB),
    // kemudian disaring manual via pertemuan_id yang sudah dimuat.
    const gid = app.activeClass.group_id || app.activeClass.id;

    const { data: clsList, error: eCls } = await supabase
        .from('class_private')
        .select('id, name')
        .eq('group_id', gid)
        .eq('is_active', true);   // [HIDE] Sembunyikan kelas tidak aktif
    if (eCls) { alert('Gagal memuat kelas private: ' + eCls.message); return false; }

    const classIds = (clsList || []).map(c => c.id);
    if (!classIds.length) {
        app.students = [];
        app.pertemuanList = [];
        app.attendance = [];
        app.privateClassMap = new Map();
        return true;
    }
    const classMap = new Map((clsList || []).map(c => [c.id, c.name || 'Kelas Private']));

    const [rStudents, rPert, rAtt] = await Promise.all([
        supabase.from('students_private')
            .select('id, name, class_id, is_active')
            .in('class_id', classIds)
            .order('name'),
        supabase.from('pertemuan_private')
            .select('id, class_id, tanggal, pertemuan_ke, materi_private:materi_id(judul, deskripsi, detail)')
            .in('class_id', classIds)
            .order('tanggal', { ascending: false }),
        supabase.from('attendance_private')
            .select('id, student_id, pertemuan_id, sikap, fokus, pemahaman, detail')
    ]);

    if (rStudents.error) { alert('Gagal memuat siswa: ' + rStudents.error.message); return false; }
    if (rPert.error) { alert('Gagal memuat pertemuan: ' + rPert.error.message); return false; }
    if (rAtt.error) { alert('Gagal memuat absensi: ' + rAtt.error.message); return false; }

    // Siswa private tidak punya kolom grade; label kelas (gabungan per group)
    app.students = (rStudents.data || [])
        .filter(s => s.is_active !== false)
        .map(s => ({
            id: s.id,
            name: s.name || '',
            grade: '',
            class_id: s.class_id,
            className: classMap.get(s.class_id) || ''
        }));
    app.pertemuanList = (rPert.data || []).map(p => ({
        id: p.id,
        tanggal: p.tanggal,
        judul: p.materi_private?.judul || '(tanpa judul)',
        uraian: (p.materi_private?.deskripsi || p.materi_private?.detail || '').trim(),
        classId: p.class_id,
        className: classMap.get(p.class_id) || ''
    }));

    // Map student_id -> nama & className (termasuk siswa non-aktif) untuk penggabungan
    const pertemuanIds = new Set(app.pertemuanList.map(p => p.id));
    const studentNameById = new Map();
    const studentClassById = new Map();
    app.privateClassMap = new Map();
    (rStudents.data || []).forEach(s => {
        if (s?.name) studentNameById.set(s.id, s.name);
        studentClassById.set(s.id, classMap.get(s.class_id) || '');
        app.privateClassMap.set(s.id, classMap.get(s.class_id) || '');
    });

    // Filter manual ke sesi group (karena tidak ada kolom class di attendance_private)
    app.attendance = (rAtt.data || [])
        .filter(r => pertemuanIds.has(r.pertemuan_id))
        .map(r => ({
            id: r.id,
            student_id: r.student_id,
            pertemuan_id: r.pertemuan_id,
            student: { id: r.student_id, name: studentNameById.get(r.student_id) || '' }, // untuk penggabungan siswa non-aktif
            className: studentClassById.get(r.student_id) || '',
            status: (r.sikap != null || r.fokus != null || r.pemahaman != null || (r.detail && String(r.detail).trim())) ? '1' : null
        }));
    return true;
}

function fillReportHeader() {
    const yearOpt = document.getElementById('rk-year').selectedOptions[0];
    const semOpt = document.getElementById('rk-semester').selectedOptions[0];

    document.getElementById('rk-school').textContent = app.activeClass.schoolName ||
        (app.activeCtx === 'private' ? 'Program Private' : 'Sekolah');
    document.getElementById('rk-meta-class').textContent = (app.activeCtx === 'private')
        ? `Group ${app.activeClass.name}${app.activeClass.schoolName ? ' • Owner: ' + app.activeClass.schoolName : ''}`
        : `Kelas ${app.activeClass.name}  ${app.activeClass.level ? '• Level: ' + app.activeClass.level : ''}  |  Jadwal: ${app.activeClass.jadwal || '-'}`;
    document.getElementById('rk-meta-year').textContent = (app.activeCtx === 'private')
        ? 'Program Private'
        : `${yearOpt ? yearOpt.textContent : ''} • ${semOpt ? semOpt.textContent : ''}`;

    document.getElementById('rk-report-header').style.display = 'block';
    document.getElementById('rk-control').style.display = 'block';
}

function updateStatsBadges() {
    const statsContainer = document.getElementById('rk-stats-badges');
    if (!statsContainer) return;

    const totalStudents = app.students.length;
    const totalSessions = app.pertemuanList.length;

    // Hitung rata-rata kehadiran keseluruhan
    let totalPresent = 0;
    let totalRecords = 0;
    app.attendance.forEach(a => {
        if (a.status !== null && a.status !== undefined && a.status !== 0 && a.status !== '0') {
            totalRecords++;
            if (String(a.status) === '1') totalPresent++;
        }
    });

    const avgRate = totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

    statsContainer.innerHTML = `
        <div class="rk-stat-pill"><span class="rk-stat-num">${totalStudents}</span> <span class="rk-stat-lbl">Siswa</span></div>
        <div class="rk-stat-pill"><span class="rk-stat-num">${totalSessions}</span> <span class="rk-stat-lbl">Sesi</span></div>
        <div class="rk-stat-pill rk-stat-highlight"><span class="rk-stat-num">${avgRate}%</span> <span class="rk-stat-lbl">Rata-rata Hadir</span></div>
    `;
}

function hideReport() {
    document.getElementById('rk-report-header').style.display = 'none';
    document.getElementById('rk-control').style.display = 'none';
    ['rk-section-absensi', 'rk-section-materi'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    app.students = [];
    app.pertemuanList = [];
    app.attendance = [];
    app.periods = [];
    app.periodMap = {};
    app.periodFilter = null;
    app.periodAlloc = {};
    app.periodAllocDone = false;
    app.privateClassMap = new Map();
    const pr = document.getElementById('rk-period-row');
    if (pr) pr.style.display = 'none';
}

// ---------------------------------------------------------------
// 4. RENTANG PERTEMUAN
// ---------------------------------------------------------------
function populateRange() {
    const opts = '<option value="-1">Semua Sesi (' + app.pertemuanList.length + ')</option>' +
        app.pertemuanList.map((p, i) =>
            `<option value="${i}">Sesi ${i + 1}: ${fmtDate(p.tanggal)} • ${escapeHtml(p.judul)}</option>`
        ).join('');

    document.getElementById('rk-range-start').innerHTML = opts;
    document.getElementById('rk-range-end').innerHTML = opts;
}

function getRangePertemuanList() {
    const start = parseInt(document.getElementById('rk-range-start').value, 10);
    const end = parseInt(document.getElementById('rk-range-end').value, 10);

    let list;
    if (start === -1 && end === -1) {
        list = app.pertemuanList.slice();
    } else {
        let i0 = start === -1 ? 0 : start;
        let i1 = end === -1 ? app.pertemuanList.length - 1 : end;
        if (i1 < i0) { const t = i0; i0 = i1; i1 = t; }
        list = app.pertemuanList.slice(i0, i1 + 1);
    }

    // [BILLING CYCLE] Filter siklus aktif (jika user memilih salah satu periode)
    if (app.periodFilter !== null && app.periodFilter !== undefined) {
        list = list.filter(p => (app.periodMap[p.id] ?? -1) === app.periodFilter);
    }
    return list;
}

// ---------------------------------------------------------------
// 4b. BILLING CYCLE — siklus tagihan (sesi per periode) & filter
// ---------------------------------------------------------------
async function fetchBillingPeriods() {
    app.periods = [];
    try {
        if (app.activeCtx === 'private') {
            const gid = app.activeClass?.group_id || app.userProfile?.group_id;
            if (!gid) return;
            const { data } = await supabase.from('billing_periods')
                .select('id, periode_label, start_date, quota_sessions, status')
                .eq('group_id', gid)
                .order('start_date', { ascending: true });
            app.periods = (data || []).map(p => ({
                id: p.id,
                label: p.periode_label || '',
                start_date: p.start_date,
                quota: p.quota_sessions ?? 4,
                status: p.status || 'aktif',
                // Dicomputa oleh buildGlobalPeriodAllocation()
                pakai: 0,
                sisa: p.quota_sessions ?? 4,
                habis: false,
                overflow: 0
            }));
        } else {
            const cid = app.activeClass?.id;
            if (!cid) return;
            const { data } = await supabase.from('billing_periods_sekolah')
                .select('id, periode_label, contract_sessions, status')
                .eq('class_id', cid)
                .order('start_date', { ascending: true });
            app.periods = (data || []).map(p => ({
                id: p.id,
                label: p.periode_label || '',
                quota: p.contract_sessions ?? 4,
                status: p.status || 'aktif'
            }));
        }
    } catch (err) {
        console.error('[Rekap] Gagal memuat billing cycle:', err);
    }
}

// ---------------------------------------------------------------
// 4c. [PRIVATE] ALOKASI SIKLUS GLOBAL GRUP (mirip Billing Module)
// "Regula": periode yang lebih lama wajib digi pieni sampai kuota kontrak
// dalam jumlah SESI keshan yan sebelum sesi masuk periode yang lebih baru.
// Sesi konsumo KRONOLOGIS di seluruh kelas milik group; unit = 1 pertemuan
// (pertemuan_private.id), bobot jumlah_sesi (default 1, bisa 2). Pertemuan
// 2-sesi yang memotong batas kuota -> split/carry ke periode berikut.
// Output: app.periodAlloc (pertemuan_id -> { periodIdx }) + statistik
// pakai/sisa/habis/overflow per periode (dicomputa dari seluruh group).
// ---------------------------------------------------------------
async function buildGlobalPeriodAllocation() {
    app.periodAlloc = {};
    app.periodAllocDone = false;
    const gid = app.activeClass?.group_id;
    if (!gid || !app.periods.length) return;

    try {
        // Kelas AKTIF saja di group (untuk gabungan global kuota) — kelas tidak aktif disembunyikan
        const { data: groupClasses } = await supabase
            .from('class_private')
            .select('id, name')
            .eq('group_id', gid)
            .eq('is_active', true);
        const classIds = (groupClasses || []).map(c => c.id);
        if (!classIds.length) return;

        // Semua pertemuan group urut TANGGAL ASC (unit = pertemuan, bobot jumlah_sesi)
        const { data: allP } = await supabase
            .from('pertemuan_private')
            .select('id, class_id, tanggal, jumlah_sesi')
            .in('class_id', classIds)
            .order('tanggal', { ascending: true });

        const sessionsAsc = [...(allP || [])].sort((a, b) =>
            String(a.tanggal || '').localeCompare(String(b.tanggal || '')));

        // Sesi DIBUUTA sebelum awalnya periode pertama -> diskip (ikut Regula billing)
        const firstStart = String(app.periods[0].start_date || '9999-12-31');
        let idx = 0;
        while (idx < sessionsAsc.length && String(sessionsAsc[idx].tanggal || '') < firstStart) idx++;

        let carryLeft = 0;
        let carryItem = null;

        app.periods.forEach((period, pi) => {
            const q = period.quota;
            let acc = 0;

            // 1) Konsum carry (pertemuan 2-sesi yang memotong batas periode sebelum)
            if (carryLeft > 0 && acc < q) {
                const take = Math.min(carryLeft, q - acc);
                if (!app.periodAlloc[carryItem.id]) {
                    app.periodAlloc[carryItem.id] = { periodIdx: pi };
                }
                acc += take;
                carryLeft -= take;
                if (carryLeft <= 0) carryItem = null;
            }

            // 2) Konsum sesi berikutnya KRONOLOGIS (TIDAK berhento di tanggal)
            while (acc < q && idx < sessionsAsc.length) {
                const s = sessionsAsc[idx];
                const js = Number(s.jumlah_sesi) || 1;
                const need = q - acc;
                const take = Math.min(js, need);
                if (!app.periodAlloc[s.id]) {
                    // map ke periode di mana pertemuan MULAI (split -> periode pertama)
                    app.periodAlloc[s.id] = { periodIdx: pi };
                }
                acc += take;
                if (js <= need) {
                    idx++;
                } else {
                    // Split: kudangan pertama di periode ini, remainder carry ke berikut
                    carryLeft = js - need;
                    carryItem = s;
                    idx++;
                    acc = q;
                    break;
                }
            }

            // Statistik periode (global group)
            period.pakai = acc;
            period.sisa = Math.max(0, q - acc);
            period.habis = acc >= q;
            if (pi === app.periods.length - 1) {
                let oflow = carryLeft;
                for (let j = idx; j < sessionsAsc.length; j++) oflow += Number(sessionsAsc[j].jumlah_sesi) || 1;
                period.overflow = Math.max(0, oflow);
            }
        });
        app.periodAllocDone = true;
    } catch (err) {
        console.error('[Rekap] Gagal alokasi siklus global grup:', err);
    }
}

// Petakan tiap pertemuan (kelas aktif) ke indeks periode-nya.
// [PRIVATE] -> hasil alokasi GLOBAL grup (4c) sesuai model Billing.
// [SEKOLAH] -> alokasi kronologis per kelas (kontrak berbaris per kelas).
// Tanpa periode/billing -> semua masuk 'Tanpa Siklus' (-1).
function buildPeriodMap() {
    const map = {};
    app.pertemuanList.forEach(p => { map[p.id] = -1; });

    if (app.activeCtx === 'private') {
        app.pertemuanList.forEach(p => {
            const a = app.periodAlloc[p.id];
            if (a && a.periodIdx >= 0) map[p.id] = a.periodIdx;
        });
        app.periodMap = map;
        return;
    }

    if (!app.periods.length) { app.periodMap = map; return; }

    const sortedAsc = [...app.pertemuanList].sort((a, b) =>
        String(a.tanggal || '').localeCompare(String(b.tanggal || '')));
    let idx = 0;
    app.periods.forEach((period, periodIdx) => {
        for (let k = 0; k < period.quota && idx < sortedAsc.length; k++) {
            map[sortedAsc[idx].id] = periodIdx;
            idx++;
        }
    });
    app.periodMap = map;
}

function periodLabel(periodIdx, count) {
    const p = app.periods[periodIdx];
    if (!p) return 'Tanpa Siklus';
    const base = p.label || ('Siklus ' + (periodIdx + 1));
    const sesiTxt = count !== undefined ? `${count} sesi` : `${p.quota} sesi`;
    let extra = '';
    if (app.activeCtx === 'private' && app.periodAllocDone) {
        if (p.habis) extra = ' · Kuota habis';
        else if (p.sisa > 0) extra = ` · Sisa kuota ${p.sisa}`;
        if (p.overflow > 0) extra += ` · +${p.overflow} overflow`;
    }
    return `${base} (${sesiTxt})${extra}`;
}

function populatePeriodFilter() {
    const row = document.getElementById('rk-period-row');
    const sel = document.getElementById('rk-period');
    if (!row || !sel) return;

    const note = document.getElementById('rk-period-note');
    if (note) {
        note.textContent = (app.activeCtx === 'private')
            ? 'Kuota global gabungan semua kelas group · periode lama pieni dahulu'
            : 'Sesi per kelas · kontrak periode sekolah';
    }

    if (!app.periods.length) {
        row.style.display = 'none';
        sel.innerHTML = '';
        app.periodFilter = null;
        return;
    }

    const prev = app.periodFilter;
    sel.innerHTML = '<option value="">Semua Siklus</option>' +
        app.periods.map((p, i) => `<option value="${i}">${periodLabel(i)}</option>`).join('');

    // Pertahankan pilihan periode lama bila masih valid
    app.periodFilter = (prev !== null && prev !== undefined && prev >= 0 && prev < app.periods.length) ? prev : null;
    sel.value = (app.periodFilter === null) ? '' : String(app.periodFilter);
    row.style.display = '';
}

// Kelompokkan list sesi terurut menjadi blok per periode (untuk heading tabel)
function buildPeriodGroups(sessions) {
    const groups = [];
    sessions.forEach(s => {
        const pi = app.periodMap[s.id] ?? -1;
        const key = pi < 0 ? 'x' : String(pi);
        const last = groups[groups.length - 1];
        if (last && last.key === key) {
            last.count++;
            last.sessions.push(s);
        } else {
            groups.push({ key, pi, label: pi < 0 ? 'Tanpa Siklus' : periodLabel(pi), count: 1, sessions: [s] });
        }
    });
    groups.forEach(g => { if (g.pi >= 0) g.label = periodLabel(g.pi, g.count); });
    return groups;
}

// ---------------------------------------------------------------
// 5. TAB ABSENSI (Dengan Baris Total Hadir di Footer)
// ---------------------------------------------------------------
function renderAbsensiWorksheet() {
    const table = document.getElementById('rk-table-absensi');
    const sessions = getRangePertemuanList();
    const totalStudents = app.students.length;

    if (!sessions.length || !totalStudents) {
        table.innerHTML = `<thead><tr><th>Absensi</th></tr></thead>
            <tbody><tr><td class="rk-empty">Belum ada data absensi untuk kelas/rentang ini.</td></tr></tbody>`;
        return;
    }

    // Peta (student_id|pertemuan_id) -> record
    const byKey = new Map();
    app.attendance.forEach(r => byKey.set(r.student_id + '|' + r.pertemuan_id, r));

    // Hitung total hadir per kolom pertemuan
    const presentPerSession = sessions.map(s => {
        let count = 0;
        app.students.forEach(st => {
            const rec = byKey.get(st.id + '|' + s.id);
            if (rec && String(rec.status) === '1') {
                count++;
            }
        });
        return count;
    });

    // [BILLING CYCLE] Baris header pengelompokan per siklus (hanya jika ada data periode & >1 kelompok)
    const hasPeriods = app.periods.length > 0;
    const groups = buildPeriodGroups(sessions);
    const groupRow = (hasPeriods && groups.length > 1)
        ? `<tr class="rk-cycle-group">
            <th class="rk-sticky rk-col-no"></th>
            <th class="rk-sticky rk-col-name"></th>
            <th class="rk-sticky rk-col-grade"></th>
            ${groups.map(g => `<th class="rk-cycle-cell" colspan="${Math.max(g.count, 1)}">${escapeHtml(g.label)}</th>`).join('')}
        </tr>`
        : '';

    const thead = `<thead>${groupRow}<tr>
        <th class="rk-sticky rk-col-no" width="40">No</th>
        <th class="rk-sticky rk-col-name rk-left">Nama Siswa</th>
        <th class="rk-sticky rk-col-grade rk-left">Grade</th>
        ${sessions.map((s, idx) =>
            `<th class="rk-session-header" title="${escapeHtml(fmtDateLong(s.tanggal))} • ${escapeHtml(s.judul)}">
                <span class="rk-session-num">Sesi ${idx + 1}</span>
                <span class="rk-session-date">${escapeHtml(fmtDate(s.tanggal))}</span>
            </th>`
        ).join('')}
    </tr></thead>`;

    const tbody = `<tbody>` + app.students.map((st, i) => {
        const cells = sessions.map(s => {
            const rec = byKey.get(st.id + '|' + s.id);
            return `<td class="rk-center">${ikonAbsensi(rec?.status)}</td>`;
        }).join('');
        return `<tr>
            <td class="rk-sticky rk-col-no">${i + 1}</td>
            <td class="rk-sticky rk-col-name rk-left">${escapeHtml(st.name)}${app.activeCtx === 'private' && st.className ? `<span class="rk-class-tag">${escapeHtml(st.className)}</span>` : ''}</td>
            <td class="rk-sticky rk-col-grade rk-left">${escapeHtml(st.grade || '-')}</td>
            ${cells}
        </tr>`;
    }).join('') + `</tbody>`;

    // [BARIS TOTAL SISWA HADIR DI FOOTER]
    const tfoot = `<tfoot>
        <tr class="rk-foot-total">
            <td class="rk-sticky rk-col-no"><i class="fa-solid fa-check-double"></i></td>
            <td class="rk-sticky rk-col-name rk-left"><strong>Total Hadir (✅)</strong></td>
            <td class="rk-sticky rk-col-grade rk-left"><strong>${totalStudents} Siswa</strong></td>
            ${presentPerSession.map(hadir => {
                const pct = totalStudents > 0 ? Math.round((hadir / totalStudents) * 100) : 0;
                return `<td class="rk-center rk-cell-total">
                    <div class="rk-total-val">${hadir}</div>
                    <div class="rk-total-pct">${pct}%</div>
                </td>`;
            }).join('')}
        </tr>
    </tfoot>`;

    table.innerHTML = thead + tbody + tfoot;
}

// ---------------------------------------------------------------
// 6. TAB SILABUS / MATERI TERAJARKAN
// ---------------------------------------------------------------
function renderMateriTable() {
    const table = document.getElementById('rk-table-materi');
    const slice = getRangePertemuanList();

    if (!slice.length) {
        table.innerHTML = `<thead><tr><th>Materi</th></tr></thead>
            <tbody><tr><td class="rk-empty">Belum ada materi yang tercatat dalam rentang ini.</td></tr></tbody>`;
        return;
    }

    // [BILLING CYCLE] Bagian tabel dipisah per siklus dengan baris judul.
    // Baris judul hanya ditampilkan bila ada periode billing (siklus) terkonfigurasi.
    const hasPeriods = app.periods.length > 0;
    const groups = buildPeriodGroups(slice);
    let sesiNo = 0;
    const bodyRows = groups.map(g => {
        const hdr = hasPeriods
            ? `<tr class="rk-cycle-hdr"><td colspan="4">${escapeHtml(g.label)}</td></tr>`
            : '';
        return hdr + g.sessions.map(r => {
            sesiNo++;
            return `<tr>
                <td class="rk-center"><strong>${sesiNo}</strong></td>
                <td class="rk-left" style="white-space:nowrap;">${escapeHtml(fmtDateLong(r.tanggal))}</td>
                <td class="rk-left"><strong>${escapeHtml(r.judul)}</strong>${app.activeCtx === 'private' && r.className ? `<span class="rk-class-tag">${escapeHtml(r.className)}</span>` : ''}</td>
                <td class="rk-left">${escapeHtml(r.uraian) || '<em style="color:#94a3b8">Tidak ada uraian</em>'}</td>
            </tr>`;
        }).join('');
    }).join('');

    table.innerHTML = `<thead><tr>
        <th width="50">Sesi</th>
        <th class="rk-left" width="140">Tanggal</th>
        <th class="rk-left" width="220">Nama Materi</th>
        <th class="rk-left">Uraian / Capaian Pembelajaran</th>
    </tr></thead><tbody>${bodyRows}</tbody>`;
}

// ---------------------------------------------------------------
// 7. UTILS & EVENTS
// ---------------------------------------------------------------
function ikonAbsensi(status) {
    if (status === undefined || status === null) return `<span class="rk-badge-empty">-</span>`;
    const str = String(status);
    if (str === '1') return `<span class="rk-badge-hadir" title="Hadir">✅</span>`;
    if (str === '2') return `<span class="rk-badge-alpa" title="Alpa / Tidak Hadir">❌</span>`;
    return `<span class="rk-badge-unrated" title="Belum Dinilai">⬜</span>`;
}

function fmtDate(d) {
    const dt = new Date(d);
    return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function fmtDateLong(d) {
    const dt = new Date(d);
    return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

// escapeHtml kini diimpor bersama dari assets/js/utils.js (sumber tunggal anti-XSS)
function showSection(id) {
    ['rk-section-absensi', 'rk-section-materi'].forEach(sid => {
        const el = document.getElementById(sid);
        if (el) el.style.display = (sid === id) ? 'block' : 'none';
    });
}

function updateActiveBtn(btnId) {
    document.querySelectorAll('.rk-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
}

function setupEvents() {
    document.getElementById('rk-back').addEventListener('click', () => {
        if (typeof app.onBack === 'function') app.onBack();
        else if (window.loadModule) window.loadModule('explorer-module');
    });

    // Switcher konteks Sekolah | Private
    ['school', 'private'].forEach(ctx => {
        const btn = document.getElementById('rk-ctx-' + ctx);
        if (btn) btn.addEventListener('click', () => switchContext(ctx));
    });

    // Pilih kelas -> langsung muat tanpa tombol manual
    document.getElementById('rk-class').addEventListener('change', handleLoadRekap);

    // Ganti semester
    document.getElementById('rk-semester').addEventListener('change', async () => {
        await isiDropdownKelas();
    });

    // Toggle ganti tahun ajaran jika dibutuhkan
    const toggleBtn = document.getElementById('rk-toggle-all-years');
    const selYear = document.getElementById('rk-year');
    if (toggleBtn && selYear) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = selYear.style.display === 'none';
            selYear.style.display = isHidden ? 'inline-block' : 'none';
            toggleBtn.textContent = isHidden ? 'Tutup TA' : 'Ubah TA';
        });
        selYear.addEventListener('change', async () => {
            // Muat semester untuk tahun yang dipilih
            const yid = selYear.value;
            const { data: semesters } = await supabase
                .from('semesters')
                .select('id, name, is_active')
                .eq('academic_year_id', yid)
                .order('name');
            
            const selSem = document.getElementById('rk-semester');
            selSem.innerHTML = (semesters || []).map(s =>
                `<option value="${s.id}" ${s.is_active ? 'selected' : ''}>${escapeHtml(s.name)}${s.is_active ? ' (Aktif)' : ''}</option>`
            ).join('');
            
            await isiDropdownKelas();
        });
    }

    // Tab Switcher
    document.getElementById('rk-tab-absensi').addEventListener('click', () => {
        app.activeTab = 'absensi';
        updateActiveBtn('rk-tab-absensi');
        showSection('rk-section-absensi');
        renderAbsensiWorksheet();
    });
    
    document.getElementById('rk-tab-materi').addEventListener('click', () => {
        app.activeTab = 'materi';
        updateActiveBtn('rk-tab-materi');
        showSection('rk-section-materi');
        renderMateriTable();
    });

    // Rentang filter
    const reloadActiveTab = () => {
        if (!app.activeClass) return;
        if (app.activeTab === 'absensi') renderAbsensiWorksheet();
        else if (app.activeTab === 'materi') renderMateriTable();
    };
    document.getElementById('rk-range-start').addEventListener('change', reloadActiveTab);
    document.getElementById('rk-range-end').addEventListener('change', reloadActiveTab);

    // Filter Siklus (billing cycle)
    const selPeriod = document.getElementById('rk-period');
    if (selPeriod) {
        selPeriod.addEventListener('change', () => {
            const v = selPeriod.value;
            app.periodFilter = (v === '' || v === null || v === undefined) ? null : parseInt(v, 10);
            reloadActiveTab();
        });
    }
}

// ---------------------------------------------------------------
// 8. STYLES
// ---------------------------------------------------------------
function injectStyles() {
    if (document.getElementById('rk-css')) return;
    const s = document.createElement('style');
    s.id = 'rk-css';
    s.textContent = `
        .rk-container { max-width: 1050px; margin: 0 auto; padding: 12px; font-family: inherit; color: #1e293b; }
        .rk-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; margin-bottom: 14px; box-shadow: 0 2px 10px rgba(0,0,0,.03); }
        .rk-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
        .rk-title-area { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .rk-top h2 { margin: 0; font-size: 1.25rem; color: #0f172a; font-weight: 800; }
        .rk-active-term-badge { background: #d1fae5; color: #047857; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
        .rk-btn { border: none; border-radius: 10px; padding: 8px 16px; font-size: .8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all .15s; }
        .rk-btn-ghost { background: #f1f5f9; color: #334155; }
        .rk-btn-ghost:hover { background: #e2e8f0; }
        .rk-btn-link { background: none; border: none; color: #27ae60; font-size: 0.72rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0 4px; }

        /* Switcher konteks Sekolah | Private (pola pills seperti Gallery) */
        .rk-ctx-bar { display: inline-flex; gap: 6px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 4px; margin-bottom: 14px; width: max-content; }
        .rk-ctx-btn { border: none; background: transparent; color: #64748b; font-size: .8rem; font-weight: 700; padding: 7px 20px; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all .15s; }
        .rk-ctx-btn:hover { color: #27ae60; background: #ecfdf5; }
        .rk-ctx-btn.active { color: #fff; background: #2ecc71; box-shadow: 0 2px 8px rgba(46,204,113,.35); }
        .rk-ctx-btn.active:hover { color: #fff; background: #2ecc71; }
        
        .rk-filter-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
        .rk-field-class { flex: 2; min-width: 240px; }
        .rk-field-period-toggle { flex: 1; min-width: 200px; }
        .rk-field label { display: block; font-size: .75rem; font-weight: 700; color: #475569; margin-bottom: 5px; }
        .rk-input { width: 100%; padding: 10px 12px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: .85rem; background: #fff; outline: none; transition: border-color .15s; }
        .rk-input:focus { border-color: #2ecc71; box-shadow: 0 0 0 3px rgba(46,204,113,.15); }
        .rk-period-box { display: flex; align-items: center; gap: 6px; }
        .rk-input-period { padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: .78rem; background: #f8fafc; outline: none; }
        
        .rk-header-main { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; }
        .rk-school-title { font-family: 'Fredoka One', cursive; color: #27ae60; margin: 0 0 4px 0; font-size: 1.25rem; }
        .rk-meta { font-size: .9rem; font-weight: 700; color: #1e293b; }
        .rk-meta-sub { font-size: .78rem; color: #64748b; margin-top: 2px; }
        .rk-stats-badges { display: flex; gap: 8px; flex-wrap: wrap; }
        .rk-stat-pill { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 6px 14px; text-align: center; }
        .rk-stat-highlight { background: #ecfdf5; border-color: #a7f3d0; }
        .rk-stat-num { display: block; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
        .rk-stat-highlight .rk-stat-num { color: #059669; }
        .rk-stat-lbl { font-size: .65rem; color: #64748b; font-weight: 700; text-transform: uppercase; }

        .rk-control { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
        .rk-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
        .rk-tab { padding: 8px 16px; font-size: .82rem; font-weight: 700; color: #64748b; background: #f1f5f9; border: none; border-radius: 999px; cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 6px; }
        .rk-tab.active { color: #fff; background: #2ecc71; box-shadow: 0 3px 10px rgba(46,204,113,.35); }
        .rk-range { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: .78rem; color: #475569; }
        .rk-input-mini { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: .78rem; max-width: 200px; background: #fff; }
        
        .rk-table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 10px; border: 1px solid #e2e8f0; }
        .rk-table { width: 100%; min-width: 680px; border-collapse: separate; border-spacing: 0; background: #fff; font-size: .82rem; }
        .rk-table th, .rk-table td { border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; padding: 8px 10px; text-align: center; }
        .rk-table th { background: #f8fafc; color: #334155; font-weight: 700; border-top: none; }
        .rk-session-header { min-width: 90px; }
        .rk-session-num { display: block; font-size: 0.72rem; color: #27ae60; font-weight: 800; }
        .rk-session-date { display: block; font-size: 0.7rem; color: #64748b; font-weight: normal; margin-top: 1px; }
        
        /* Sticky columns */
        .rk-table th.rk-sticky, .rk-table td.rk-sticky { position: sticky; background: #fff; z-index: 2; }
        .rk-table th.rk-sticky { background: #f8fafc; z-index: 3; }
        .rk-col-no { left: 0; width: 40px; min-width: 40px; }
        .rk-col-name { left: 40px; min-width: 140px; max-width: 200px; }
        .rk-col-grade { left: 180px; min-width: 65px; border-right: 2px solid #cbd5e1 !important; box-shadow: 3px 0 6px -2px rgba(0,0,0,0.06); }
        
        .rk-table td.rk-left, .rk-table th.rk-left { text-align: left; }
        .rk-table td.rk-center { text-align: center; }
        .rk-empty { padding: 32px; text-align: center; color: #94a3b8; }
        
        /* Footer Total Styling */
        .rk-foot-total td { background: #f0fdf4 !important; font-weight: 700; border-top: 2px solid #86efac; border-bottom: none; }
        .rk-foot-total td.rk-sticky { background: #dcfce7 !important; z-index: 2; }
        .rk-cell-total { padding: 6px !important; }
        .rk-total-val { font-size: 0.95rem; font-weight: 800; color: #15803d; }
        .rk-total-pct { font-size: 0.68rem; color: #166534; font-weight: 600; }

        /* Baris/header pengelompokan siklus (billing cycle) */
        .rk-cycle-group th { background: #ecfdf5; color: #047857; border-bottom: 2px solid #a7f3d0; font-size: .72rem; font-weight: 800; text-align: center; letter-spacing: .03em; padding: 6px 4px; }
        .rk-cycle-cell { white-space: nowrap; }
        .rk-cycle-hdr td { background: #ecfdf5; color: #047857; font-weight: 800; font-size: .75rem; text-align: left !important; letter-spacing: .03em; border-bottom: 2px solid #a7f3d0; padding: 7px 12px; }
        .rk-period-note { font-size: .68rem; color: #64748b; font-weight: 600; margin-left: 6px; }
        .rk-class-tag { display:inline-block; margin-left:6px; background:#e0f2fe; color:#0e7490; border:1px solid #bae6fd; border-radius:12px; padding:1px 8px; font-size:.66rem; font-weight:700; white-space:nowrap; }

        @media (max-width: 720px) {
            .rk-control { flex-direction: column; align-items: stretch; }
            .rk-range { justify-content: flex-start; }
            .rk-filter-row { flex-direction: column; align-items: stretch; }
        }
    `;
    document.head.appendChild(s);
}