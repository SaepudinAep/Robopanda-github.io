/**
 * Project: Robopanda Client
 * File: assets/js/index.js
 * Version: 6.7 - Rekap Absensi jadi Modul Mandiri (Tab Navbar)
 * Format: Plain Text (Huawei T10s Optimized)
 */

import { supabase } from './config.js';
import { escapeHtml } from './utils.js';

// --- 1. STATE MANAGEMENT ---
let currentUser = null;
let userProfile = { 
    role: 'guest' 
}; 
let currentActiveModule = 'explorer-module';

// --- 2. DATA DARURAT (HARDCODED) ---
// Agar Navbar muncul 0 detik tanpa nunggu database
const STATIC_MENUS = [
    { title: 'Home', route: 'explorer-module', icon_class: 'fa-solid fa-house', allowed_roles: '["guest"]' },
    { title: 'Kurikulum', route: 'kurikulum-module', icon_class: 'fa-solid fa-sitemap', allowed_roles: '["super_admin","teacher","pic","student"]' },
    { title: 'Rekap', route: 'rekap-absensi-module', icon_class: 'fa-solid fa-clipboard-list', allowed_roles: '["super_admin","teacher","pic"]' },
    { title: 'Tools', route: 'tools', icon_class: 'fa-solid fa-gamepad', allowed_roles: '["guest"]' }
];

// Versi rilis statis untuk cache-busting modul.
// Ganti angka ini HANYA saat rilis update agar browser bisa cache modul antar kunjungan.
const APP_VERSION = '7.8';

// --- 3. INISIALISASI ---
document.addEventListener('DOMContentLoaded', async () => {
    // LANGKAH 1: RENDER LANGSUNG (Pakai Data Darurat)
    // Kita render dulu agar layar tidak blank.
    renderNavbar(STATIC_MENUS); 

    // LANGKAH 2: VERIFIKASI SESI LANGSUNG DARI SUPABASE (Bukan dari localStorage)
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            currentUser = session.user;
            const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', currentUser.id).single();
            if (profile) {
                userProfile = profile;
            }
        }
    } catch (err) {
        console.error("Auth verification error:", err);
    }

    // Bersihkan residu legacy jika pernah tersimpan di browser
    localStorage.removeItem('user_role');

    // LANGKAH 3: UPDATE UI & FETCH MENUS SESUAI PROFIL TERVERIFIKASI
    updateAuthUI(!!currentUser);
    await fetchPublicMenus();
    setupAuthListeners();

    // LANGKAH 4: LOAD MODUL UTAMA DENGAN PROFIL YANG VALID
    loadModule('explorer-module');
});

// --- 4. LOGIKA FILTER MENU (PERBAIKAN UTAMA) ---
async function fetchPublicMenus() {
    try {
        const { data: catData } = await supabase.from('menu_categories').select('id').eq('category_key', 'homepage').single();
        if (!catData) return;

        const { data: allMenus } = await supabase.from('app_menus')
            .select('*')
            .eq('category', catData.id)
            .eq('is_active', true)
            .order('order_index');

        if (allMenus) {
            // Pastikan tab Rekap (modul mandiri) selalu tampil bagi role berwenang,
            // meskipun entri menu-nya belum dibuat di tabel app_menus.
            if (!allMenus.some(m => m.route === 'rekap-absensi-module')) {
                allMenus.push({
                    title: 'Rekap',
                    route: 'rekap-absensi-module',
                    icon_class: 'fa-solid fa-clipboard-list',
                    allowed_roles: '["super_admin","teacher","pic"]'
                });
            }
            // Pastikan tab Kurikulum (read-only) tampil sesuai role terdaftar.
            if (!allMenus.some(m => m.route === 'kurikulum-module')) {
                allMenus.push({
                    title: 'Kurikulum',
                    route: 'kurikulum-module',
                    icon_class: 'fa-solid fa-sitemap',
                    allowed_roles: '["super_admin","teacher","pic","student"]'
                });
            }
            renderNavbar(allMenus);
        }
    } catch (err) {
        console.error("Menu Fetch Error (Using Static):", err);
    }
}

