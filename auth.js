const AUTH_KEY = "ttb_auth";
const ADMIN_PROFILES_KEY = "ttb_admin_profiles";
const SUPER_ADMIN_USER = "jun";
const ADMIN_PROFILES_TABLE = "admin_profiles";
const AUTH_SUPABASE_URL = "https://kosjrebuehulcccbjmks.supabase.co";
const AUTH_SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvc2pyZWJ1ZWh1bGNjY2JqbWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNDk0MjgsImV4cCI6MjA5MzcyNTQyOH0.ykX3sBp9wJvJx88NYO1Rw470UDseND6bSmFc190YLII";

const DEFAULT_ADMIN_PROFILES = [
  { login: "jun", birthday: "2001-07-13", owner: true },
];

function normalizeLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBirthday(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = br[1].padStart(2, "0");
    const month = br[2].padStart(2, "0");
    return `${br[3]}-${month}-${day}`;
  }

  return raw;
}

function formatBirthday(value) {
  const normalized = normalizeBirthday(value);
  const parts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return value || "";
  return `${parts[3]}/${parts[2]}/${parts[1]}`;
}

function readAdminProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ADMIN_PROFILES_KEY));
    if (Array.isArray(parsed)) {
      return mergeDefaultAdminProfiles(parsed);
    }
  } catch (_) {}

  saveAdminProfiles(DEFAULT_ADMIN_PROFILES);
  return [...DEFAULT_ADMIN_PROFILES];
}

function mergeDefaultAdminProfiles(profiles) {
  const byLogin = new Map();
  [...DEFAULT_ADMIN_PROFILES, ...profiles].forEach((profile) => {
    const login = normalizeLogin(profile.login);
    const birthday = normalizeBirthday(profile.birthday);
    if (!login || !birthday) return;
    const defaultProfile = DEFAULT_ADMIN_PROFILES.find((item) => item.login === login);
    byLogin.set(login, {
      login,
      birthday: defaultProfile?.birthday ?? birthday,
      owner: Boolean(defaultProfile?.owner || profile.owner),
    });
  });
  return [...byLogin.values()];
}

function saveAdminProfiles(profiles) {
  localStorage.setItem(ADMIN_PROFILES_KEY, JSON.stringify(mergeDefaultAdminProfiles(profiles)));
}

function getAdminProfiles() {
  const profiles = readAdminProfiles();
  saveAdminProfiles(profiles);
  return profiles;
}

async function authSupabaseRequest(path, options = {}) {
  const res = await fetch(`${AUTH_SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: AUTH_SUPABASE_KEY,
      Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadAdminProfilesOnline() {
  const rows = await authSupabaseRequest(
    `${ADMIN_PROFILES_TABLE}?select=login,birthday,owner&order=login.asc`,
  );
  const profiles = mergeDefaultAdminProfiles(rows || []);
  saveAdminProfiles(profiles);
  return profiles;
}

async function getAdminProfilesOnline() {
  try {
    return await loadAdminProfilesOnline();
  } catch (err) {
    console.warn("Perfis admin online indisponiveis; usando cache local.", err);
    return getAdminProfiles();
  }
}

async function saveAdminProfileOnline(profile) {
  await authSupabaseRequest(`${ADMIN_PROFILES_TABLE}?on_conflict=login`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      login: normalizeLogin(profile.login),
      birthday: normalizeBirthday(profile.birthday),
      owner: Boolean(profile.owner),
    }),
  });
}

async function removeAdminProfileOnline(login) {
  await authSupabaseRequest(`${ADMIN_PROFILES_TABLE}?login=eq.${encodeURIComponent(login)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

function findAdminProfile(login) {
  const normalizedLogin = normalizeLogin(login);
  return getAdminProfiles().find((profile) => profile.login === normalizedLogin) ?? null;
}

async function findAdminProfileOnline(login) {
  const normalizedLogin = normalizeLogin(login);
  const profiles = await getAdminProfilesOnline();
  return profiles.find((profile) => profile.login === normalizedLogin) ?? null;
}

async function addAdminProfile(login, birthday) {
  if (!isSuperAdmin()) return { ok: false, error: "Apenas a conta jun pode criar admins." };

  const normalizedLogin = normalizeLogin(login);
  const normalizedBirthday = normalizeBirthday(birthday);
  if (!normalizedLogin || !normalizedBirthday) {
    return { ok: false, error: "Informe login e data de aniversario." };
  }

  const profiles = await getAdminProfilesOnline();
  if (profiles.some((profile) => profile.login === normalizedLogin)) {
    return { ok: false, error: "Esse login ja existe." };
  }

  const profile = { login: normalizedLogin, birthday: normalizedBirthday, owner: false };
  profiles.push(profile);
  saveAdminProfiles(profiles);
  try {
    await saveAdminProfileOnline(profile);
  } catch (err) {
    console.warn("Nao foi possivel salvar admin online.", err);
    return { ok: true, warning: "Criado neste aparelho, mas a tabela online ainda nao respondeu." };
  }
  return { ok: true };
}

async function removeAdminProfile(login) {
  if (!isSuperAdmin()) return false;
  const normalizedLogin = normalizeLogin(login);
  if (normalizedLogin === SUPER_ADMIN_USER) return false;
  saveAdminProfiles(getAdminProfiles().filter((profile) => profile.login !== normalizedLogin));
  try {
    await removeAdminProfileOnline(normalizedLogin);
  } catch (err) {
    console.warn("Nao foi possivel remover admin online.", err);
  }
  return true;
}

/* Leitura */
function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY));
  } catch {
    return null;
  }
}
function getRole()      { return getAuth()?.role || null; }
function getUser()      { return getAuth()?.user || ""; }
function isAdmin()      { return getRole() === "admin"; }
function isSpectator()  { return getRole() === "spectator"; }
function isLoggedIn()   { return isAdmin() || isSpectator(); }
function isSuperAdmin() { return isAdmin() && normalizeLogin(getUser()) === SUPER_ADMIN_USER; }

