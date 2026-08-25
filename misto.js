/* Planejamento financeiro para eventos Soft Misto. */
const MISTO_KEY = "ttb_misto_v1";
const MISTO_UPDATED_KEY = "ttb_misto_updated_at";
const MISTO_REMOTE_ID = "ttb_misto_global";
const MISTO_ITEMS = [
  { id: "registration", label: "Inscrição" },
  { id: "breakfast", label: "Café da manhã" },
  { id: "lunch", label: "Almoço" },
  { id: "lodging", label: "Alojamento" },
  { id: "happyHour", label: "Happy hour (HH)" },
];

function _mistoDefault() {
  return { eventName: "", costs: Object.fromEntries(MISTO_ITEMS.map((item) => [item.id, 0])), choices: {}, participants: {} };
}
function _mistoLoad() {
  try { return { ..._mistoDefault(), ...JSON.parse(localStorage.getItem(MISTO_KEY) || "{}") }; }
  catch (_) { return _mistoDefault(); }
}
let _misto = _mistoLoad();
let _mistoSaveTimer = null;
function _mistoCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}
function _mistoNumber(value) { return Math.max(0, Number(String(value).replace(",", ".")) || 0); }
function _mistoPlayers() {
  const all = [...(window.LINEUP_DATA || []), ...(window.BENCH_DATA || [])];
  try { all.push(...(JSON.parse(localStorage.getItem("ttb_custom_players_v1")) || [])); } catch (_) {}
  const seen = new Set();
  return all.filter((p) => { const key = `${p.name}|${p.number || ""}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function _mistoPlayerKey(player) { return `${player.name}|${player.number || ""}`; }
function _mistoIsParticipant(player) { return Boolean(_misto.participants?.[_mistoPlayerKey(player)]); }
function _mistoQuantity(key, item) {
  const value = _misto.choices?.[key]?.[item];
  return value === true ? 1 : Math.max(0, Math.floor(Number(value) || 0));
}
function _mistoPlayerTotal(key) { return MISTO_ITEMS.reduce((sum, item) => sum + (_mistoQuantity(key, item.id) * _mistoNumber(_misto.costs[item.id])), 0); }
function _mistoSave() {
  const updatedAt = new Date().toISOString();
  localStorage.setItem(MISTO_KEY, JSON.stringify(_misto));
  localStorage.setItem(MISTO_UPDATED_KEY, updatedAt);
  const status = document.getElementById("mistoSyncStatus");
  if (status) status.textContent = "Salvando…";
  clearTimeout(_mistoSaveTimer);
  _mistoSaveTimer = setTimeout(() => _mistoSaveRemote(updatedAt), 450);
}
async function _mistoSaveRemote(updatedAt) {
  if (typeof AUTH_SUPABASE_URL === "undefined") return;
  try {
    const res = await fetch(`${AUTH_SUPABASE_URL}/rest/v1/jogos?on_conflict=id`, {
      method: "POST", headers: { apikey: AUTH_SUPABASE_KEY, Authorization: `Bearer ${AUTH_SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: MISTO_REMOTE_ID, state: { misto: _misto, updated_at: updatedAt }, updated_at: updatedAt }),
    });
    if (!res.ok) throw new Error();
    document.getElementById("mistoSyncStatus").textContent = "Salvo e sincronizado";
  } catch (_) { document.getElementById("mistoSyncStatus").textContent = "Salvo neste aparelho"; }
}
async function _mistoLoadRemote() {
  if (typeof AUTH_SUPABASE_URL === "undefined") return;
  try {
    const res = await fetch(`${AUTH_SUPABASE_URL}/rest/v1/jogos?select=state,updated_at&id=eq.${MISTO_REMOTE_ID}`, { headers: { apikey: AUTH_SUPABASE_KEY, Authorization: `Bearer ${AUTH_SUPABASE_KEY}` } });
    const remote = (await res.json())[0];
    if (!remote?.state?.misto) { _mistoSaveRemote(localStorage.getItem(MISTO_UPDATED_KEY) || new Date().toISOString()); return; }
    const localTime = localStorage.getItem(MISTO_UPDATED_KEY) || "";
    const remoteTime = remote.updated_at || remote.state.updated_at || "";
    if (remoteTime > localTime) { _misto = { ..._mistoDefault(), ...remote.state.misto }; localStorage.setItem(MISTO_KEY, JSON.stringify(_misto)); localStorage.setItem(MISTO_UPDATED_KEY, remoteTime); _mistoRender(); }
    else if (localTime > remoteTime) _mistoSaveRemote(localTime);
    else document.getElementById("mistoSyncStatus").textContent = "Sincronizado";
  } catch (_) { document.getElementById("mistoSyncStatus").textContent = "Modo local"; }
}
function _mistoRender() {
  document.getElementById("mistoEventName").value = _misto.eventName;
  document.getElementById("mistoTitle").textContent = _misto.eventName || "Novo evento";
  const chooseBtn = document.getElementById("mistoChoosePlayers");
  if (chooseBtn) chooseBtn.textContent = `Selecionar jogadores (${_mistoPlayers().filter(_mistoIsParticipant).length})`;
  const costs = document.getElementById("mistoCostFields");
  costs.innerHTML = "";
  MISTO_ITEMS.forEach((item) => {
    const label = document.createElement("label"); label.className = "misto-cost-field";
    label.innerHTML = `<span>${item.label}</span><div><b>R$</b><input inputmode="decimal" type="number" min="0" step="0.01" value="${_mistoNumber(_misto.costs[item.id])}" aria-label="Valor de ${item.label}" /></div><em data-cost-total="${item.id}">0 pessoas · R$ 0,00</em>`;
    label.querySelector("input").addEventListener("input", (event) => { _misto.costs[item.id] = _mistoNumber(event.target.value); _mistoSave(); _mistoRenderTable(); }); costs.append(label);
  });
  _mistoRenderTable();
  _mistoRenderPlayerPicker();
}
function _mistoRenderPlayerPicker() {
  const picker = document.getElementById("mistoPlayerPicker"); if (!picker) return;
  picker.innerHTML = "";
  _mistoPlayers().forEach((player) => {
    const key = _mistoPlayerKey(player);
    const label = document.createElement("label"); label.className = "misto-picker-player";
    label.innerHTML = `<span><strong>${player.name}</strong>${player.number ? `<small>#${player.number}</small>` : ""}</span><input type="checkbox" ${_mistoIsParticipant(player) ? "checked" : ""} aria-label="Incluir ${player.name}" /><i></i>`;
    label.querySelector("input").addEventListener("change", (event) => { _misto.participants[key] = event.target.checked; _mistoSave(); _mistoRenderTable(); });
    picker.append(label);
  });
}
function _mistoRenderTable() {
  const body = document.getElementById("mistoPlayersBody"); body.innerHTML = "";
  let grandTotal = 0, people = 0;
  const itemCounts = Object.fromEntries(MISTO_ITEMS.map((item) => [item.id, 0]));
  const participants = _mistoPlayers().filter(_mistoIsParticipant);
  const chooseBtn = document.getElementById("mistoChoosePlayers");
  if (chooseBtn) chooseBtn.textContent = `Selecionar jogadores (${participants.length})`;
  if (!participants.length) {
    body.innerHTML = `<tr><td class="misto-empty" colspan="7">Nenhum jogador selecionado. Use “Selecionar jogadores” para montar o grupo do Misto.</td></tr>`;
  }
  participants.forEach((player) => {
    const key = _mistoPlayerKey(player); const total = _mistoPlayerTotal(key); const selected = MISTO_ITEMS.some((item) => _mistoQuantity(key, item.id) > 0);
    if (selected) { grandTotal += total; people++; }
    MISTO_ITEMS.forEach((item) => { itemCounts[item.id] += _mistoQuantity(key, item.id); });
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="misto-player-name"><strong>${player.name}</strong>${player.number ? `<small>#${player.number}</small>` : ""}</td>${MISTO_ITEMS.map((item) => `<td data-label="${item.label}"><label class="misto-quantity"><input type="number" min="0" step="1" inputmode="numeric" data-item="${item.id}" value="${_mistoQuantity(key, item.id)}" aria-label="Quantidade de ${item.label} para ${player.name}" /></label></td>`).join("")}<td class="misto-player-total" data-label="Deve pagar">${_mistoCurrency(total)}</td>`;
    tr.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { _misto.choices[key] ||= {}; _misto.choices[key][input.dataset.item] = Math.max(0, Math.floor(Number(input.value) || 0)); _mistoSave(); _mistoRenderTable(); })); body.append(tr);
  });
  document.getElementById("mistoGrandTotal").textContent = _mistoCurrency(grandTotal);
  document.getElementById("mistoPeopleCount").textContent = participants.length;
  MISTO_ITEMS.forEach((item) => {
    const total = itemCounts[item.id] * _mistoNumber(_misto.costs[item.id]);
    const el = document.querySelector(`[data-cost-total="${item.id}"]`);
    if (el) el.textContent = `${itemCounts[item.id]} ${itemCounts[item.id] === 1 ? "unidade" : "unidades"} · ${_mistoCurrency(total)}`;
  });
}
document.addEventListener("DOMContentLoaded", () => {
  if (document.documentElement.dataset.page !== "misto") return;
  document.getElementById("mistoEventName").addEventListener("input", (event) => { _misto.eventName = event.target.value; document.getElementById("mistoTitle").textContent = _misto.eventName || "Novo evento"; _mistoSave(); });
  const drawer = document.getElementById("mistoPlayersDrawer");
  const closePicker = () => { drawer.classList.remove("is-open"); drawer.setAttribute("aria-hidden", "true"); };
  document.getElementById("mistoChoosePlayers").addEventListener("click", () => { _mistoRenderPlayerPicker(); drawer.classList.add("is-open"); drawer.setAttribute("aria-hidden", "false"); });
  document.getElementById("mistoClosePlayers").addEventListener("click", closePicker);
  document.getElementById("mistoDonePlayers").addEventListener("click", closePicker);
  drawer.addEventListener("click", (event) => { if (event.target === drawer) closePicker(); });
  _mistoRender(); _mistoLoadRemote();
});