function renderNavbar(menus) {
    const nav = document.getElementById('main-nav-categories');
    if (!nav) return;

    // --- FILTER LOGIC ---
    const filtered = menus.filter(menu => {
        let allowed = [];
        try {
            // Normalisasi data JSON
            allowed = typeof menu.allowed_roles === 'string' ? JSON.parse(menu.allowed_roles) : menu.allowed_roles;
        } catch(e) { allowed = []; }

        // RULE 1: JIKA MENU UNTUK 'GUEST', MAKA SEMUA ORANG BOLEH LIHAT
        // (Termasuk Admin, Guru, dll). Ini kunci agar Home/Tools tidak hilang.
        if (allowed.includes('guest')) return true;

        // RULE 2: JIKA TIDAK, CEK APAKAH ROLE USER ADA DI DAFTAR IZIN
        // (Misal: Menu Admin Panel hanya untuk super_admin)
        if (allowed.includes(userProfile.role)) return true;

        return false;
    });

    // Render HTML (judul & route di-escape untuk cegah XSS dari data DB)
    nav.innerHTML = filtered.map(m => `
        <button class="tab-item ${currentActiveModule === m.route ? 'active' : ''}" 
                id="btn-nav-${escapeHtml(m.route)}"
                onclick="window.loadModule('${escapeHtml(m.route)}')">
            <i class="${escapeHtml(m.icon_class || '')}"></i> ${escapeHtml(m.title)}
        </button>
    `).join('');
}

// --- 5. MODULE LOADER ---
async function loadModule(name) {
    currentActiveModule = name; 
    const contentArea = document.getElementById('app-content');
    if (!contentArea) return;

    contentArea.innerHTML = `<div style="text-align:center; padding:100px; color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>`;

    try {
        const module = await import(`../../modules/${name}.js?v=${APP_VERSION}`);
        contentArea.innerHTML = ''; 

        if (module.initExplorer) {
            await module.initExplorer(contentArea, userProfile);
        } else if (module.init) {
            await module.init(contentArea, userProfile);
        }
        
        document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`btn-nav-${name}`);
        if (btn) btn.classList.add('active');

    } catch (err) {
        contentArea.innerHTML = `<div style="padding:50px; text-align:center; color:#ef4444;">Modul tidak tersedia.</div>`;
    }
}

// --- 6. AUTH UI ---
function updateAuthUI(isLoggedIn) {
    const authArea = document.getElementById('auth-area');
    if (!authArea) return;

    if (isLoggedIn) {
        authArea.innerHTML = `
            <div class="auth-badge">
                <div>
                    <div class="auth-name">${escapeHtml(userProfile.name || 'User')}</div>
                    <div class="auth-role">${escapeHtml(userProfile.role)}</div>
                </div>
                <button id="btn-logout-action" class="btn-login-trigger btn-danger">Logout</button>
            </div>`;
        
        document.getElementById('btn-logout-action').onclick = async () => {
            if(confirm("Yakin ingin keluar?")) {
                await supabase.auth.signOut();
                localStorage.removeItem('user_role');
                window.location.reload(); 
            }
        };
    } else {
        authArea.innerHTML = `<button class="btn-login-trigger" id="btn-show-login"><i class="fa-solid fa-right-to-bracket"></i> Login Siswa</button>`;
        const btnShow = document.getElementById('btn-show-login');
        if (btnShow) btnShow.onclick = () => {
            const modal = document.getElementById('modal-login');
            modal.classList.add('active');
            // Fokus otomatis ke field email setelah modal tampil (UX + a11y)
            setTimeout(() => {
                const emailInput = document.getElementById('login-email');
                if (emailInput) emailInput.focus();
            }, 80);
        };
    }
}

// --- 7. EVENT LISTENERS ---
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-do-login');
    
    if (!email || !password) return alert("Lengkapi data!");
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { 
        alert(error.message); 
        btn.innerHTML = 'Masuk Sekarang';
        btn.disabled = false; 
    } else {
        window.location.reload(); 
    }
}

function setupAuthListeners() {
    const btn = document.getElementById('btn-do-login');
    if (btn) btn.onclick = handleLogin;
    // Supabase auth state change listener untuk sinkronisasi otomatis
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            currentUser = null;
            userProfile = { role: 'guest' };
            localStorage.removeItem('user_role');
        }
    });
    const close = document.getElementById('btn-close-login');
    if (close) close.onclick = () => document.getElementById('modal-login').classList.remove('active');

    // Tekan Enter di field password = langsung submit (UX form umum)
    const pwInput = document.getElementById('login-password');
    if (pwInput) pwInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Klik area gelap di luar modal untuk menutup (tidak menutup jika klik di dalam kotak)
    const modal = document.getElementById('modal-login');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    // Tutup dengan tombol Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });
}

// --- Muat ulang halaman saat logo diklik (menggantikan onclick inline) ---
(function initLogoReload() {
    const logo = document.getElementById('logo-reload');
    if (!logo) return;
    logo.addEventListener('click', () => window.location.reload());
    logo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            window.location.reload();
        }
    });
})();

window.loadModule = loadModule;