/* Login / Logout */
async function loginAdmin(user, birthday) {
  const profile = await findAdminProfileOnline(user);
  if (profile && profile.birthday === normalizeBirthday(birthday)) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      role: "admin",
      user: profile.login,
      owner: Boolean(profile.owner),
    }));
    return true;
  }
  return false;
}

function loginSpectator(name) {
  if (!name?.trim()) return false;
  localStorage.setItem(AUTH_KEY, JSON.stringify({ role: "spectator", user: name.trim() }));
  return true;
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  window.location.replace("login.html");
}

/* Guarda o corpo invisivel ate autenticar */
if (document.documentElement.dataset.page !== "login") {
  document.documentElement.style.visibility = "hidden";
}

/* Verificacao de acesso */
function checkAuth(adminOnly = false) {
  if (document.documentElement.dataset.page === "login") return true;

  if (!isLoggedIn()) {
    window.location.replace("login.html");
    return false;
  }

  if (adminOnly && !isAdmin()) {
    window.location.replace("status.html");
    return false;
  }

  document.documentElement.style.visibility = "";
  return true;
}

/* Modo espectador: bloqueia controles via CSS */
function applySpectatorMode() {
  if (!isSpectator()) return;
  document.body.classList.add("is-spectator");
}

function renderAdminProfilesList() {
  const list = document.querySelector("#adminProfilesList");
  if (!list) return;

  list.innerHTML = getAdminProfiles()
    .map((profile) => `
      <li class="admin-profile-item">
        <span>
          <strong>${escapeAuthHtml(profile.login)}</strong>
          <small>${formatBirthday(profile.birthday)}${profile.owner ? " - dono" : ""}</small>
        </span>
        ${profile.owner ? "" : `<button type="button" data-remove-admin="${escapeAuthHtml(profile.login)}">Remover</button>`}
      </li>
    `)
    .join("");

  list.querySelectorAll("[data-remove-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      await removeAdminProfile(button.dataset.removeAdmin);
      renderAdminProfilesList();
    });
  });
}

function escapeAuthHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mountAdminProfileManager() {
  if (!isSuperAdmin() || document.querySelector("#adminProfilesDialog")) return;

  const target = document.querySelector(".toolbar-actions") || document.body;
  const button = document.createElement("button");
  button.id = "adminProfilesOpen";
  button.type = "button";
  button.className = "admin-profiles-open";
  button.textContent = "Admins";
  target.prepend(button);

  const dialog = document.createElement("dialog");
  dialog.id = "adminProfilesDialog";
  dialog.className = "admin-profiles-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="admin-profiles-card">
      <div class="admin-profiles-head">
        <h2>Perfis admin</h2>
        <button class="icon-button" value="close" aria-label="Fechar">x</button>
      </div>
      <div class="admin-profiles-body">
        <label>
          <span>Login</span>
          <input id="newAdminLogin" autocomplete="off" placeholder="ex: coach" />
        </label>
        <label>
          <span>Data de aniversario</span>
          <input id="newAdminBirthday" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" autocomplete="bday" />
        </label>
        <p id="adminProfilesError" class="admin-profiles-error"></p>
        <button id="createAdminProfile" type="button" class="ctrl-btn ctrl-salvar">Criar admin</button>
        <ul id="adminProfilesList" class="admin-profiles-list"></ul>
      </div>
    </form>
  `;
  document.body.append(dialog);

  button.addEventListener("click", async () => {
    await getAdminProfilesOnline();
    renderAdminProfilesList();
    dialog.showModal();
  });

  dialog.querySelector("#createAdminProfile")?.addEventListener("click", async () => {
    const login = dialog.querySelector("#newAdminLogin")?.value;
    const birthday = dialog.querySelector("#newAdminBirthday")?.value;
    const result = await addAdminProfile(login, birthday);
    const error = dialog.querySelector("#adminProfilesError");
    if (!result.ok) {
      if (error) error.textContent = result.error;
      return;
    }
    if (error) error.textContent = result.warning || "";
    dialog.querySelector("#newAdminLogin").value = "";
    dialog.querySelector("#newAdminBirthday").value = "";
    renderAdminProfilesList();
  });
}

/* Badge de usuario + botao Sair */
document.addEventListener("DOMContentLoaded", () => {
  getAdminProfiles();
  getAdminProfilesOnline().then(() => renderAdminProfilesList()).catch(() => {});
  if (!isLoggedIn()) return;

  document.querySelectorAll(".btn-logout").forEach((btn) => {
    btn.addEventListener("click", logout);
    btn.textContent = "Sair";
  });

  const navRight = document.querySelector(".gd-nav-right");
  if (navRight && isLoggedIn()) {
    const badge = document.createElement("span");
    badge.className = `auth-badge${isSpectator() ? " auth-badge-spectator" : ""}`;
    badge.textContent = isSpectator() ? `VIS ${getUser()}` : `ADM ${getUser()}`;
    navRight.prepend(badge);
  }

  mountAdminProfileManager();
  applySpectatorMode();
});
