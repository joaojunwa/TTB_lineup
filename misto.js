/* Planejamento financeiro para eventos Soft Misto. */
const MISTO_KEY = "ttb_misto_v1";
const MISTO_UPDATED_KEY = "ttb_misto_updated_at";
const MISTO_REMOTE_ID = "ttb_misto_global";
const MISTO_ITEMS = [
  { id: "registration", label: "Inscrição", shared: true },
  { id: "breakfastSaturday", label: "Café (sábado)", costKey: "breakfast" },
  { id: "breakfastSunday", label: "Café (domingo)", costKey: "breakfast" },
  { id: "lunchSaturday", label: "Almoço (sábado)", costKey: "lunch" },
  { id: "lunchSunday", label: "Almoço (domingo)", costKey: "lunch" },
  { id: "lodging", label: "Alojamento", shared: true },
  { id: "happyHour", label: "Happy hour (HH)" },
];
const MISTO_COST_ITEMS = [
  { id: "registration", label: "Inscrição", shared: true },
  { id: "breakfast", label: "Café (sábado e domingo)" },
  { id: "lunch", label: "Almoço (sábado e domingo)" },
  { id: "lodging", label: "Alojamento", shared: true },
  { id: "happyHour", label: "Happy hour (HH)" },
];

function _mistoDefault() {
  return { eventName: "", costs: Object.fromEntries(MISTO_COST_ITEMS.map((item) => [item.id, 0])), choices: {}, participants: {} };
}
function _mistoNormalizeState(state = {}) {
    const loaded = { ..._mistoDefault(), ...state };
    loaded.costs = { ..._mistoDefault().costs, ...(loaded.costs || {}) };
    if (loaded.costs.breakfast === 0) loaded.costs.breakfast = loaded.costs.breakfastSaturday || loaded.costs.breakfastSunday || 0;
    if (loaded.costs.lunch === 0) loaded.costs.lunch = loaded.costs.lunchSaturday || loaded.costs.lunchSunday || 0;
    Object.values(loaded.choices || {}).forEach((choice) => {
      if (choice.breakfast !== undefined && choice.breakfastSaturday === undefined) choice.breakfastSaturday = choice.breakfast;
      if (choice.lunch !== undefined && choice.lunchSaturday === undefined) choice.lunchSaturday = choice.lunch;
    });
    return loaded;
}
function _mistoLoad() {
  try { return _mistoNormalizeState(JSON.parse(localStorage.getItem(MISTO_KEY) || "{}")); }
  catch (_) { return _mistoDefault(); }
}
let _misto = _mistoLoad();
let _mistoSaveTimer = null;
let _mistoPickerFilter = "";
let _mistoTableFilter = "";
function _mistoNormalize(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function _mistoApplyPickerFilter() {
  const term = _mistoNormalize(_mistoPickerFilter);
  document.querySelectorAll("#mistoPlayerPicker .misto-picker-player").forEach((el) => {
    el.classList.toggle("is-filtered-out", Boolean(term) && !_mistoNormalize(el.dataset.name).includes(term));
  });
}
function _mistoApplyTableFilter() {
  const term = _mistoNormalize(_mistoTableFilter);
  document.querySelectorAll("#mistoPlayersBody tr[data-name]").forEach((el) => {
    el.classList.toggle("is-filtered-out", Boolean(term) && !_mistoNormalize(el.dataset.name).includes(term));
  });
}
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
function _mistoSlug(value) { return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function _mistoIsParticipant(player) { return Boolean(_misto.participants?.[_mistoPlayerKey(player)]); }
function _mistoQuantity(key, item) {
  const value = _misto.choices?.[key]?.[item];
  return value === true ? 1 : Math.max(0, Math.floor(Number(value) || 0));
}
function _mistoItemCost(item) { return _mistoNumber(_misto.costs[item.costKey || item.id]); }
function _mistoItemUnits(itemId) {
  return _mistoPlayers().filter((player) => _mistoIsParticipant(player) && _mistoQuantity(_mistoPlayerKey(player), itemId) > 0).length;
}
function _mistoPlayerTotal(key) {
  return MISTO_ITEMS.reduce((sum, item) => {
    const quantity = _mistoQuantity(key, item.id);
    const value = _mistoItemCost(item);
    if (!item.shared) return sum + quantity * value;
    const units = _mistoItemUnits(item.id);
    return sum + (quantity > 0 && units ? value / units : 0);
  }, 0);
}
function _mistoFinancialSummary() {
  const participants = _mistoPlayers().filter(_mistoIsParticipant);
  const itemCounts = Object.fromEntries(MISTO_ITEMS.map((item) => [item.id, 0]));
  const rows = participants.map((player) => {
    const key = _mistoPlayerKey(player);
    MISTO_ITEMS.forEach((item) => { itemCounts[item.id] += item.shared ? Number(_mistoQuantity(key, item.id) > 0) : _mistoQuantity(key, item.id); });
    return { player, key, total: _mistoPlayerTotal(key) };
  });
  return { participants, itemCounts, rows, total: rows.reduce((sum, row) => sum + row.total, 0) };
}
function _mistoExportPNG() {
  const summary = _mistoFinancialSummary();
  const width = 1080, padding = 54, headerH = 132, orderH = 176, rowH = 48, footerH = 52;
  const height = headerH + orderH + Math.max(1, summary.rows.length) * rowH + footerH + padding;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080f1e"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f6c347"; ctx.font = "700 31px Arial"; ctx.fillText("TTB Baseball — Soft Misto", padding, 52);
  ctx.fillStyle = "#f0ead8"; ctx.font = "700 24px Arial"; ctx.fillText(_misto.eventName || "Resumo do evento", padding, 86);
  ctx.fillStyle = "#8190a8"; ctx.font = "16px Arial"; ctx.textAlign = "right"; ctx.fillText(new Date().toLocaleDateString("pt-BR"), width - padding, 52); ctx.textAlign = "left";
  ctx.fillStyle = "#4de076"; ctx.font = "700 20px Arial"; ctx.fillText(`VALOR DA INSCRIÇÃO  ${_mistoCurrency(_misto.costs.registration)}`, padding, 116);
  ctx.fillStyle = "#aebbd0"; ctx.font = "700 18px Arial"; ctx.fillText(`PARTICIPANTES  ${summary.participants.length}`, padding + 420, 116);
  ctx.fillStyle = "#111c2e"; ctx.fillRect(padding, headerH, width - padding * 2, orderH - 18);
  ctx.fillStyle = "#f6c347"; ctx.font = "700 14px Arial"; ctx.fillText("RESUMO PARA PEDIR", padding + 18, headerH + 28);
  const orderItems = MISTO_ITEMS.filter((item) => item.id !== "registration");
  orderItems.forEach((item, index) => {
    const x = padding + 18 + (index % 3) * 310;
    const itemY = headerH + 59 + Math.floor(index / 3) * 52;
    const quantity = summary.itemCounts[item.id];
    ctx.fillStyle = "#aebbd0"; ctx.font = "600 14px Arial"; ctx.fillText(item.label.toUpperCase(), x, itemY);
    ctx.fillStyle = "#f0ead8"; ctx.font = "700 24px Arial"; ctx.fillText(String(quantity), x, itemY + 29);
    ctx.fillStyle = "#8190a8"; ctx.font = "13px Arial"; ctx.fillText(quantity === 1 ? "unidade" : "unidades", x + 25, itemY + 27);
  });
  let y = headerH + orderH;
  ctx.fillStyle = "#172338"; ctx.fillRect(padding, y, width - padding * 2, 38);
  ctx.fillStyle = "#8190a8"; ctx.font = "700 13px Arial";
  ctx.fillText("PARTICIPANTE", padding + 16, y + 24); ctx.fillText("ITENS", padding + 370, y + 24); ctx.textAlign = "right"; ctx.fillText("DEVE PAGAR", width - padding - 16, y + 24); ctx.textAlign = "left";
  y += 38;
  if (!summary.rows.length) {
    ctx.fillStyle = "#111c2e"; ctx.fillRect(padding, y, width - padding * 2, rowH);
    ctx.fillStyle = "#8190a8"; ctx.font = "16px Arial"; ctx.fillText("Nenhum participante selecionado.", padding + 16, y + 30); y += rowH;
  }
  summary.rows.forEach((row, index) => {
    ctx.fillStyle = index % 2 ? "#0d1727" : "#101c2c"; ctx.fillRect(padding, y, width - padding * 2, rowH);
    const shortLabels = { registration: "Inscr.", breakfastSaturday: "Café sáb.", breakfastSunday: "Café dom.", lunchSaturday: "Almoço sáb.", lunchSunday: "Almoço dom.", lodging: "Aloj.", happyHour: "HH" };
    const consumption = MISTO_ITEMS
      .map((item) => ({ item, quantity: _mistoQuantity(row.key, item.id) }))
      .filter(({ quantity }) => quantity > 0)
      .map(({ item, quantity }) => `${shortLabels[item.id]}${quantity > 1 ? ` ×${quantity}` : ""}`)
      .join("  ·  ") || "—";
    ctx.fillStyle = "#f0ead8"; ctx.font = "600 17px Arial"; ctx.fillText(row.player.name + (row.player.number ? `  #${row.player.number}` : ""), padding + 16, y + 30);
    ctx.fillStyle = "#aebbd0"; ctx.font = "14px Arial"; ctx.fillText(consumption, padding + 370, y + 29);
    ctx.fillStyle = "#4de076"; ctx.font = "700 17px Arial"; ctx.textAlign = "right"; ctx.fillText(_mistoCurrency(row.total), width - padding - 16, y + 30); ctx.textAlign = "left";
    y += rowH;
  });
  ctx.fillStyle = "#56657d"; ctx.font = "14px Arial"; ctx.fillText("Inscrição total dividida entre quem está marcado na inscrição.", padding, height - 24);
  const link = document.createElement("a"); link.download = `ttb-misto-${_mistoSlug(_misto.eventName || "resumo") || "resumo"}.png`; link.href = canvas.toDataURL("image/png"); link.click();
}
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
    if (remoteTime > localTime) { _misto = _mistoNormalizeState(remote.state.misto); localStorage.setItem(MISTO_KEY, JSON.stringify(_misto)); localStorage.setItem(MISTO_UPDATED_KEY, remoteTime); _mistoRender(); }
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
  MISTO_COST_ITEMS.forEach((item) => {
    const label = document.createElement("label"); label.className = "misto-cost-field";
    label.innerHTML = `<span>${item.label}${item.shared ? " (total)" : ""}</span><div><b>R$</b><input inputmode="decimal" type="number" min="0" step="0.01" value="${_mistoNumber(_misto.costs[item.id])}" aria-label="Valor de ${item.label}" /></div><em data-cost-total="${item.id}">${item.shared ? "Dividido entre participantes" : "0 unidades · R$ 0,00"}</em>`;
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
    label.dataset.name = `${player.name} ${player.number || ""}`;
    label.innerHTML = `<span><strong>${player.name}</strong>${player.number ? `<small>#${player.number}</small>` : ""}</span><input type="checkbox" ${_mistoIsParticipant(player) ? "checked" : ""} aria-label="Incluir ${player.name}" /><i></i>`;
    label.querySelector("input").addEventListener("change", (event) => {
      _misto.participants[key] = event.target.checked;
      if (event.target.checked && !_mistoQuantity(key, "registration")) {
        _misto.choices[key] ||= {};
        _misto.choices[key].registration = 1;
      }
      _mistoSave(); _mistoRenderTable();
    });
    picker.append(label);
  });
  _mistoApplyPickerFilter();
}
function _mistoRenderTable() {
  const body = document.getElementById("mistoPlayersBody"); body.innerHTML = "";
  let grandTotal = 0, people = 0;
  const itemCounts = Object.fromEntries(MISTO_ITEMS.map((item) => [item.id, 0]));
  const participants = _mistoPlayers().filter(_mistoIsParticipant);
  const chooseBtn = document.getElementById("mistoChoosePlayers");
  if (chooseBtn) chooseBtn.textContent = `Selecionar jogadores (${participants.length})`;
  if (!participants.length) {
    body.innerHTML = `<tr><td class="misto-empty" colspan="9">Nenhum jogador selecionado. Use “Selecionar jogadores” para montar o grupo do Misto.</td></tr>`;
  }
  participants.forEach((player) => {
    const key = _mistoPlayerKey(player); const total = _mistoPlayerTotal(key); const selected = MISTO_ITEMS.some((item) => _mistoQuantity(key, item.id) > 0);
    if (selected) { grandTotal += total; people++; }
    MISTO_ITEMS.forEach((item) => { itemCounts[item.id] += item.shared ? Number(_mistoQuantity(key, item.id) > 0) : _mistoQuantity(key, item.id); });
    const tr = document.createElement("tr");
    tr.dataset.name = `${player.name} ${player.number || ""}`;
    tr.innerHTML = `<td class="misto-player-name"><strong>${player.name}</strong>${player.number ? `<small>#${player.number}</small>` : ""}</td>${MISTO_ITEMS.map((item) => `<td data-label="${item.label}"><label class="misto-quantity"><input type="number" min="0" ${item.shared ? "max=1" : ""} step="1" inputmode="numeric" data-item="${item.id}" data-shared="${item.shared ? "true" : "false"}" value="${item.shared ? Number(_mistoQuantity(key, item.id) > 0) : _mistoQuantity(key, item.id)}" aria-label="Quantidade de ${item.label} para ${player.name}" /></label></td>`).join("")}<td class="misto-player-total" data-label="Deve pagar">${_mistoCurrency(total)}</td>`;
    tr.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { _misto.choices[key] ||= {}; const quantity = Math.max(0, Math.floor(Number(input.value) || 0)); _misto.choices[key][input.dataset.item] = input.dataset.shared === "true" ? Number(quantity > 0) : quantity; _mistoSave(); _mistoRenderTable(); })); body.append(tr);
  });
  document.getElementById("mistoGrandTotal").textContent = _mistoCurrency(_misto.costs.registration);
  document.getElementById("mistoPeopleCount").textContent = participants.length;
  MISTO_COST_ITEMS.forEach((item) => {
    const quantity = MISTO_ITEMS
      .filter((source) => (source.costKey || source.id) === item.id)
      .reduce((sum, source) => sum + itemCounts[source.id], 0);
    const total = item.shared ? (quantity ? _mistoNumber(_misto.costs[item.id]) : 0) : quantity * _mistoNumber(_misto.costs[item.id]);
    const el = document.querySelector(`[data-cost-total="${item.id}"]`);
    if (el) el.textContent = item.shared ? `${quantity} ${quantity === 1 ? "cota" : "cotas"} · ${_mistoCurrency(total)} dividido` : `${quantity} ${quantity === 1 ? "unidade" : "unidades"} · ${_mistoCurrency(total)}`;
  });
  const orderSummary = document.getElementById("mistoOrderSummary");
  if (orderSummary) {
    orderSummary.innerHTML = MISTO_ITEMS.filter((item) => item.id !== "registration").map((item) => {
      const quantity = itemCounts[item.id];
      return `<div><span>${item.label}</span><strong>${quantity}</strong><small>${quantity === 1 ? "unidade" : "unidades"}</small></div>`;
    }).join("");
  }
  _mistoApplyTableFilter();
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
  document.getElementById("mistoPlayerSearch").addEventListener("input", (event) => { _mistoPickerFilter = event.target.value; _mistoApplyPickerFilter(); });
  document.getElementById("mistoTableSearch").addEventListener("input", (event) => { _mistoTableFilter = event.target.value; _mistoApplyTableFilter(); });
  document.getElementById("mistoExportPng").addEventListener("click", _mistoExportPNG);
  window.loadCustomPlayers?.();
  document.getElementById("mistoAddPlayer").addEventListener("submit", (event) => {
    event.preventDefault();
    const nameInput = document.getElementById("mistoNewPlayerName");
    const numberInput = document.getElementById("mistoNewPlayerNumber");
    const positionInput = document.getElementById("mistoNewPlayerPosition");
    const name = nameInput.value.trim();
    if (!name) return;
    const number = numberInput.value.trim();
    const players = (() => { try { return JSON.parse(localStorage.getItem("ttb_custom_players_v1")) || []; } catch (_) { return []; } })();
    const alreadyExists = _mistoPlayers().some((player) => player.name.trim().toLowerCase() === name.toLowerCase() && String(player.number || "") === number);
    if (alreadyExists) { nameInput.setCustomValidity("Esse jogador já está no elenco."); nameInput.reportValidity(); nameInput.setCustomValidity(""); return; }
    const position = positionInput.value.trim();
    const player = { id: `custom-${Date.now()}-${_mistoSlug(name)}`, name, number, position, photo: "", positionTags: position ? [position] : [] };
    players.push(player);
    localStorage.setItem("ttb_custom_players_v1", JSON.stringify(players));
    window.addSharedCustomPlayer?.(player);
    nameInput.value = ""; numberInput.value = ""; positionInput.value = "";
    _mistoRender();
  });
  _mistoRender(); _mistoLoadRemote();
  window.loadCustomPlayersRemote?.().then(() => _mistoRender());
});
