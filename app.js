const PAGE = document.documentElement.dataset.page || "lineup";

const positions = [
  { id: "P", label: "Pitcher", short: "P", x: 56, y: 62 },
  { id: "C", label: "Catcher", short: "C", x: 52, y: 88 },
  { id: "1B", label: "Primeira base", short: "1B", x: 82, y: 60 },
  { id: "2B", label: "Segunda base", short: "2B", x: 68, y: 42 },
  { id: "3B", label: "Terceira base", short: "3B", x: 18, y: 58 },
  { id: "SS", label: "Shortstop", short: "SS", x: 36, y: 43 },
  { id: "LF", label: "Left field", short: "LF", x: 18, y: 16 },
  { id: "CF", label: "Center field", short: "CF", x: 50, y: 10 },
  { id: "RF", label: "Right field", short: "RF", x: 78, y: 17 },
];

const dhPosition = { id: "DH", label: "Designated hitter", short: "DH" };

const starters = Array.isArray(window.LINEUP_DATA) ? window.LINEUP_DATA : [];
const bench = Array.isArray(window.BENCH_DATA) ? window.BENCH_DATA : [];
const roster = buildRoster(starters, bench);

let selectedPlayerId = roster[0]?.id ?? "";
let assignments = buildEmptyAssignments();
let battingOrders = {};
let dhEnabled = false;
let dhAssignment = "";
let draggedPlayerId = "";
let lineupPending = new Set();
let bancoPlayers = new Set();
let rosterSearchTerm = "";
let positionFilter = "";
let designatedPitcherId = "";
const CUSTOM_PLAYERS_KEY = "ttb_custom_players_v1";
let customPlayers = [];
const PLAYER_TAGS_KEY = "ttb_player_tags_v1";
let playerTags = {};
const PLAYER_STATS_KEY = "ttb_player_stats_v2";
const PLAYER_STATS_UPDATED_KEY = "ttb_player_stats_updated_at";
const PLAYER_STATS_REMOTE_ID = "ttb_player_stats_global";
const APP_LIVE_BP_PLAYER_STATS_KEY = "ttb_live_bp_player_stats_v1";
const APP_LIVE_BP_PLAYER_STATS_UPDATED_KEY = "ttb_live_bp_player_stats_updated_at";
const APP_LIVE_BP_PLAYER_STATS_REMOTE_ID = "ttb_live_bp_player_stats_global";
const APP_STATS_GAME_TO_LIVE_BP_MIGRATION_KEY = "ttb_stats_game_to_livebp_migration_2026_06_01";
const APP_STATS_GAME_TO_LIVE_BP_REMOTE_KEY = "ttb_stats_game_to_livebp_remote_2026_06_01";
const APP_STATS_GAME_TO_LIVE_BP_BACKUP_GAME_KEY = "ttb_player_stats_v2_backup_before_livebp_move_2026_06_01";
const APP_STATS_GAME_TO_LIVE_BP_BACKUP_LIVE_BP_KEY = "ttb_live_bp_player_stats_v1_backup_before_livebp_move_2026_06_01";
const ACTIVE_STATUS_GAME_ID = "ttb_jogo_ativo";
let playerStatsSaveTimer = null;
let activeGameLineupSaveTimer = null;

const POSITION_TOOLTIPS = {
  P:  "Pitcher",
  C:  "Catcher",
  IF: "Infield (1B, 2B, 3B, SS)",
  OF: "Outfield (LF, CF, RF)",
  UT: "Utility — pode jogar em várias posições",
};

function getPlayerAvg(playerId) {
  try {
    const stats = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY)) || {};
    const s = stats[playerId];
    const officialAb = getOfficialAtBats(s);
    if (!s || !officialAb) return null;
    return s.h / officialAb;
  } catch (_) {
    return null;
  }
}

function formatPlayerAvg(playerId) {
  const avg = getPlayerAvg(playerId);
  if (avg === null) return null;
  return avg.toFixed(3).replace(/^0/, "");
}

function canSaveRemotePlayerStats() {
  return typeof AUTH_SUPABASE_URL !== "undefined" && typeof AUTH_SUPABASE_KEY !== "undefined";
}

async function saveRemoteStatsById(remoteId, stats, updatedAt) {
  if (!canSaveRemotePlayerStats()) return;
  const res = await fetch(`${AUTH_SUPABASE_URL}/rest/v1/jogos?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: AUTH_SUPABASE_KEY,
      Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: remoteId,
      state: { stats: JSON.parse(JSON.stringify(stats || {})), updated_at: updatedAt },
      updated_at: updatedAt,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function fetchRemoteStatsById(remoteId) {
  if (!canSaveRemotePlayerStats()) return null;
  const res = await fetch(
    `${AUTH_SUPABASE_URL}/rest/v1/jogos?select=state,updated_at&id=eq.${encodeURIComponent(remoteId)}`,
    {
      headers: {
        apikey: AUTH_SUPABASE_KEY,
        Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  const row = rows[0];
  if (!row?.state) return null;
  return {
    stats: row.state.stats || {},
    updatedAt: row.updated_at || row.state.updated_at || "",
  };
}

function saveRemotePlayerStats(stats, updatedAt) {
  if (!canSaveRemotePlayerStats()) return;
  clearTimeout(playerStatsSaveTimer);
  const snapshot = JSON.parse(JSON.stringify(stats || {}));
  playerStatsSaveTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${AUTH_SUPABASE_URL}/rest/v1/jogos?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: AUTH_SUPABASE_KEY,
          Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          id: PLAYER_STATS_REMOTE_ID,
          state: { stats: snapshot, updated_at: updatedAt },
          updated_at: updatedAt,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.warn("Erro ao salvar stats gerais:", err);
    }
  }, 500);
}

function recordSitePlayerStat(playerId, field, amount = 1) {
  if (!playerId || !["ab", "h", "bb", "hbp", "k", "hr"].includes(field)) return;
  try {
    const stats = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY)) || {};
    if (!stats[playerId]) stats[playerId] = { h: 0, ab: 0, bb: 0, hbp: 0, k: 0, hr: 0 };
    stats[playerId][field] = (stats[playerId][field] || 0) + amount;
    const updatedAt = new Date().toISOString();
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(stats));
    localStorage.setItem(PLAYER_STATS_UPDATED_KEY, updatedAt);
    saveRemotePlayerStats(stats, updatedAt);
  } catch (_) {}
}

async function syncSitePlayerStatsFromRemote() {
  if (!canSaveRemotePlayerStats()) return;
  try {
    const res = await fetch(
      `${AUTH_SUPABASE_URL}/rest/v1/jogos?select=state,updated_at&id=eq.${encodeURIComponent(PLAYER_STATS_REMOTE_ID)}`,
      {
        headers: {
          apikey: AUTH_SUPABASE_KEY,
          Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
        },
      },
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    const row = rows[0];
    const remoteStats = row?.state?.stats;
    if (!remoteStats || Object.keys(remoteStats).length === 0) return;

    const localUpdated = localStorage.getItem(PLAYER_STATS_UPDATED_KEY) || "";
    const remoteUpdated = row.updated_at || row.state.updated_at || "";
    if (!localUpdated || !remoteUpdated || remoteUpdated >= localUpdated) {
      localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(remoteStats));
      if (remoteUpdated) localStorage.setItem(PLAYER_STATS_UPDATED_KEY, remoteUpdated);
    }
  } catch (err) {
    console.warn("Stats gerais em modo local:", err);
  }
}

function loadStatsMap(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch (_) { return {}; }
}

function hasPlayerStatData(stat = {}) {
  return (stat.ab || 0) > 0 || (stat.h || 0) > 0 || (stat.bb || 0) > 0 || (stat.hbp || 0) > 0 || (stat.k || 0) > 0 || (stat.hr || 0) > 0;
}

function hasAnyPlayerStats(stats = {}) {
  return Object.values(stats || {}).some((stat) => hasPlayerStatData(stat));
}

function normalizePlayerStat(stat = {}) {
  return {
    h: Math.max(0, Number(stat.h || stat.hits || 0) || 0),
    ab: Math.max(0, Number(stat.ab || 0) || 0),
    bb: Math.max(0, Number(stat.bb || 0) || 0),
    hbp: Math.max(0, Number(stat.hbp || stat.hitByPitch || 0) || 0),
    k: Math.max(0, Number(stat.k || 0) || 0),
    hr: Math.max(0, Number(stat.hr || stat.homeRuns || 0) || 0),
  };
}

function addPlayerStats(target, id, stat = {}) {
  if (!target[id]) target[id] = { h: 0, ab: 0, bb: 0, hbp: 0, k: 0, hr: 0 };
  target[id].h += stat.h || stat.hits || 0;
  target[id].ab += stat.ab || 0;
  target[id].bb += stat.bb || 0;
  target[id].hbp += stat.hbp || stat.hitByPitch || 0;
  target[id].k += stat.k || 0;
  target[id].hr += stat.hr || stat.homeRuns || 0;
}

function mergePlayerStats(base = {}, incoming = {}) {
  const merged = {};
  Object.entries(base || {}).forEach(([id, stat]) => {
    merged[id] = normalizePlayerStat(stat);
  });
  Object.entries(incoming || {}).forEach(([id, stat]) => {
    addPlayerStats(merged, id, stat);
  });
  return merged;
}

function containsPlayerStats(container = {}, incoming = {}) {
  return Object.entries(incoming || {}).every(([id, stat]) => {
    const current = normalizePlayerStat(container[id] || {});
    const needed = normalizePlayerStat(stat);
    return current.h >= needed.h && current.ab >= needed.ab && current.bb >= needed.bb && current.hbp >= needed.hbp && current.k >= needed.k && current.hr >= needed.hr;
  });
}

function backupStatsMapOnce(key, stats) {
  try {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(stats || {}));
  } catch (_) {}
}

function moveExistingGameStatsToLiveBpLocal() {
  try {
    if (localStorage.getItem(APP_STATS_GAME_TO_LIVE_BP_MIGRATION_KEY) === "done") {
      moveExistingGameStatsToLiveBpRemote()
        .catch((err) => console.warn("Erro ao migrar stats remotos para Live BP:", err));
      return false;
    }

    const now = new Date().toISOString();
    const gameStats = loadStatsMap(PLAYER_STATS_KEY);
    const liveBpStats = loadStatsMap(APP_LIVE_BP_PLAYER_STATS_KEY);
    const shouldMoveStats = hasAnyPlayerStats(gameStats);

    backupStatsMapOnce(APP_STATS_GAME_TO_LIVE_BP_BACKUP_GAME_KEY, gameStats);
    backupStatsMapOnce(APP_STATS_GAME_TO_LIVE_BP_BACKUP_LIVE_BP_KEY, liveBpStats);

    if (shouldMoveStats) {
      const movedLiveBpStats = containsPlayerStats(liveBpStats, gameStats)
        ? liveBpStats
        : mergePlayerStats(liveBpStats, gameStats);
      localStorage.setItem(APP_LIVE_BP_PLAYER_STATS_KEY, JSON.stringify(movedLiveBpStats));
      localStorage.setItem(APP_LIVE_BP_PLAYER_STATS_UPDATED_KEY, now);
    }

    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify({}));
    localStorage.setItem(PLAYER_STATS_UPDATED_KEY, now);
    localStorage.setItem(APP_STATS_GAME_TO_LIVE_BP_MIGRATION_KEY, "done");

    moveExistingGameStatsToLiveBpRemote()
      .catch((err) => console.warn("Erro ao migrar stats remotos para Live BP:", err));

    return shouldMoveStats;
  } catch (err) {
    console.warn("Migracao local dos stats para Live BP falhou:", err);
    return false;
  }
}

async function moveExistingGameStatsToLiveBpRemote() {
  if (!canSaveRemotePlayerStats()) return;
  if (localStorage.getItem(APP_STATS_GAME_TO_LIVE_BP_REMOTE_KEY) === "done") return;

  const now = new Date().toISOString();
  const [remoteGame, remoteLiveBp] = await Promise.all([
    fetchRemoteStatsById(PLAYER_STATS_REMOTE_ID),
    fetchRemoteStatsById(APP_LIVE_BP_PLAYER_STATS_REMOTE_ID),
  ]);
  const remoteGameStats = remoteGame?.stats || {};
  const remoteLiveBpStats = remoteLiveBp?.stats || {};

  if (hasAnyPlayerStats(remoteGameStats)) {
    const movedLiveBpStats = containsPlayerStats(remoteLiveBpStats, remoteGameStats)
      ? remoteLiveBpStats
      : mergePlayerStats(remoteLiveBpStats, remoteGameStats);
    const currentLocalLiveBpStats = loadStatsMap(APP_LIVE_BP_PLAYER_STATS_KEY);
    const localLiveBpStats = containsPlayerStats(currentLocalLiveBpStats, remoteGameStats)
      ? currentLocalLiveBpStats
      : mergePlayerStats(currentLocalLiveBpStats, remoteGameStats);
    localStorage.setItem(APP_LIVE_BP_PLAYER_STATS_KEY, JSON.stringify(localLiveBpStats));
    localStorage.setItem(APP_LIVE_BP_PLAYER_STATS_UPDATED_KEY, now);
    await saveRemoteStatsById(APP_LIVE_BP_PLAYER_STATS_REMOTE_ID, movedLiveBpStats, now);
  } else if (!hasAnyPlayerStats(remoteLiveBpStats)) {
    const localLiveBpStats = loadStatsMap(APP_LIVE_BP_PLAYER_STATS_KEY);
    if (hasAnyPlayerStats(localLiveBpStats)) {
      await saveRemoteStatsById(APP_LIVE_BP_PLAYER_STATS_REMOTE_ID, localLiveBpStats, now);
    }
  }

  const currentGameStats = loadStatsMap(PLAYER_STATS_KEY);
  if (hasAnyPlayerStats(currentGameStats)) {
    await saveRemoteStatsById(PLAYER_STATS_REMOTE_ID, currentGameStats, new Date().toISOString());
  } else {
    await saveRemoteStatsById(PLAYER_STATS_REMOTE_ID, {}, now);
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify({}));
    localStorage.setItem(PLAYER_STATS_UPDATED_KEY, now);
  }
  localStorage.setItem(APP_STATS_GAME_TO_LIVE_BP_REMOTE_KEY, "done");
}

moveExistingGameStatsToLiveBpLocal();

function saveLineupState() {
  try {
    if (document.body.classList.contains("is-viewing-other")) return;
    const snapshot = getLineupStateSnapshot();
    localStorage.setItem("ttb_lineup_" + getUser(), JSON.stringify(snapshot));
    if (typeof autosaveLineup === "function") autosaveLineup();
    scheduleActiveGameLineupSync(snapshot);
  } catch (_) {}
}

function loadLineupState() {
  try {
    const raw = localStorage.getItem("ttb_lineup_" + getUser());
    if (!raw) return;
    applyLineupStateSnapshot(JSON.parse(raw), { persist: false });
  } catch (_) {}
}

function getLineupStateSnapshot() {
  return {
    updatedAt: new Date().toISOString(),
    assignments: { ...assignments },
    battingOrders: { ...battingOrders },
    lineupPending: [...lineupPending],
    bancoPlayers:  [...bancoPlayers],
    dhEnabled,
    dhAssignment,
    designatedPitcherId,
    customPlayers: JSON.parse(JSON.stringify(customPlayers || [])),
    playerTags: JSON.parse(JSON.stringify(playerTags || {})),
  };
}

function applyLineupStateSnapshot(state, options = {}) {
  if (!state || typeof state !== "object") return;
  if (options.respectLocalUpdated) {
    try {
      const local = JSON.parse(localStorage.getItem("ttb_lineup_" + getUser()) || "null");
      const localUpdated = local?.updatedAt || "";
      const remoteUpdated = state.updatedAt || "";
      if (localUpdated && (!remoteUpdated || localUpdated > remoteUpdated)) return;
    } catch (_) {}
  }
  if (Array.isArray(state.customPlayers)) {
    state.customPlayers.forEach((cp) => {
      if (!cp?.id || roster.some((p) => p.id === cp.id)) return;
      customPlayers.push(cp);
      roster.push({ ...cp, group: "Elenco", battingOrder: "" });
    });
    saveCustomPlayers();
  }
  if (state.playerTags && typeof state.playerTags === "object") {
    playerTags = { ...playerTags, ...state.playerTags };
    roster.forEach((p) => {
      if (playerTags[p.id]) p.positionTags = playerTags[p.id];
    });
    savePlayerTags();
  }
  if (state.assignments   && typeof state.assignments === "object")   assignments   = state.assignments;
  if (state.battingOrders && typeof state.battingOrders === "object") battingOrders = state.battingOrders;
  if (Array.isArray(state.lineupPending)) lineupPending = new Set(state.lineupPending);
  if (Array.isArray(state.bancoPlayers))  bancoPlayers  = new Set(state.bancoPlayers);
  dhEnabled           = Boolean(state.dhEnabled);
  dhAssignment        = typeof state.dhAssignment        === "string" ? state.dhAssignment        : "";
  designatedPitcherId = typeof state.designatedPitcherId === "string" ? state.designatedPitcherId : "";
  if (options.persist) {
    try { localStorage.setItem("ttb_lineup_" + getUser(), JSON.stringify(getLineupStateSnapshot())); }
    catch (_) {}
  }
}

function canSyncActiveGameLineup() {
  return (
    typeof AUTH_SUPABASE_URL !== "undefined" &&
    typeof AUTH_SUPABASE_KEY !== "undefined" &&
    typeof isAdmin === "function" &&
    isAdmin()
  );
}

function scheduleActiveGameLineupSync(snapshot) {
  if (PAGE !== "lineup" || !canSyncActiveGameLineup()) return;
  clearTimeout(activeGameLineupSaveTimer);
  const lineupState = JSON.parse(JSON.stringify(snapshot || getLineupStateSnapshot()));
  activeGameLineupSaveTimer = setTimeout(() => syncActiveGameLineup(lineupState), 700);
}

async function syncActiveGameLineup(lineupState) {
  if (!canSyncActiveGameLineup()) return;
  try {
    const headers = {
      apikey: AUTH_SUPABASE_KEY,
      Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };
    const read = await fetch(
      `${AUTH_SUPABASE_URL}/rest/v1/jogos?select=state&id=eq.${encodeURIComponent(ACTIVE_STATUS_GAME_ID)}`,
      { headers },
    );
    if (!read.ok) throw new Error(await read.text());
    const rows = await read.json();
    const state = rows[0]?.state || {};
    const updatedAt = new Date().toISOString();
    const write = await fetch(`${AUTH_SUPABASE_URL}/rest/v1/jogos?on_conflict=id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: ACTIVE_STATUS_GAME_ID,
        state: { ...state, lineupState },
        updated_at: updatedAt,
      }),
    });
    if (!write.ok) throw new Error(await write.text());
  } catch (err) {
    console.warn("Lineup do status em modo local:", err);
  }
}

const fieldSlots = document.querySelector("#fieldSlots");
const rosterCount = document.querySelector("#rosterCount");
const selectedPlayer = document.querySelector("#selectedPlayer");
const positionButtons = document.querySelector("#positionButtons");
const playerRoster = document.querySelector("#playerRoster");
const drawerToggle = document.querySelector("#drawerToggle");
const drawerClose = document.querySelector("#drawerClose");
const lineupPanel = document.querySelector("#lineupPanel");
const noDhMode = document.querySelector("#noDhMode");
const dhMode = document.querySelector("#dhMode");
const clearButton = document.querySelector("#clearField");
const clearPositionsButton = document.querySelector("#clearPositions");
const resetButton = document.querySelector("#resetLineup");
const exportButton = document.querySelector("#exportLineup");

function buildRoster(lineupPlayers, benchPlayers) {
  const lineupList = lineupPlayers.map((player, index) => ({
    ...player,
    id: `lineup-${index}-${slug(player.name)}-${player.number || "sn"}`,
    group: "Lineup",
    battingOrder: index + 1,
  }));

  const benchList = benchPlayers.map((player, index) => ({
    ...player,
    id: `bench-${index}-${slug(player.name)}-${player.number || "sn"}`,
    group: "Elenco",
    battingOrder: "",
  }));

  return [...lineupList, ...benchList];
}

function buildInitialAssignments() {
  return positions.reduce((list, position) => {
    const player = roster.find((item) => item.position === position.id);
    list[position.id] = player?.id ?? "";
    return list;
  }, {});
}

function buildInitialBattingOrders() {
  return roster.reduce((list, player) => {
    if (player.group === "Lineup") {
      list[player.id] = player.battingOrder;
    }

    return list;
  }, {});
}

function buildEmptyAssignments() {
  return positions.reduce((list, position) => {
    list[position.id] = "";
    return list;
  }, {});
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, type = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.append(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.append(toast);
  requestAnimationFrame(() => toast.classList.add("toast-show"));
  setTimeout(() => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3000);
}

function getPlayer(id) {
  return roster.find((player) => player.id === id);
}

function getAssignedPosition(playerId) {
  if (dhEnabled && dhAssignment === playerId) {
    return "DH pelo P";
  }

  return Object.entries(assignments).find(([, id]) => id === playerId)?.[0] ?? "";
}

function assignSelectedPlayer(positionId) {
  assignPlayerToPosition(selectedPlayerId, positionId);
}

function assignPlayerToPosition(playerId, positionId) {
  if (!playerId) return;

  /* Pitcher position in DH mode never counts as a batter — skip capacity check */
  if (!isLineupPlayer(playerId) && !(dhEnabled && positionId === "P") && getActiveBatterIds().length >= 9) {
    showToast("Lineup completo — máximo 9 rebatedores", "warn");
    return;
  }

  bancoPlayers.delete(playerId);
  selectedPlayerId = playerId;

  if (positionId === dhPosition.id) {
    if (dhAssignment && dhAssignment !== playerId) {
      lineupPending.add(dhAssignment);
      if (!battingOrders[dhAssignment]) {
        battingOrders[dhAssignment] = getNextOpenBattingOrder();
      }
    }
    Object.keys(assignments).forEach((key) => {
      if (key !== "P" && assignments[key] === playerId) {
        assignments[key] = "";
      }
    });
    lineupPending.delete(playerId);
    dhAssignment = playerId;
    if (!battingOrders[playerId]) {
      battingOrders[playerId] = getNextOpenBattingOrder();
    }
    compactBattingOrders();
    render();
    return;
  }

  const currentPosition = Object.keys(assignments).find((key) => assignments[key] === playerId) ?? null;
  const displacedPlayerId = assignments[positionId] ?? "";

  if (displacedPlayerId) {
    if (currentPosition) {
      assignments[currentPosition] = displacedPlayerId;
    } else {
      lineupPending.add(displacedPlayerId);
      if (!battingOrders[displacedPlayerId]) {
        battingOrders[displacedPlayerId] = getNextOpenBattingOrder();
      }
    }
  } else if (currentPosition) {
    assignments[currentPosition] = "";
  }

  if (dhAssignment === playerId) dhAssignment = "";
  lineupPending.delete(playerId);

  if (!battingOrders[playerId]) {
    battingOrders[playerId] = battingOrders[displacedPlayerId] || getNextOpenBattingOrder();
  }

  assignments[positionId] = playerId;

  /* Track pitcher for DH mode */
  if (positionId === "P") {
    if (dhEnabled) {
      /* Old pitcher (tracked by designatedPitcherId) goes to banco if still in lineupPending */
      if (designatedPitcherId && lineupPending.has(designatedPitcherId)) {
        lineupPending.delete(designatedPitcherId);
        delete battingOrders[designatedPitcherId];
        bancoPlayers.add(designatedPitcherId);
      }
      /* New pitcher never bats */
      delete battingOrders[playerId];
    }
    designatedPitcherId = playerId;
  }

  render();
}

function beginDrag(event, playerId) {
  draggedPlayerId = playerId;
  selectedPlayerId = playerId;
  event.currentTarget.classList.add("is-dragging");
  document.body.classList.add("drag-active");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", playerId);
  }
}

function endDrag(event) {
  draggedPlayerId = "";
  event.currentTarget.classList.remove("is-dragging");
  document.body.classList.remove("drag-active");
  document.querySelectorAll(".is-drop-hover").forEach((item) => {
    item.classList.remove("is-drop-hover");
  });
}

function getDraggedPlayerId(event) {
  return event.dataTransfer?.getData("text/plain") || draggedPlayerId;
}

function addLineupDropTarget(element) {
  element.addEventListener("dragover", (event) => {
    const playerId = getDraggedPlayerId(event);
    if (!playerId) return;

    const fromBench = !isLineupPlayer(playerId);
    const targetCard = event.target.closest(".roster-player[data-player-id]");

    if (fromBench) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      element.classList.add("is-drop-hover");
    } else if (targetCard) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const rect = targetCard.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      targetCard.classList.toggle("is-drag-above", insertBefore);
      targetCard.classList.toggle("is-drag-below", !insertBefore);
    }
  });

  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove("is-drop-hover");
      document.querySelectorAll(".roster-player").forEach((card) => {
        card.classList.remove("is-drag-above", "is-drag-below");
      });
    }
  });

  element.addEventListener("drop", (event) => {
    const playerId = getDraggedPlayerId(event);
    if (!playerId) return;

    const fromBench = !isLineupPlayer(playerId);
    const targetCard = event.target.closest(".roster-player[data-player-id]");

    event.preventDefault();
    element.classList.remove("is-drop-hover");
    document.querySelectorAll(".roster-player").forEach((card) => {
      card.classList.remove("is-drag-above", "is-drag-below");
    });

    if (fromBench) {
      addToLineup(playerId);
    } else if (targetCard) {
      const targetId = targetCard.dataset.playerId;
      const rect = targetCard.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      reorderLineup(playerId, targetId, insertBefore);
    }
  });
}

function addToLineup(playerId) {
  if (!playerId || isLineupPlayer(playerId)) return;
  if (getActiveBatterIds().length >= 9) {
    showToast("Lineup completo — máximo 9 rebatedores", "warn");
    return;
  }
  bancoPlayers.delete(playerId);
  lineupPending.add(playerId);
  if (!battingOrders[playerId]) {
    battingOrders[playerId] = getNextOpenBattingOrder();
  }
  selectedPlayerId = playerId;
  render();
}

function addToBanco(playerId) {
  if (!playerId || isLineupPlayer(playerId) || bancoPlayers.has(playerId)) return;
  bancoPlayers.add(playerId);
  selectedPlayerId = playerId;
  render();
}

function removeFromBanco(playerId) {
  bancoPlayers.delete(playerId);
  if (selectedPlayerId === playerId) selectedPlayerId = "";
  render();
}

function addBancoDropTarget(element) {
  element.addEventListener("dragover", (event) => {
    const playerId = getDraggedPlayerId(event);
    if (!playerId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    element.classList.add("is-drop-hover");
  });
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove("is-drop-hover");
    }
  });
  element.addEventListener("drop", (event) => {
    const playerId = getDraggedPlayerId(event);
    if (!playerId) return;
    event.preventDefault();
    element.classList.remove("is-drop-hover");
    if (isLineupPlayer(playerId)) {
      moveLineupPlayerToBanco(playerId);
    } else {
      addToBanco(playerId);
    }
  });
}

function matchesSearch(player, term) {
  if (!term) return true;
  return (
    player.name.toLowerCase().includes(term) ||
    String(player.number).includes(term)
  );
}

function removeFromLineup(playerId) {
  Object.keys(assignments).forEach((key) => {
    if (assignments[key] === playerId) assignments[key] = "";
  });
  if (dhAssignment === playerId) dhAssignment = "";
  if (designatedPitcherId === playerId) designatedPitcherId = "";
  lineupPending.delete(playerId);
  delete battingOrders[playerId];
  compactBattingOrders();
  if (selectedPlayerId === playerId) selectedPlayerId = "";
  render();
}

function moveLineupPlayerToBanco(playerId) {
  if (!playerId || !isLineupPlayer(playerId)) return;
  Object.keys(assignments).forEach((key) => {
    if (assignments[key] === playerId) assignments[key] = "";
  });
  if (dhAssignment === playerId) dhAssignment = "";
  if (designatedPitcherId === playerId) designatedPitcherId = "";
  lineupPending.delete(playerId);
  delete battingOrders[playerId];
  compactBattingOrders();
  bancoPlayers.add(playerId);
  render();
}

function moveAllToBanco() {
  const lineupIds = roster.filter((p) => isLineupPlayer(p.id)).map((p) => p.id);
  lineupIds.forEach((id) => {
    Object.keys(assignments).forEach((key) => {
      if (assignments[key] === id) assignments[key] = "";
    });
    if (dhAssignment === id) dhAssignment = "";
    lineupPending.delete(id);
    delete battingOrders[id];
    bancoPlayers.add(id);
  });
  designatedPitcherId = "";
  compactBattingOrders();
  saveLineupState();
  render();
}

function loadCustomPlayers() {
  try {
    const raw = localStorage.getItem(CUSTOM_PLAYERS_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(saved)) return;
    saved.forEach((cp) => {
      if (!roster.find((p) => p.id === cp.id)) {
        customPlayers.push(cp);
        roster.push({ ...cp, group: "Elenco", battingOrder: "" });
      }
    });
  } catch (_) {}
}

function saveCustomPlayers() {
  try {
    localStorage.setItem(CUSTOM_PLAYERS_KEY, JSON.stringify(customPlayers));
  } catch (_) {}
}

function addCustomPlayer(name, number, positionTags) {
  const id = `custom-${Date.now()}-${slug(name)}`;
  const cp = { id, name, number: String(number || ""), photo: "", positionTags };
  customPlayers.push(cp);
  roster.push({ ...cp, group: "Elenco", battingOrder: "" });
  saveCustomPlayers();
  render();
}

function removeCustomPlayer(id) {
  customPlayers = customPlayers.filter((cp) => cp.id !== id);
  const idx = roster.findIndex((p) => p.id === id);
  if (idx !== -1) roster.splice(idx, 1);
  Object.keys(assignments).forEach((key) => {
    if (assignments[key] === id) assignments[key] = "";
  });
  if (dhAssignment === id) dhAssignment = "";
  if (designatedPitcherId === id) designatedPitcherId = "";
  lineupPending.delete(id);
  bancoPlayers.delete(id);
  delete battingOrders[id];
  compactBattingOrders();
  saveCustomPlayers();
  /* Clean orphaned stats for deleted player */
  try {
    const stats = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY)) || {};
    if (stats[id]) { delete stats[id]; localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(stats)); }
  } catch (_) {}
  render();
}

function loadPlayerTags() {
  try {
    const raw = localStorage.getItem(PLAYER_TAGS_KEY);
    if (!raw) return;
    playerTags = JSON.parse(raw) || {};
    roster.forEach((p) => {
      if (playerTags[p.id]) p.positionTags = playerTags[p.id];
    });
  } catch (_) {}
}

function savePlayerTags() {
  try {
    localStorage.setItem(PLAYER_TAGS_KEY, JSON.stringify(playerTags));
  } catch (_) {}
}

function setPlayerTags(playerId, tags) {
  playerTags[playerId] = tags;
  const player = getPlayer(playerId);
  if (player) player.positionTags = tags;
  savePlayerTags();
  const cp = customPlayers.find((c) => c.id === playerId);
  if (cp) { cp.positionTags = [...tags]; saveCustomPlayers(); }
  renderRoster();
}

function compactBattingOrders() {
  [...getActiveBatterIds()]
    .sort((a, b) => (battingOrders[a] || 99) - (battingOrders[b] || 99))
    .forEach((id, index) => {
      battingOrders[id] = index + 1;
    });
}

function reorderLineup(draggedId, targetId, insertBefore) {
  if (draggedId === targetId) return;
  const activeBatterIds = getActiveBatterIds();
  if (!activeBatterIds.includes(draggedId) || !activeBatterIds.includes(targetId)) return;

  const sorted = [...activeBatterIds].sort(
    (a, b) => (battingOrders[a] || 99) - (battingOrders[b] || 99),
  );
  const filtered = sorted.filter((id) => id !== draggedId);
  const targetIndex = filtered.indexOf(targetId);
  if (targetIndex === -1) return;

  filtered.splice(insertBefore ? targetIndex : targetIndex + 1, 0, draggedId);
  filtered.forEach((id, index) => {
    battingOrders[id] = index + 1;
  });
  render();
}

function addDropTarget(element, positionId) {
  element.addEventListener("dragover", (event) => {
    if (!getDraggedPlayerId(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  });

  element.addEventListener("dragenter", (event) => {
    if (!getDraggedPlayerId(event)) {
      return;
    }

    event.preventDefault();
    element.classList.add("is-drop-hover");
  });

  element.addEventListener("dragleave", () => {
    element.classList.remove("is-drop-hover");
  });

  element.addEventListener("drop", (event) => {
    const playerId = getDraggedPlayerId(event);

    if (!playerId) {
      return;
    }

    event.preventDefault();
    element.classList.remove("is-drop-hover");
    assignPlayerToPosition(playerId, positionId);
  });
}

function playerInitials(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function fallbackAvatar(img, player) {
  const initials = encodeURIComponent(playerInitials(player.name) || "TTB");
  img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%232b383b'/%3E%3Ccircle cx='60' cy='45' r='24' fill='%23f7c948'/%3E%3Cpath d='M18 112c8-29 27-43 42-43s34 14 42 43' fill='%23fff8e7'/%3E%3Ctext x='60' y='51' text-anchor='middle' font-family='Arial,sans-serif' font-size='18' font-weight='700' fill='%23202527'%3E${initials}%3C/text%3E%3C/svg%3E`;
}

function addFallback(img, player) {
  img.addEventListener(
    "error",
    (event) => {
      fallbackAvatar(event.currentTarget, player);
    },
    { once: true },
  );
}

function renderField() {
  fieldSlots.innerHTML = "";

  positions.forEach((position) => {
    const player = getPlayer(assignments[position.id]);
    const slot = document.createElement("button");
    slot.className = `field-slot ${player ? "is-filled" : "is-empty"}`;
    slot.type = "button";
    slot.draggable = Boolean(player);
    slot.style.left = `${position.x}%`;
    slot.style.top = `${position.y}%`;
    slot.dataset.position = position.id;
    slot.setAttribute(
      "aria-label",
      player
        ? `${position.label}: ${player.name}`
        : `${position.label}: vazio, clique para colocar o jogador selecionado`,
    );

    slot.innerHTML = player
      ? `
          <img class="player-photo" alt="Foto de ${escapeHtml(player.name)}" src="${escapeHtml(player.photo)}" />
          <span class="player-chip">
            <strong>${escapeHtml(position.short)}</strong>
            <span>${escapeHtml(player.name)}</span>
            <em>${player.number ? `#${escapeHtml(player.number)}` : "sem numero"}</em>
          </span>
        `
      : `
          <span class="empty-position">${escapeHtml(position.short)}</span>
          <span class="empty-label">${escapeHtml(position.label)}</span>
        `;

    slot.addEventListener("click", () => assignSelectedPlayer(position.id));
    addDropTarget(slot, position.id);

    if (player) {
      addFallback(slot.querySelector("img"), player);
      slot.addEventListener("dragstart", (event) => beginDrag(event, player.id));
      slot.addEventListener("dragend", endDrag);
      slot.querySelector("img").draggable = false;
    }

    fieldSlots.append(slot);
  });

  /* ── Slot do DH no canto inferior esquerdo ── */
  if (dhEnabled) {
    const dhPlayer = getPlayer(dhAssignment);
    const dhSlot = document.createElement("button");
    dhSlot.className = `field-slot dh-field-slot ${dhPlayer ? "is-filled" : "is-empty"}`;
    dhSlot.type = "button";
    dhSlot.draggable = Boolean(dhPlayer);
    dhSlot.style.left = "8%";
    dhSlot.style.top = "82%";
    dhSlot.dataset.position = dhPosition.id;
    dhSlot.setAttribute(
      "aria-label",
      dhPlayer ? `DH: ${dhPlayer.name}` : "DH: vazio, clique para colocar o jogador selecionado",
    );
    dhSlot.innerHTML = dhPlayer
      ? `
          <img class="player-photo" alt="Foto de ${escapeHtml(dhPlayer.name)}" src="${escapeHtml(dhPlayer.photo)}" />
          <span class="player-chip">
            <strong>${escapeHtml(dhPosition.short)}</strong>
            <span>${escapeHtml(dhPlayer.name)}</span>
            <em>${dhPlayer.number ? `#${escapeHtml(dhPlayer.number)}` : "sem numero"}</em>
          </span>
        `
      : `
          <span class="empty-position">${escapeHtml(dhPosition.short)}</span>
          <span class="empty-label">${escapeHtml(dhPosition.label)}</span>
        `;
    dhSlot.addEventListener("click", () => assignSelectedPlayer(dhPosition.id));
    addDropTarget(dhSlot, dhPosition.id);
    if (dhPlayer) {
      addFallback(dhSlot.querySelector("img"), dhPlayer);
      dhSlot.addEventListener("dragstart", (event) => beginDrag(event, dhPlayer.id));
      dhSlot.addEventListener("dragend", endDrag);
      dhSlot.querySelector("img").draggable = false;
    }
    fieldSlots.append(dhSlot);
  }
}

function renderSelectedPlayer() {
  const player = getPlayer(selectedPlayerId);

  if (!player) {
    selectedPlayer.draggable = false;
    selectedPlayer.innerHTML = "<p>Nenhum jogador selecionado.</p>";
    return;
  }

  selectedPlayer.draggable = true;
  const assignedPosition = getAssignedPosition(player.id);
  const battingPrefix = getBattingPrefix(player);

  selectedPlayer.innerHTML = `
    <img class="selected-photo" alt="Foto de ${escapeHtml(player.name)}" src="${escapeHtml(player.photo)}" />
    <div>
      <span class="selected-kicker">Selecionado</span>
      <strong>${battingPrefix}${escapeHtml(player.name)}</strong>
      <small>${player.number ? `#${escapeHtml(player.number)}` : "sem numero"}${assignedPosition ? ` - em ${escapeHtml(assignedPosition)}` : " - fora do campo"}</small>
    </div>
  `;

  addFallback(selectedPlayer.querySelector("img"), player);
}

function renderPositionButtons() {
  positionButtons.innerHTML = "";

  const availablePositions = dhEnabled ? [...positions, dhPosition] : positions;

  availablePositions.forEach((position) => {
    const player = getPlayer(position.id === dhPosition.id ? dhAssignment : assignments[position.id]);
    const button = document.createElement("button");
    button.className = "position-button";
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(position.short)}</strong>
      <span>${player ? escapeHtml(player.name) : "vazio"}</span>
    `;
    button.addEventListener("click", () => assignSelectedPlayer(position.id));
    addDropTarget(button, position.id);
    positionButtons.append(button);
  });
}

function renderRoster() {
  playerRoster.innerHTML = "";
  rosterCount.textContent = `${roster.length} players`;

  const term = rosterSearchTerm.trim().toLowerCase();

  getRosterSections().forEach(({ groupName, players }) => {
    const filtered = term ? players.filter((p) => matchesSearch(p, term)) : players;
    const displayPlayers = (groupName === "Elenco" && positionFilter)
      ? filtered.filter((p) => (p.positionTags || []).includes(positionFilter))
      : filtered;

    /* Oculta seções sem resultado durante busca (exceto Lineup sempre visível) */
    if (term && filtered.length === 0 && groupName !== "Lineup") return;

    const groupClass =
      groupName === "Lineup" ? "is-lineup" :
      groupName === "Banco"  ? "is-banco"  : "is-elenco";

    const group = document.createElement("section");
    group.className = `roster-group ${groupClass}`;
    group.innerHTML = `<h3>${escapeHtml(groupName)}</h3>`;

    if (groupName === "Elenco") {
      const filterBar = document.createElement("div");
      filterBar.className = "pos-filter-bar";
      ["P", "C", "IF", "OF", "UT"].forEach((tag) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `pos-filter-btn${positionFilter === tag ? " is-active" : ""}`;
        btn.textContent = tag;
        btn.title = POSITION_TOOLTIPS[tag] || tag;
        btn.addEventListener("click", () => {
          positionFilter = positionFilter === tag ? "" : tag;
          try { sessionStorage.setItem("ttb_pos_filter", positionFilter); } catch (_) {}
          renderRoster();
        });
        filterBar.append(btn);
      });
      group.append(filterBar);
    }

    if (groupName === "Lineup") {
      addLineupDropTarget(group);
    } else if (groupName === "Banco") {
      addBancoDropTarget(group);
    }

    const grid = document.createElement("div");
    grid.className = "roster-grid";

    displayPlayers.forEach((player) => {
      const assignedPosition = getAssignedPosition(player.id);
      const card = document.createElement("article");
      card.className = `roster-player ${player.id === selectedPlayerId ? "is-selected" : ""}`;
      card.draggable = true;
      card.tabIndex = 0;
      const battingPrefix = getBattingPrefix(player);
      const isDh = dhEnabled && dhAssignment === player.id;
      const canEditOrder = getActiveBatterIds().includes(player.id);
      const posTagsHtml = (groupName !== "Elenco" && player.positionTags?.length)
        ? `<span class="roster-pos-tags">${player.positionTags.map((t) => `<span class="roster-pos-tag">${escapeHtml(t)}</span>`).join("")}</span>`
        : "";
      const avgText = formatPlayerAvg(player.id);
      const avgBadge = avgText ? `<span class="roster-avg-badge" title="Média de rebatidas">${avgText}</span>` : "";

      card.innerHTML = `
        <img class="roster-photo" alt="Foto de ${escapeHtml(player.name)}" src="${escapeHtml(player.photo)}" />
        <span class="roster-name">${battingPrefix}${escapeHtml(player.name)}${isDh ? " DH" : ""}</span>
        <span class="roster-number">${player.number ? `#${escapeHtml(player.number)}` : "sem numero"}</span>
        ${avgBadge}
        ${posTagsHtml}
        <span class="roster-status">${escapeHtml(getPlayerStatus(player, assignedPosition))}</span>
        ${canEditOrder ? renderOrderSelect(player) : ""}
      `;
      card.addEventListener("click", () => {
        selectedPlayerId = player.id;
        render();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectedPlayerId = player.id;
        render();
      });
      card.addEventListener("dragstart", (event) => beginDrag(event, player.id));
      card.addEventListener("dragend", endDrag);

      const select = card.querySelector("select");
      if (select) {
        select.addEventListener("click", (event) => event.stopPropagation());
        select.addEventListener("change", (event) => {
          event.stopPropagation();
          setBattingOrder(player.id, Number(event.currentTarget.value));
          render();
        });
      }

      addFallback(card.querySelector("img"), player);
      card.querySelector("img").draggable = false;

      if (groupName === "Lineup") {
        card.dataset.playerId = player.id;
        const toBancoBtn = document.createElement("button");
        toBancoBtn.type = "button";
        toBancoBtn.className = "lineup-to-banco-btn";
        toBancoBtn.setAttribute("aria-label", `Mover ${escapeHtml(player.name)} para o banco`);
        toBancoBtn.textContent = "B";
        toBancoBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          moveLineupPlayerToBanco(player.id);
        });
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "lineup-remove-btn";
        removeBtn.setAttribute("aria-label", `Remover ${escapeHtml(player.name)} do lineup`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          removeFromLineup(player.id);
        });
        card.append(toBancoBtn, removeBtn);
      } else if (groupName === "Banco") {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "lineup-remove-btn";
        removeBtn.setAttribute("aria-label", `Remover ${escapeHtml(player.name)} do banco`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          removeFromBanco(player.id);
        });
        card.append(removeBtn);
      } else if (groupName === "Elenco" && player.id.startsWith("custom-")) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "lineup-remove-btn";
        deleteBtn.setAttribute("aria-label", `Remover ${escapeHtml(player.name)} do elenco`);
        deleteBtn.textContent = "×";
        deleteBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          removeCustomPlayer(player.id);
        });
        card.append(deleteBtn);
      }

      if (groupName === "Elenco") {
        const tagEditor = document.createElement("div");
        tagEditor.className = "card-tag-editor";
        ["P", "C", "IF", "OF", "UT"].forEach((tag) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `card-tag-btn${(player.positionTags || []).includes(tag) ? " is-active" : ""}`;
          btn.textContent = tag;
          btn.title = POSITION_TOOLTIPS[tag] || tag;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const current = player.positionTags || [];
            const newTags = current.includes(tag)
              ? current.filter((t) => t !== tag)
              : [...current, tag];
            setPlayerTags(player.id, newTags);
          });
          tagEditor.append(btn);
        });
        card.append(tagEditor);
      }

      grid.append(card);
    });

    group.append(grid);

    if (groupName === "Elenco" && positionFilter && displayPlayers.length === 0 && filtered.length > 0) {
      const hint = document.createElement("p");
      hint.className = "lineup-empty-hint";
      hint.textContent = `Nenhum jogador com posição ${positionFilter}`;
      group.append(hint);
    } else if (filtered.length === 0 && !term) {
      const hint = document.createElement("p");
      hint.className = "lineup-empty-hint";
      hint.textContent =
        groupName === "Banco"
          ? "Arraste jogadores do elenco para o banco"
          : "Arraste jogadores do elenco para o lineup";
      group.append(hint);
    }

    playerRoster.append(group);
  });
}

function getPitcherBattingOrder() {
  const pitcher = getPlayer(assignments.P);
  return battingOrders[pitcher?.id] || pitcher?.battingOrder || 1;
}

function getBattingPrefix(player) {
  if (dhEnabled && dhAssignment === player.id) {
    return `${escapeHtml(battingOrders[player.id] || getPitcherBattingOrder())}- `;
  }

  if (dhEnabled && assignments.P === player.id) {
    return "";
  }

  if (isLineupPlayer(player.id)) {
    return `${escapeHtml(battingOrders[player.id] || player.battingOrder || "")}- `;
  }

  return "";
}

function getRosterSections() {
  const dhPlayer = dhEnabled ? getPlayer(dhAssignment) : null;
  const assignedIds = new Set(Object.values(assignments).filter(Boolean));
  const lineupCards = roster
    .filter((player) => assignedIds.has(player.id) || lineupPending.has(player.id))
    .concat(dhPlayer ? [dhPlayer] : [])
    .filter((player, index, list) => list.findIndex((item) => item.id === player.id) === index)
    .sort((first, second) => getLineupSortOrder(first) - getLineupSortOrder(second));

  const lineupIds = new Set(lineupCards.map((player) => player.id));

  const bancoCards = roster
    .filter((player) => bancoPlayers.has(player.id) && !lineupIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const bancoIds = new Set(bancoCards.map((player) => player.id));

  const benchCards = roster
    .filter((player) => !lineupIds.has(player.id) && !bancoIds.has(player.id))
    .sort((first, second) => first.name.localeCompare(second.name));

  return [
    { groupName: "Lineup", players: lineupCards },
    { groupName: "Banco", players: bancoCards },
    { groupName: "Elenco", players: benchCards },
  ];
}

function getLineupSortOrder(player) {
  if (dhEnabled && dhAssignment === player.id) {
    return battingOrders[player.id] || getPitcherBattingOrder();
  }

  if (dhEnabled && assignments.P === player.id) {
    return 999;
  }

  return battingOrders[player.id] || player.battingOrder || 99;
}

function isLineupPlayer(playerId) {
  if (!playerId) {
    return false;
  }

  if (dhEnabled && dhAssignment === playerId) {
    return true;
  }

  if (lineupPending.has(playerId)) {
    return true;
  }

  return Object.values(assignments).includes(playerId);
}

function getPlayerStatus(player, assignedPosition) {
  if (dhEnabled && dhAssignment === player.id) {
    const pitcher = getPlayer(assignments.P);
    return `DH do ${pitcher?.name || "pitcher"} (pitcher)`;
  }

  if (assignments.P === player.id) {
    return "pitcher";
  }

  if (lineupPending.has(player.id)) {
    return "a definir";
  }

  return assignedPosition || "banco";
}

function getActiveBatterIds() {
  const onFieldIds = Object.values(assignments).filter(Boolean);
  let batterIds = [...new Set([...onFieldIds, ...lineupPending])];

  if (!dhEnabled) {
    return batterIds;
  }

  const pitcherExclude = assignments.P || designatedPitcherId;
  return [
    ...new Set(
      batterIds
        .filter((id) => id !== pitcherExclude)
        .concat(dhAssignment ? [dhAssignment] : []),
    ),
  ];
}

function renderOrderSelect(player) {
  const activeBatterIds = getActiveBatterIds();
  const maxOrder = activeBatterIds.length || 0;
  const currentOrder = battingOrders[player.id] || getPitcherBattingOrder();
  if (!maxOrder) return "";

  const isReadOnly =
    isSpectator() ||
    document.body.classList.contains("is-viewing-other");

  if (isReadOnly) {
    return `
      <span class="batting-order-badge" aria-label="Ordem de rebatida: ${currentOrder}">
        ${currentOrder}°
      </span>
    `;
  }

  const options = Array.from({ length: maxOrder }, (_, index) => {
    const order = index + 1;
    return `<option value="${order}" ${order === currentOrder ? "selected" : ""}>${order}</option>`;
  }).join("");

  return `
    <label class="batting-order-control">
      Ordem
      <select aria-label="Ordem de rebatida de ${escapeHtml(player.name)}">
        ${options}
      </select>
    </label>
  `;
}

function setBattingOrder(playerId, nextOrder) {
  const activeBatterIds = getActiveBatterIds();
  if (!activeBatterIds.includes(playerId)) return;
  /* Reorder-based approach: always produces unique 1-9 sequence with no collisions */
  const sorted = [...activeBatterIds].sort((a, b) => (battingOrders[a] || 99) - (battingOrders[b] || 99));
  const rest   = sorted.filter((id) => id !== playerId);
  const insertAt = Math.min(Math.max(nextOrder - 1, 0), rest.length);
  rest.splice(insertAt, 0, playerId);
  rest.forEach((id, idx) => { battingOrders[id] = idx + 1; });
}

function getNextOpenBattingOrder() {
  const usedOrders = new Set(
    getActiveBatterIds()
      .map((playerId) => battingOrders[playerId])
      .filter(Boolean),
  );

  for (let order = 1; order <= 9; order += 1) {
    if (!usedOrders.has(order)) {
      return order;
    }
  }

  return 9;
}

function getBattingOrder() {
  const pitcherPlayer = getPlayer(assignments.P);
  return getActiveBatterIds()
    .map((playerId) => getPlayer(playerId))
    .filter(Boolean)
    .sort((first, second) => (battingOrders[first.id] || 99) - (battingOrders[second.id] || 99))
    .map((player) => {
      const isDh = dhEnabled && dhAssignment === player.id;

      return {
        battingOrder: battingOrders[player.id] || "",
        role: isDh ? "DH pelo P" : getAssignedPosition(player.id),
        name: player.name ?? "",
        number: player.number ?? "",
        photo: player.photo ?? "",
        pitcherFielding: isDh ? pitcherPlayer?.name ?? "" : "",
      };
    });
}

function exportAssignments() {
  const fieldLineup = positions.map((position) => {
    const player = getPlayer(assignments[position.id]);

    return {
      position: position.id,
      positionName: position.label,
      battingOrder: dhEnabled && position.id === "P" ? "" : battingOrders[player?.id] ?? "",
      name: player?.name ?? "",
      number: player?.number ?? "",
      photo: player?.photo ?? "",
    };
  });

  return {
    dhEnabled,
    field: fieldLineup,
    battingOrder: getBattingOrder(),
  };
}

/* ═══════════════════════════════
   EXPORT COMO IMAGEM
═══════════════════════════════ */

async function _loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function _canvasTruncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

async function exportLineupImage() {
  if (exportButton) {
    exportButton.disabled = true;
    exportButton.textContent = "Gerando…";
  }
  try {
    const slots = [
      ...positions,
      ...(dhEnabled ? [{ ...dhPosition, x: 8, y: 82 }] : []),
    ];

    /* Pré-carrega fotos */
    const imgCache = {};
    await Promise.all(slots.map(async (pos) => {
      const pid    = pos.id === "DH" ? dhAssignment : assignments[pos.id];
      const player = getPlayer(pid);
      if (player?.photo) {
        const img = await _loadImg(player.photo);
        if (img) imgCache[player.id] = img;
      }
    }));

    const FW = 640, LW = 440, H = 640;
    const canvas  = document.createElement("canvas");
    canvas.width  = FW + LW;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    _exportField(ctx, FW, H, slots, imgCache);
    _exportPanel(ctx, FW, LW, H);

    canvas.toBlob((blob) => {
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href     = url;
      link.download = "lineup-ttb.png";
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  } catch (err) {
    console.error("Erro ao exportar imagem:", err);
  } finally {
    if (exportButton) {
      exportButton.disabled = false;
      exportButton.innerHTML =
        '<span class="label-full">Exportar</span><span class="label-short">Export.</span>';
    }
  }
}

function _exportField(ctx, fw, h, slots, imgCache) {
  /* Grama */
  ctx.fillStyle = "#347a4d";
  ctx.fillRect(0, 0, fw, h);
  const sw = fw / 9;
  ctx.fillStyle = "#2e6b40";
  for (let i = 0; i < 9; i += 2) ctx.fillRect(i * sw, 0, sw, h);

  /* Coordenadas das bases */
  const hx = fw * 0.52, hy = h * 0.90;
  const f1x = fw * 0.82, f1y = h * 0.62;
  const f2x = fw * 0.52, f2y = h * 0.33;
  const f3x = fw * 0.20, f3y = h * 0.62;

  /* Arco do outfield — semicírculo centrado no home plate */
  const arcR = h * 0.70;
  ctx.beginPath();
  ctx.arc(hx, hy, arcR, (5 * Math.PI) / 4, (7 * Math.PI) / 4);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* Linhas de foul */
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(-60, -60); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fw + 60, -60); ctx.stroke();

  /* Infield (terra) */
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(f1x, f1y);
  ctx.lineTo(f2x, f2y);
  ctx.lineTo(f3x, f3y);
  ctx.closePath();
  ctx.fillStyle = "#b07040";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* Loma do pitcher */
  ctx.beginPath();
  ctx.arc(fw * 0.52, h * 0.62, 15, 0, Math.PI * 2);
  ctx.fillStyle = "#9e6535";
  ctx.fill();

  /* Bases */
  [[hx, hy], [f1x, f1y], [f2x, f2y], [f3x, f3y]].forEach(([bx, by]) => {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.PI / 4);
    const bs = 11;
    ctx.fillStyle = "#fffbe7";
    ctx.fillRect(-bs / 2, -bs / 2, bs, bs);
    ctx.strokeStyle = "#0d1520";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-bs / 2, -bs / 2, bs, bs);
    ctx.restore();
  });

  /* Tokens dos jogadores */
  slots.forEach((pos) => {
    const pid    = pos.id === "DH" ? dhAssignment : assignments[pos.id];
    const player = getPlayer(pid);
    const px = fw * pos.x / 100;
    const py = h  * pos.y / 100;
    if (player) {
      _exportToken(ctx, px, py, pos.short, player, imgCache[player.id] ?? null);
    } else {
      _exportEmptyToken(ctx, px, py, pos.short);
    }
  });
}

function _exportToken(ctx, x, y, posShort, player, img) {
  const r = 26;

  /* Sombra */
  ctx.shadowColor   = "rgba(0,0,0,0.6)";
  ctx.shadowBlur    = 8;
  ctx.shadowOffsetY = 2;

  /* Círculo */
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1e2d3d";
  ctx.fill();
  ctx.strokeStyle = "#f6c347";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur  = 0;
  ctx.shadowOffsetY = 0;

  /* Foto ou iniciais */
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 2.5, 0, Math.PI * 2);
    ctx.clip();
    const ir = r - 2.5;
    ctx.drawImage(img, x - ir, y - ir, ir * 2, ir * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = "#f6c347";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(playerInitials(player.name) || "?", x, y);
  }

  /* Badge de posição */
  const br = 10, bx = x + r * 0.66, by = y - r * 0.66;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = "#0d1520";
  ctx.fill();
  ctx.strokeStyle = "#f6c347";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#f6c347";
  ctx.font = "bold 7px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(posShort, bx, by);

  /* Nome e número */
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur  = 3;
  ctx.fillStyle   = "#fff";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(_canvasTruncate(ctx, player.name, 90), x, y + r + 4);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "9px system-ui, sans-serif";
  ctx.fillText(player.number ? `#${player.number}` : "", x, y + r + 17);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur  = 0;
}

function _exportEmptyToken(ctx, x, y, posShort) {
  const r = 23;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(posShort, x, y);
}

function _exportPanel(ctx, offsetX, pw, h) {
  /* Fundo */
  ctx.fillStyle = "#111827";
  ctx.fillRect(offsetX, 0, pw, h);

  /* Cabeçalho */
  ctx.fillStyle = "#1a2638";
  ctx.fillRect(offsetX, 0, pw, 58);

  /* Barra gradiente */
  const g = ctx.createLinearGradient(offsetX, 0, offsetX + pw, 0);
  g.addColorStop(0, "#d43a22");
  g.addColorStop(1, "#f6c347");
  ctx.fillStyle = g;
  ctx.fillRect(offsetX, 0, pw, 3);

  /* Título */
  ctx.fillStyle = "#f6c347";
  ctx.font = "bold 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("LINE UP", offsetX + pw / 2, 22);

  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  ctx.fillStyle = "rgba(240,234,216,0.4)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(hoje, offsetX + pw / 2, 44);

  /* Lista de rebatedores */
  const batters = getBattingOrder();
  if (!batters.length) {
    ctx.fillStyle = "rgba(240,234,216,0.35)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Lineup vazio", offsetX + pw / 2, h / 2);
    return;
  }

  const listTop = 66, listBot = h - 30;
  const rowH = Math.min(54, (listBot - listTop) / batters.length);
  const padX = 14;

  batters.forEach((b, i) => {
    const ry  = listTop + i * rowH;
    const mid = ry + rowH / 2;

    /* Linha alternada */
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(offsetX, ry, pw, rowH);
    }

    /* Bola com número */
    const nbx = offsetX + padX + 16;
    ctx.beginPath();
    ctx.arc(nbx, mid, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#f6c347";
    ctx.fill();
    ctx.fillStyle = "#0d1520";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(b.battingOrder || i + 1), nbx, mid);

    /* Nome */
    const nameX  = offsetX + padX + 40;
    const maxW   = pw - padX * 2 - 78;
    ctx.fillStyle = "#f0ead8";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(_canvasTruncate(ctx, b.name, maxW), nameX, mid - 7);

    /* Posição + número */
    const detail = [b.role, b.number ? `#${b.number}` : ""].filter(Boolean).join("  ·  ");
    ctx.fillStyle = "rgba(140,158,181,0.9)";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(_canvasTruncate(ctx, detail, maxW), nameX, mid + 8);

    /* Círculo de iniciais (direita) */
    const icx = offsetX + pw - padX - 18;
    ctx.beginPath();
    ctx.arc(icx, mid, 17, 0, Math.PI * 2);
    ctx.fillStyle = "#1e2d3d";
    ctx.fill();
    ctx.strokeStyle = "#f6c347";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#f6c347";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(playerInitials(b.name), icx, mid);
  });

  /* Indicador DH */
  if (dhEnabled) {
    ctx.fillStyle = "#60d2c8";
    ctx.font = "italic 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("★ Modo DH ativo", offsetX + pw / 2, h - 8);
  }
}

function clearFieldPositions() {
  /* Remember current pitcher before clearing so they stay excluded from batting in DH mode */
  if (dhEnabled) designatedPitcherId = assignments.P || designatedPitcherId;
  Object.entries(assignments).forEach(([, playerId]) => {
    if (playerId) lineupPending.add(playerId);
  });
  if (dhEnabled && dhAssignment) {
    lineupPending.add(dhAssignment);
    dhAssignment = "";
  }
  assignments = buildEmptyAssignments();
  render();
}

function render() {
  if (PAGE !== "lineup") return;
  renderField();
  renderSelectedPlayer();
  renderPositionButtons();
  renderRoster();
  noDhMode.classList.toggle("is-active", !dhEnabled);
  dhMode.classList.toggle("is-active", dhEnabled);
  saveLineupState();
}

function setLineupPanelCollapsed(collapsed) {
  lineupPanel.classList.toggle("is-collapsed", collapsed);
  drawerToggle.setAttribute("aria-expanded", String(!collapsed));
}

if (PAGE === "lineup") {
  document.querySelector("#rosterSearch")?.addEventListener("input", (event) => {
    rosterSearchTerm = event.currentTarget.value;
    renderRoster();
  });

  clearButton.addEventListener("click", () => {
    assignments = buildEmptyAssignments();
    dhAssignment = "";
    designatedPitcherId = "";
    battingOrders = {};
    lineupPending.clear();
    bancoPlayers.clear();
    render();
  });

  clearPositionsButton?.addEventListener("click", clearFieldPositions);

  resetButton.addEventListener("click", () => {
    assignments = buildInitialAssignments();
    battingOrders = buildInitialBattingOrders();
    dhAssignment = "";
    designatedPitcherId = "";
    lineupPending.clear();
    selectedPlayerId = roster[0]?.id ?? "";
    render();
  });

  drawerToggle.addEventListener("click", () => {
    setLineupPanelCollapsed(!lineupPanel.classList.contains("is-collapsed"));
  });

  drawerClose?.addEventListener("click", () => setLineupPanelCollapsed(true));

  noDhMode.addEventListener("click", () => {
    dhEnabled = false;
    dhAssignment = "";
    render();
  });

  dhMode.addEventListener("click", () => {
    dhEnabled = true;
    render();
  });

  exportButton.addEventListener("click", () => {
    exportLineupImage();
  });

  selectedPlayer.addEventListener("dragstart", (event) => {
    if (!selectedPlayerId) {
      event.preventDefault();
      return;
    }
    beginDrag(event, selectedPlayerId);
  });

  selectedPlayer.addEventListener("dragend", endDrag);

  document.querySelector("#moveAllToBanco")?.addEventListener("click", moveAllToBanco);

  document.querySelector("#addPlayerToggle")?.addEventListener("click", () => {
    const panel = document.querySelector("#addPlayerPanel");
    if (panel) panel.hidden = !panel.hidden;
  });

  document.querySelector("#addPlayerCancel")?.addEventListener("click", () => {
    const panel = document.querySelector("#addPlayerPanel");
    if (panel) panel.hidden = true;
    document.querySelector("#newPlayerName").value = "";
    document.querySelector("#newPlayerNumber").value = "";
    document.querySelectorAll(".pos-tag-btn").forEach((b) => b.classList.remove("is-active"));
  });

  document.querySelectorAll(".pos-tag-btn").forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("is-active"));
  });

  document.querySelector("#addPlayerSave")?.addEventListener("click", () => {
    const nameInput = document.querySelector("#newPlayerName");
    const name = nameInput?.value.trim();
    if (!name) { nameInput?.focus(); return; }
    const number = document.querySelector("#newPlayerNumber")?.value.trim() || "";
    const tags = [...document.querySelectorAll(".pos-tag-btn.is-active")].map((b) => b.dataset.tag);
    addCustomPlayer(name, number, tags);
    nameInput.value = "";
    document.querySelector("#newPlayerNumber").value = "";
    document.querySelectorAll(".pos-tag-btn").forEach((b) => b.classList.remove("is-active"));
    document.querySelector("#addPlayerPanel").hidden = true;
  });

  document.querySelector("#newPlayerName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.querySelector("#addPlayerSave")?.click();
  });

  /* Restore position filter from last session */
  try { positionFilter = sessionStorage.getItem("ttb_pos_filter") || ""; } catch (_) {}

  loadPlayerTags();
  loadCustomPlayers();
  loadLineupState();
  render();
}


/* ═══════════════════════════════
   STATUS GAME STATE
═══════════════════════════════ */

const gameState = {
  inning: 1,
  isTop: true,
  outs: 0,
  balls: 0,
  strikes: 0,
  bases: [false, false, false],
  currentBatterIndex: 0,
  batterIndexes: { away: 0, home: 0 },
  plays: [],
  currentPitches: [],
  playerStats: {},
};

const OPPONENT_LINEUP_KEY = "ttb_opponent_lineup";
const STATUS_TEAM_SIDE_KEY = "ttb_status_ttb_side";
const MATCH_HISTORY_KEY = "ttb_match_history_v1";
let activeStatusLineupTab = "home";
let opponentLineup = buildBlankOpponentLineup();
let ttbSide = loadTtbSide();
let activeMatchHistoryId = "";

function buildBlankOpponentLineup() {
  return Array.from({ length: 9 }, (_, index) => ({
    order: index + 1,
    number: "",
    name: "",
  }));
}

function loadOpponentLineup() {
  try {
    const raw = localStorage.getItem(OPPONENT_LINEUP_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const blank = buildBlankOpponentLineup();
    opponentLineup = blank.map((row, index) => ({
      ...row,
      number: parsed[index]?.number ?? "",
      name: parsed[index]?.name ?? "",
    }));
  } catch (_) {}
}

function saveOpponentLineup() {
  try {
    localStorage.setItem(OPPONENT_LINEUP_KEY, JSON.stringify(opponentLineup));
  } catch (_) {}
}

function loadTtbSide() {
  try {
    const saved = localStorage.getItem(STATUS_TEAM_SIDE_KEY);
    if (saved === "away" || saved === "home") return saved;
  } catch (_) {}
  return "home";
}

function saveTtbSide() {
  try { localStorage.setItem(STATUS_TEAM_SIDE_KEY, ttbSide); }
  catch (_) {}
}

function opponentSide() {
  return ttbSide === "away" ? "home" : "away";
}

function isOurTeamSide(team) {
  return team === ttbSide;
}

function getOpponentStatKey(index) {
  return `opponent_${index}`;
}

function getOpponentStats(index) {
  return (
    gameState.playerStats[getOpponentStatKey(index)] ||
    gameState.playerStats[`away_${index}`] ||
    gameState.playerStats[`home_${index}`] ||
    { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 }
  );
}

function setDefaultTeamNames() {
  const awayName = document.querySelector("#awayName");
  const homeName = document.querySelector("#homeName");
  if (awayName) awayName.value = ttbSide === "away" ? "TTB" : "Visitante";
  if (homeName) homeName.value = ttbSide === "home" ? "TTB" : "Visitante";
}

function normalizeTeamNamesForSide() {
  const awayName = document.querySelector("#awayName");
  const homeName = document.querySelector("#homeName");
  if (!awayName || !homeName) return;
  if (ttbSide === "away") {
    if (!awayName.value || awayName.value === "Visitante") awayName.value = "TTB";
    if (!homeName.value || homeName.value === "TTB") homeName.value = "Visitante";
  } else {
    if (!homeName.value || homeName.value === "Visitante") homeName.value = "TTB";
    if (!awayName.value || awayName.value === "TTB") awayName.value = "Visitante";
  }
}

function swapTeamSides() {
  const oldOpponentSide = opponentSide();
  const oldOpponentName =
    document.querySelector(`#${oldOpponentSide}Name`)?.value ||
    "Visitante";
  ttbSide = ttbSide === "home" ? "away" : "home";
  gameState.batterIndexes = { away: gameState.batterIndexes?.away || 0, home: gameState.batterIndexes?.home || 0 };
  const awayName = document.querySelector("#awayName");
  const homeName = document.querySelector("#homeName");
  if (awayName) awayName.value = ttbSide === "away" ? "TTB" : oldOpponentName;
  if (homeName) homeName.value = ttbSide === "home" ? "TTB" : oldOpponentName;
  saveTtbSide();
  renderStatus();
}

function loadMatchHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(MATCH_HISTORY_KEY));
    return Array.isArray(history) ? history : [];
  } catch (_) {
    return [];
  }
}

function saveMatchHistory(history) {
  try { localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(history.slice(0, 12))); }
  catch (_) {}
}

function saveMatchHistoryAndSync(history) {
  saveMatchHistory(history);
  if (typeof autosaveJogo === "function") autosaveJogo();
}

function updateMatchHistoryEntry(matchId, updater) {
  const history = loadMatchHistory();
  const index = history.findIndex((entry) => entry.id === matchId);
  if (index === -1) return;
  const entry = JSON.parse(JSON.stringify(history[index]));
  updater(entry);
  history[index] = entry;
  saveMatchHistoryAndSync(history);
  renderMatchHistory();
  renderHistoryPage();
}

function deleteMatchHistoryEntry(matchId) {
  if (!matchId || !confirm("Apagar esta partida do histórico?")) return;
  const history = loadMatchHistory().filter((entry) => entry.id !== matchId);
  activeMatchHistoryId = history[0]?.id || "";
  saveMatchHistoryAndSync(history);
  renderMatchHistory();
  renderHistoryPage();
}

function clearMatchHistory() {
  if (!confirm("Apagar TODO o histórico de partidas?")) return;
  activeMatchHistoryId = "";
  saveMatchHistoryAndSync([]);
  renderMatchHistory();
  renderHistoryPage();
}

function getManualHistoryLineup() {
  const activeLineup = getStatusBatterList();
  const source = activeLineup.length > 0 ? activeLineup : roster;
  return source.map((player, index) => ({
    id: player.id,
    order: battingOrders[player.id] || player.battingOrder || index + 1,
    name: player.name,
    number: player.number || "",
    position: player.position || "",
  }));
}

function createManualHistoryMatch() {
  const entry = {
    id: `manual-match-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ttbSide,
    manualOnlyOurStats: true,
    score: {
      awayName: ttbSide === "away" ? "TTB" : "Visitante",
      homeName: ttbSide === "home" ? "TTB" : "Visitante",
      awayRuns: 0,
      homeRuns: 0,
      awayHits: 0,
      homeHits: 0,
      awayErrors: 0,
      homeErrors: 0,
    },
    ourLineup: getManualHistoryLineup(),
    opponentLineup: [],
    playerStats: {},
    plays: [],
  };
  const history = loadMatchHistory();
  history.unshift(entry);
  activeMatchHistoryId = entry.id;
  saveMatchHistoryAndSync(history);
  renderMatchHistory();
  renderHistoryPage();
  return entry;
}

function currentScoreSnapshot() {
  computeRuns();
  return {
    awayName: document.querySelector("#awayName")?.value || (ttbSide === "away" ? "TTB" : "Visitante"),
    homeName: document.querySelector("#homeName")?.value || (ttbSide === "home" ? "TTB" : "Visitante"),
    awayRuns: getCellNumber(document.querySelector("#awayRuns")),
    homeRuns: getCellNumber(document.querySelector("#homeRuns")),
    awayHits: getCellNumber(document.querySelector("#awayHits")),
    homeHits: getCellNumber(document.querySelector("#homeHits")),
    awayErrors: getCellNumber(document.querySelector("#awayErrors")),
    homeErrors: getCellNumber(document.querySelector("#homeErrors")),
  };
}

function archiveCurrentMatch() {
  const hasScore = ["#awayRuns", "#homeRuns", "#awayHits", "#homeHits", "#awayErrors", "#homeErrors"]
    .some((sel) => getCellNumber(document.querySelector(sel)) > 0);
  const hasStats = Object.values(gameState.playerStats || {}).some((s) => (s.ab || 0) > 0 || (s.h || 0) > 0 || (s.bb || 0) > 0 || (s.hbp || 0) > 0 || (s.k || 0) > 0 || (s.hr || 0) > 0);
  const hasPlays = (gameState.plays || []).length > 0;
  if (!hasScore && !hasStats && !hasPlays) return null;

  const entry = {
    id: `match-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ttbSide,
    score: currentScoreSnapshot(),
    ourLineup: getStatusBatterList().map((player, index) => ({
      id: player.id,
      order: index + 1,
      name: player.name,
      number: player.number || "",
      position: getAssignedPosition(player.id) || "",
    })),
    opponentLineup: JSON.parse(JSON.stringify(opponentLineup || [])),
    playerStats: JSON.parse(JSON.stringify(gameState.playerStats || {})),
    plays: JSON.parse(JSON.stringify(gameState.plays || [])),
  };
  const history = loadMatchHistory();
  history.unshift(entry);
  saveMatchHistoryAndSync(history);
  renderMatchHistory();
  return entry;
}

function renderMatchHistoryLegacy() {
  const container = document.querySelector("#matchHistoryList");
  if (!container) return;
  const history = loadMatchHistory();
  if (history.length === 0) {
    container.innerHTML = `<p class="gd-match-history-empty">Nenhuma partida arquivada.</p>`;
    return;
  }
  container.innerHTML = history.slice(0, 6).map((entry) => {
    const score = entry.score || {};
    const date = new Date(entry.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const time = new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `<div class="gd-match-history-item">
      <span>${escapeHtml(date)} ${escapeHtml(time)}</span>
      <strong>${escapeHtml(score.awayName || "Visitante")} ${score.awayRuns ?? 0} - ${score.homeRuns ?? 0} ${escapeHtml(score.homeName || "TTB")}</strong>
      <small>H ${score.awayHits ?? 0}-${score.homeHits ?? 0} · E ${score.awayErrors ?? 0}-${score.homeErrors ?? 0}</small>
    </div>`;
  }).join("");
}

function getMatchResult(entry) {
  const score = entry.score || {};
  const ttbRuns = entry.ttbSide === "away" ? score.awayRuns || 0 : score.homeRuns || 0;
  const oppRuns = entry.ttbSide === "away" ? score.homeRuns || 0 : score.awayRuns || 0;
  if (ttbRuns === oppRuns) return { label: "TIE", className: "is-tie", ttbRuns, oppRuns };
  return ttbRuns > oppRuns
    ? { label: "WIN", className: "is-win", ttbRuns, oppRuns }
    : { label: "LOSE", className: "is-lose", ttbRuns, oppRuns };
}

function getStatAvgText(stat = {}) {
  const officialAb = getOfficialAtBats(stat);
  return officialAb > 0 ? "." + String(Math.round(((stat.h || 0) / officialAb) * 1000)).padStart(3, "0") : "—";
}

function getOfficialAtBats(stat = {}) {
  return Math.max(0, (Number(stat?.ab) || 0) - (Number(stat?.bb) || 0) - (Number(stat?.hbp) || 0));
}

function formatHistoryAvg(stat = {}) {
  return getStatAvgText(stat);
}

function addStatTotals(totals, stat = {}) {
  totals.ab += stat.ab || 0;
  totals.h  += stat.h  || 0;
  totals.bb += stat.bb || 0;
  totals.hbp += stat.hbp || 0;
  totals.k  += stat.k  || 0;
  totals.hr += stat.hr || 0;
  return totals;
}

function getOurStatusRows() {
  const batters = getStatusBatterList();
  const current = batters.length ? getCurrentTeamBatterIndex(ttbSide) % batters.length : -1;
  return batters.map((player, index) => ({
    order: index + 1,
    name: player.name,
    sub: [getAssignedPosition(player.id), player.number ? `#${player.number}` : ""].filter(Boolean).join(" "),
    stat: gameState.playerStats[player.id] || { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 },
    current: index === current,
  }));
}

function getOpponentStatusRows() {
  const side = opponentSide();
  const current = opponentLineup.length ? getCurrentTeamBatterIndex(side) % opponentLineup.length : -1;
  return opponentLineup.map((row, index) => ({
    order: row.order || index + 1,
    name: row.name || `Jogador ${row.order || index + 1}`,
    sub: row.number ? `#${row.number}` : "",
    stat: getOpponentStats(index),
    current: index === current,
  }));
}

function renderBoxStatsTable(title, rows) {
  const totals = rows.reduce((sum, row) => addStatTotals(sum, row.stat), { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 });
  const body = rows.map((row) => {
    const s = row.stat || {};
    return `<tr class="${row.current ? "gd-stat-current" : ""}">
      <td class="gd-stat-num">${row.order}</td>
      <td class="gd-stat-name">${escapeHtml(row.name)}${row.sub ? `<span class="gd-stat-pos"> ${escapeHtml(row.sub)}</span>` : ""}</td>
      <td>${s.ab || 0}</td>
      <td>${s.h || 0}</td>
      <td>${s.hr || 0}</td>
      <td>${s.bb || 0}</td>
      <td>${s.hbp || 0}</td>
      <td>${s.k || 0}</td>
      <td class="gd-stat-avg">${getStatAvgText(s)}</td>
    </tr>`;
  }).join("");
  return `
    <table class="gd-stats-table gd-history-page-table">
      <colgroup>
        <col class="gd-stat-order-col" />
        <col class="gd-stat-name-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
      </colgroup>
      <thead>
        <tr>
          <th colspan="2" class="gd-stats-head-team">${escapeHtml(title)}</th>
          <th>AB</th><th>H</th><th>HR</th><th>BB</th><th>HBP</th><th>K</th><th>AVG</th>
        </tr>
      </thead>
      <tbody>
        ${body || `<tr><td colspan="9">Sem jogadores.</td></tr>`}
        <tr class="gd-stat-totals">
          <td colspan="2">Totais</td>
          <td>${totals.ab}</td><td>${totals.h}</td><td>${totals.hr}</td><td>${totals.bb}</td><td>${totals.hbp}</td><td>${totals.k}</td>
          <td class="gd-stat-avg">${getStatAvgText(totals)}</td>
        </tr>
      </tbody>
    </table>`;
}

function getHistorySummary(history = loadMatchHistory()) {
  const summary = { wins: 0, losses: 0, ties: 0, runsFor: 0, runsAgainst: 0, ab: 0, h: 0, bb: 0, hbp: 0 };
  history.forEach((entry) => {
    const result = getMatchResult(entry);
    if (result.className === "is-win") summary.wins += 1;
    else if (result.className === "is-lose") summary.losses += 1;
    else summary.ties += 1;
    summary.runsFor += result.ttbRuns;
    summary.runsAgainst += result.oppRuns;
    (entry.ourLineup || []).forEach((player) => {
      const stat = entry.playerStats?.[player.id] || {};
      summary.ab += stat.ab || 0;
      summary.h += stat.h || 0;
      summary.bb += stat.bb || 0;
      summary.hbp += stat.hbp || 0;
    });
  });
  return summary;
}

function renderHistorySummaryCards(targetId) {
  const target = document.querySelector(`#${targetId}`);
  if (!target) return;
  const history = loadMatchHistory();
  const summary = getHistorySummary(history);
  target.innerHTML = `
    <div class="gd-history-mini-stat"><span>Jogos</span><strong>${history.length}</strong></div>
    <div class="gd-history-mini-stat"><span>Vitórias</span><strong>${summary.wins}</strong></div>
    <div class="gd-history-mini-stat"><span>Pontos</span><strong>${summary.runsFor}-${summary.runsAgainst}</strong></div>
    <div class="gd-history-mini-stat"><span>AVG Geral</span><strong>${getStatAvgText(summary)}</strong></div>
  `;
}

function historyStatRow(label, stat = {}, extra = "") {
  const opts = (extra && typeof extra === "object") ? extra : {};
  const detail = (extra && typeof extra === "object") ? opts.extra || "" : extra;
  if (opts.matchId && opts.statKey) {
    const input = (field) => `<input class="gd-history-stat-input" type="number" min="0" value="${stat[field] || 0}" data-history-stat-key="${escapeHtml(opts.statKey)}" data-history-stat-field="${field}" />`;
    const nameCell = opts.lineup
      ? `<td class="gd-history-player gd-history-player-edit">
          <span>${opts.order || ""}</span>
          <input class="gd-history-player-input" type="text" value="${escapeHtml(opts.name || "")}" data-history-lineup="${escapeHtml(opts.lineup)}" data-history-lineup-index="${opts.index}" data-history-lineup-field="name" />
          <span class="gd-history-player-meta">
            ${opts.lineup === "ourLineup" ? `<input type="text" value="${escapeHtml(opts.position || "")}" placeholder="POS" data-history-lineup="${escapeHtml(opts.lineup)}" data-history-lineup-index="${opts.index}" data-history-lineup-field="position" />` : ""}
            <input type="text" value="${escapeHtml(opts.number || "")}" placeholder="#" data-history-lineup="${escapeHtml(opts.lineup)}" data-history-lineup-index="${opts.index}" data-history-lineup-field="number" />
          </span>
        </td>`
      : `<td class="gd-history-player">${escapeHtml(label)}${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</td>`;
    return `<tr>
      ${nameCell}
      <td>${input("ab")}</td>
      <td>${input("h")}</td>
      <td>${input("hr")}</td>
      <td>${input("bb")}</td>
      <td>${input("hbp")}</td>
      <td>${input("k")}</td>
      <td class="gd-stat-avg">${formatHistoryAvg(stat)}</td>
    </tr>`;
  }
  return `<tr>
    <td class="gd-history-player">${escapeHtml(label)}${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</td>
    <td>${stat.ab || 0}</td>
    <td>${stat.h || 0}</td>
    <td>${stat.hr || 0}</td>
    <td>${stat.bb || 0}</td>
    <td>${stat.hbp || 0}</td>
    <td>${stat.k || 0}</td>
    <td class="gd-stat-avg">${formatHistoryAvg(stat)}</td>
  </tr>`;
}

function renderHistoryStatsTable(title, rows) {
  return `<section class="gd-history-team">
    <h4>${escapeHtml(title)}</h4>
    <table class="gd-history-table">
      <thead><tr><th>Jogador</th><th>AB</th><th>H</th><th>HR</th><th>BB</th><th>HBP</th><th>K</th><th>AVG</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8">Sem stats.</td></tr>`}</tbody>
    </table>
  </section>`;
}

function renderMatchHistoryDetail(entry, targetSelector = "#matchHistoryDetail") {
  const detail = document.querySelector(targetSelector);
  if (!detail) return;
  if (!entry) {
    detail.innerHTML = "";
    return;
  }
  const score = entry.score || {};
  const result = getMatchResult(entry);
  const ttbName = entry.ttbSide === "away" ? score.awayName || "TTB" : score.homeName || "TTB";
  const oppName = entry.ttbSide === "away" ? score.homeName || "Visitante" : score.awayName || "Visitante";
  const stats = entry.playerStats || {};
  const ourLineup = entry.ourLineup || [];
  const opponentRows = entry.opponentLineup || [];
  const ourRows = ourLineup
    .map((player, index) => historyStatRow(`${player.order}. ${player.name}`, stats[player.id] || {}, {
      matchId: entry.id,
      statKey: player.id,
      extra: [player.position, player.number ? `#${player.number}` : ""].filter(Boolean).join(" "),
      lineup: "ourLineup",
      index,
      order: player.order,
      name: player.name,
      position: player.position,
      number: player.number,
    }))
    .join("");
  const oppRows = opponentRows
    .map((row, index) => historyStatRow(`${row.order || index + 1}. ${row.name || `Adversario ${index + 1}`}`, stats[getOpponentStatKey(index)] || stats[`away_${index}`] || stats[`home_${index}`] || {}, {
      matchId: entry.id,
      statKey: getOpponentStatKey(index),
      extra: row.number ? `#${row.number}` : "",
      lineup: "opponentLineup",
      index,
      order: row.order || index + 1,
      name: row.name || "",
      number: row.number || "",
    }))
    .join("");
  const statsGrid = entry.manualOnlyOurStats
    ? renderHistoryStatsTable(ttbName, ourRows)
    : `${renderHistoryStatsTable(ttbName, ourRows)}${renderHistoryStatsTable(oppName, oppRows)}`;

  detail.innerHTML = `
    <div class="gd-history-editor-actions">
      <button type="button" class="gd-history-danger" data-history-delete="${escapeHtml(entry.id)}">Apagar partida</button>
      <button type="button" class="gd-history-danger is-ghost" data-history-clear>Apagar tudo</button>
    </div>
    <div class="gd-history-score gd-history-score-edit">
      <label><span>Visitante</span><input type="text" value="${escapeHtml(score.awayName || "Visitante")}" data-history-score-field="awayName" /></label>
      <input class="gd-history-score-input" type="number" min="0" value="${score.awayRuns ?? 0}" data-history-score-field="awayRuns" />
      <strong>-</strong>
      <input class="gd-history-score-input" type="number" min="0" value="${score.homeRuns ?? 0}" data-history-score-field="homeRuns" />
      <label><span>Casa</span><input type="text" value="${escapeHtml(score.homeName || "TTB")}" data-history-score-field="homeName" /></label>
      <em class="${result.className}">${result.label}</em>
      <small>H <input type="number" min="0" value="${score.awayHits ?? 0}" data-history-score-field="awayHits" /> - <input type="number" min="0" value="${score.homeHits ?? 0}" data-history-score-field="homeHits" /></small>
      <small>E <input type="number" min="0" value="${score.awayErrors ?? 0}" data-history-score-field="awayErrors" /> - <input type="number" min="0" value="${score.homeErrors ?? 0}" data-history-score-field="homeErrors" /></small>
    </div>
    <div class="gd-history-stats-grid${entry.manualOnlyOurStats ? " is-single" : ""}">
      ${statsGrid}
    </div>
  `;
  bindHistoryEditor(detail, entry.id);
}

function bindHistoryEditor(root, matchId) {
  root.querySelectorAll("[data-history-score-field]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const field = event.currentTarget.dataset.historyScoreField;
      updateMatchHistoryEntry(matchId, (entry) => {
        if (!entry.score) entry.score = {};
        const isText = field === "awayName" || field === "homeName";
        entry.score[field] = isText
          ? event.currentTarget.value.trim()
          : Math.max(0, parseInt(event.currentTarget.value, 10) || 0);
      });
    });
  });

  root.querySelectorAll("[data-history-stat-key][data-history-stat-field]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const key = event.currentTarget.dataset.historyStatKey;
      const field = event.currentTarget.dataset.historyStatField;
      const value = Math.max(0, parseInt(event.currentTarget.value, 10) || 0);
      updateMatchHistoryEntry(matchId, (entry) => {
        if (!entry.playerStats) entry.playerStats = {};
        if (!entry.playerStats[key]) entry.playerStats[key] = { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 };
        entry.playerStats[key][field] = value;
      });
    });
  });

  root.querySelectorAll("[data-history-lineup][data-history-lineup-field]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const lineup = event.currentTarget.dataset.historyLineup;
      const index = Number(event.currentTarget.dataset.historyLineupIndex);
      const field = event.currentTarget.dataset.historyLineupField;
      const value = event.currentTarget.value.trim();
      updateMatchHistoryEntry(matchId, (entry) => {
        if (!Array.isArray(entry[lineup]) || !entry[lineup][index]) return;
        entry[lineup][index][field] = value;
      });
    });
  });

  root.querySelector("[data-history-delete]")?.addEventListener("click", () => deleteMatchHistoryEntry(matchId));
  root.querySelector("[data-history-clear]")?.addEventListener("click", clearMatchHistory);
}

function renderMatchHistory() {
  const container = document.querySelector("#matchHistoryList");
  if (!container) return;
  renderHistorySummaryCards("matchHistorySummary");
  const history = loadMatchHistory();
  if (history.length === 0) {
    container.innerHTML = `<p class="gd-match-history-empty">Nenhuma partida arquivada.</p>`;
    renderMatchHistoryDetail(null);
    return;
  }
  if (!activeMatchHistoryId || !history.some((entry) => entry.id === activeMatchHistoryId)) {
    activeMatchHistoryId = history[0]?.id || "";
  }
  container.innerHTML = history.slice(0, 8).map((entry) => {
    const score = entry.score || {};
    const result = getMatchResult(entry);
    const ttbName = entry.ttbSide === "away" ? score.awayName || "TTB" : score.homeName || "TTB";
    const oppName = entry.ttbSide === "away" ? score.homeName || "Visitante" : score.awayName || "Visitante";
    const date = new Date(entry.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const time = new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `<button class="gd-match-history-item${activeMatchHistoryId === entry.id ? " is-active" : ""}" type="button" data-match-id="${escapeHtml(entry.id)}">
      <span>${escapeHtml(date)} ${escapeHtml(time)}</span>
      <strong>${escapeHtml(ttbName)} ${result.ttbRuns} - ${result.oppRuns} ${escapeHtml(oppName)} <em class="${result.className}">${result.label}</em></strong>
      <small>Placar oficial: ${escapeHtml(score.awayName || "Visitante")} ${score.awayRuns ?? 0} - ${score.homeRuns ?? 0} ${escapeHtml(score.homeName || "TTB")}</small>
    </button>`;
  }).join("");
  container.querySelectorAll("[data-match-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMatchHistoryId = button.dataset.matchId || "";
      activeStatusLineupTab = "history";
      renderStatusLineupTabs();
      renderMatchHistory();
    });
  });
  renderMatchHistoryDetail(history.find((entry) => entry.id === activeMatchHistoryId) || history[0]);
}

function getStatusBatterList() {
  return getActiveBatterIds()
    .map((id) => getPlayer(id))
    .filter(Boolean)
    .sort((a, b) => (battingOrders[a.id] || 99) - (battingOrders[b.id] || 99));
}

function getCurrentTeamBatterIndex(team = currentBattingTeam()) {
  return gameState.batterIndexes?.[team] ?? 0;
}

function advanceCurrentTeamBatter() {
  const team = currentBattingTeam();
  gameState.batterIndexes[team] = getCurrentTeamBatterIndex(team) + 1;
  if (isOurTeamSide(team)) {
    gameState.currentBatterIndex = gameState.batterIndexes[team];
  }
}

function getCurrentBatterLabel() {
  const team = currentBattingTeam();

  if (!isOurTeamSide(team)) {
    const row = opponentLineup[getCurrentTeamBatterIndex(team) % opponentLineup.length];
    if (!row) return "";
    if (row.name && row.number) return `#${row.number} ${row.name}`;
    if (row.name) return row.name;
    if (row.number) return `#${row.number}`;
    return `Adversario ${row.order}`;
  }

  const batters = getStatusBatterList();
  const current = batters[getCurrentTeamBatterIndex(team) % Math.max(batters.length, 1)];
  return current?.name ?? "";
}

function renderCountDots(containerId, filled, total, outStyle) {
  const el = document.querySelector(`#${containerId}`);
  if (!el) return;
  el.innerHTML = Array.from({ length: total }, (_, i) => {
    const on = i < filled;
    return `<span class="count-dot${on ? " is-on" : ""}${on && outStyle ? " is-out" : ""}"></span>`;
  }).join("");
}

function renderPitchDots() {
  const dots = document.querySelector("#pitchDots");
  if (!dots) return;
  dots.innerHTML = gameState.currentPitches
    .map(
      ({ x, y, isStrike, zone }, i) =>
        `<span class="pitch-dot ${isStrike ? "is-strike" : "is-ball"}" style="left:${x}%;top:${y}%"${zone ? ` title="Zona ${zone}"` : ""}><em>${i + 1}</em></span>`,
    )
    .join("");
}

function getPitchZoneResult(event, wrapper, zoneBox) {
  const wrapperRect = wrapper.getBoundingClientRect();
  const zoneRect = zoneBox.getBoundingClientRect();
  const rawX = ((event.clientX - wrapperRect.left) / wrapperRect.width) * 100;
  const rawY = ((event.clientY - wrapperRect.top) / wrapperRect.height) * 100;
  const x = Math.max(0, Math.min(100, rawX));
  const y = Math.max(0, Math.min(100, rawY));

  const insideX = event.clientX >= zoneRect.left && event.clientX <= zoneRect.right;
  const insideY = event.clientY >= zoneRect.top && event.clientY <= zoneRect.bottom;
  const isStrike = insideX && insideY;
  let zone = null;

  if (isStrike) {
    const zoneX = ((event.clientX - zoneRect.left) / zoneRect.width) * 100;
    const zoneY = ((event.clientY - zoneRect.top) / zoneRect.height) * 100;
    const column = Math.min(2, Math.max(0, Math.floor(zoneX / 33.3334)));
    const row = Math.min(2, Math.max(0, Math.floor(zoneY / 33.3334)));
    zone = row * 3 + column + 1;
  }

  return { x, y, isStrike, zone };
}

function bindPitchZone(wrapper, zoneBox, onPitch) {
  if (!wrapper || !zoneBox) return;
  wrapper.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    onPitch(getPitchZoneResult(event, wrapper, zoneBox), event);
  });
}

function renderStatusBattingOrder() {
  const container = document.querySelector("#statusBattingOrder");
  if (!container) return;
  const batters = getStatusBatterList();
  if (batters.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.8rem;padding:10px">Monte o lineup na aba Lineup primeiro.</p>`;
    return;
  }

  const current = getCurrentTeamBatterIndex(ttbSide) % batters.length;
  const totals = { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 };

  const rows = batters.map((player, i) => {
    const isCurrent = i === current;
    const pos = getAssignedPosition(player.id) || "—";
    const s = gameState.playerStats[player.id] || { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 };
    totals.ab += s.ab || 0; totals.h += s.h || 0; totals.hr += s.hr || 0; totals.bb += s.bb || 0; totals.hbp += s.hbp || 0; totals.k += s.k || 0;
    const avg = getStatAvgText(s);
    return `<tr class="${isCurrent ? "gd-stat-current" : ""}">
      <td class="gd-stat-num">${i + 1}</td>
      <td class="gd-stat-name">${escapeHtml(player.name)}<span class="gd-stat-pos"> ${escapeHtml(pos)}</span></td>
      <td>${s.ab || 0}</td>
      <td>${s.h  || 0}</td>
      <td>${s.hr || 0}</td>
      <td>${s.bb || 0}</td>
      <td>${s.hbp || 0}</td>
      <td>${s.k  || 0}</td>
      <td class="gd-stat-avg">${avg}</td>
    </tr>`;
  }).join("");

  const totalAvg = getStatAvgText(totals);

  container.innerHTML = `
    <table class="gd-stats-table">
      <colgroup>
        <col class="gd-stat-order-col" />
        <col class="gd-stat-name-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
      </colgroup>
      <thead>
        <tr>
          <th colspan="2" class="gd-stats-head-team">Nosso Time</th>
          <th class="gd-stat-metric-head">AB</th><th class="gd-stat-metric-head">H</th><th class="gd-stat-metric-head">HR</th><th class="gd-stat-metric-head">BB</th><th class="gd-stat-metric-head">HBP</th><th class="gd-stat-metric-head">K</th><th class="gd-stat-metric-head">AVG</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="gd-stat-totals">
          <td colspan="2">Totais</td>
          <td>${totals.ab}</td><td>${totals.h}</td><td>${totals.hr}</td>
          <td>${totals.bb}</td><td>${totals.hbp}</td><td>${totals.k}</td>
          <td class="gd-stat-avg">${totalAvg}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderOpponentLineup() {
  const container = document.querySelector("#opponentLineup");
  if (!container) return;
  const side = opponentSide();
  const current = getCurrentTeamBatterIndex(side) % opponentLineup.length;
  const totals = { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 };

  const rows = opponentLineup.map((row, index) => {
    const isCurrent = index === current;
    const s = getOpponentStats(index);
    totals.ab += s.ab || 0; totals.h += s.h || 0; totals.hr += s.hr || 0; totals.bb += s.bb || 0; totals.hbp += s.hbp || 0; totals.k += s.k || 0;
    const avg = getStatAvgText(s);
    return `<tr class="${isCurrent ? "gd-stat-current" : ""}">
      <td class="gd-stat-num">${row.order}</td>
      <td class="gd-stat-name gd-opp-inputs">
        <input class="opp-num-input" data-opponent-index="${index}" data-opponent-field="number"
          inputmode="numeric" placeholder="#" value="${escapeHtml(row.number)}" />
        <input class="opp-name-input" data-opponent-index="${index}" data-opponent-field="name"
          placeholder="Jogador ${row.order}" value="${escapeHtml(row.name)}" />
      </td>
      <td>${s.ab || 0}</td>
      <td>${s.h  || 0}</td>
      <td>${s.hr || 0}</td>
      <td>${s.bb || 0}</td>
      <td>${s.hbp || 0}</td>
      <td>${s.k  || 0}</td>
      <td class="gd-stat-avg">${avg}</td>
    </tr>`;
  }).join("");

  const totalAvg = getStatAvgText(totals);

  container.innerHTML = `
    <table class="gd-stats-table">
      <colgroup>
        <col class="gd-stat-order-col" />
        <col class="gd-stat-name-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
        <col class="gd-stat-metric-col" />
      </colgroup>
      <thead>
        <tr>
          <th colspan="2" class="gd-stats-head-team">Adversário</th>
          <th>AB</th><th>H</th><th>HR</th><th>BB</th><th>HBP</th><th>K</th><th>AVG</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="gd-stat-totals">
          <td colspan="2">Totais</td>
          <td>${totals.ab}</td><td>${totals.h}</td><td>${totals.hr}</td>
          <td>${totals.bb}</td><td>${totals.hbp}</td><td>${totals.k}</td>
          <td class="gd-stat-avg">${totalAvg}</td>
        </tr>
      </tbody>
    </table>
  `;

  container.querySelectorAll(".opp-num-input, .opp-name-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const el = event.currentTarget;
      const row = opponentLineup[Number(el.dataset.opponentIndex)];
      if (!row) return;
      row[el.dataset.opponentField] = el.value;
      saveOpponentLineup();
    });
  });
}

function renderStatusLineupTabs() {
  const homeButton = document.querySelector("#homeLineupTab");
  const awayButton = document.querySelector("#awayLineupTab");
  const historyButton = document.querySelector("#historyLineupTab");
  const homePanel = document.querySelector("#homeLineupPanel");
  const awayPanel = document.querySelector("#awayLineupPanel");
  const historyPanel = document.querySelector("#historyLineupPanel");

  homeButton?.classList.toggle("is-active", activeStatusLineupTab === "home");
  awayButton?.classList.toggle("is-active", activeStatusLineupTab === "away");
  historyButton?.classList.toggle("is-active", activeStatusLineupTab === "history");
  if (homePanel) homePanel.hidden = activeStatusLineupTab !== "home";
  if (awayPanel) awayPanel.hidden = activeStatusLineupTab !== "away";
  if (historyPanel) historyPanel.hidden = activeStatusLineupTab !== "history";
}

function renderScoreboardLabels() {
  normalizeTeamNamesForSide();
  const awayName = document.querySelector("#awayName")?.value || (ttbSide === "away" ? "TTB" : "Visitante");
  const homeName = document.querySelector("#homeName")?.value || (ttbSide === "home" ? "TTB" : "Visitante");
  const awayLabel = document.querySelector("#awayLabel");
  const homeLabel = document.querySelector("#homeLabel");
  if (awayLabel) awayLabel.textContent = awayName;
  if (homeLabel) homeLabel.textContent = homeName;
  document.querySelector("#awayScoreRow")?.classList.toggle("gd-our-team-row", ttbSide === "away");
  document.querySelector("#homeScoreRow")?.classList.toggle("gd-our-team-row", ttbSide === "home");
  document.querySelector(".gd-away")?.classList.toggle("gd-our-team-block", ttbSide === "away");
  document.querySelector(".gd-home")?.classList.toggle("gd-our-team-block", ttbSide === "home");
  const swapBtn = document.querySelector("#btnSwapTeams");
  if (swapBtn) swapBtn.textContent = ttbSide === "home" ? "TTB em cima" : "TTB embaixo";
}

function currentTeamNames() {
  const awayName = document.querySelector("#awayName")?.value || (ttbSide === "away" ? "TTB" : "Visitante");
  const homeName = document.querySelector("#homeName")?.value || (ttbSide === "home" ? "TTB" : "Visitante");
  return {
    awayName,
    homeName,
    ourName: ttbSide === "away" ? awayName : homeName,
    oppName: ttbSide === "away" ? homeName : awayName,
  };
}

function renderHistoryPage() {
  const page = document.querySelector("#historyPage");
  if (!page || page.hidden) return;
  const content = document.querySelector("#historyPageContent");
  if (content) content.innerHTML = `<div id="historyMatchDetail" class="gd-match-history-detail"></div>`;
  renderHistoryMatchTabs();
  renderHistorySummaryCards("historyPageSummary");
}

function renderHistoryMatchTabs() {
  const list = document.querySelector("#historyMatchTabs");
  const detail = document.querySelector("#historyMatchDetail");
  const scoreEl = document.querySelector("#historyPageScore");
  if (!list || !detail) return;
  const history = loadMatchHistory();
  if (history.length === 0) {
    list.innerHTML = `
      <button class="gd-history-new-match" type="button" data-history-new-match>Nova partida</button>
      <p class="gd-match-history-empty">Nenhuma partida arquivada.</p>
    `;
    list.querySelector("[data-history-new-match]")?.addEventListener("click", createManualHistoryMatch);
    detail.innerHTML = `<p class="gd-match-history-empty">Crie uma partida para registrar placar e stats dos nossos jogadores.</p>`;
    if (scoreEl) scoreEl.innerHTML = "";
    return;
  }
  if (!activeMatchHistoryId || !history.some((entry) => entry.id === activeMatchHistoryId)) {
    activeMatchHistoryId = history[0]?.id || "";
  }
  const newMatchButton = `<button class="gd-history-new-match" type="button" data-history-new-match>Nova partida</button>`;
  list.innerHTML = newMatchButton + history.slice(0, 12).map((entry) => {
    const score = entry.score || {};
    const result = getMatchResult(entry);
    const ttbName = entry.ttbSide === "away" ? score.awayName || "TTB" : score.homeName || "TTB";
    const oppName = entry.ttbSide === "away" ? score.homeName || "Visitante" : score.awayName || "Visitante";
    const date = new Date(entry.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return `<button class="gd-history-match-tab${activeMatchHistoryId === entry.id ? " is-active" : ""}" type="button" data-match-id="${escapeHtml(entry.id)}" aria-expanded="${activeMatchHistoryId === entry.id}">
      <span>${escapeHtml(date)}</span>
      <strong>${escapeHtml(ttbName)} ${result.ttbRuns} - ${result.oppRuns} ${escapeHtml(oppName)} <em class="${result.className}">${result.label}</em></strong>
      <small>H ${score.awayHits ?? 0}-${score.homeHits ?? 0} · E ${score.awayErrors ?? 0}-${score.homeErrors ?? 0}</small>
    </button>`;
  }).join("");
  list.querySelector("[data-history-new-match]")?.addEventListener("click", createManualHistoryMatch);
  list.querySelectorAll("[data-match-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMatchHistoryId = button.dataset.matchId || "";
      renderHistoryMatchTabs();
    });
  });
  const entry = history.find((item) => item.id === activeMatchHistoryId) || history[0];
  const score = entry.score || {};
  const result = getMatchResult(entry);
  const ttbName = entry.ttbSide === "away" ? score.awayName || "TTB" : score.homeName || "TTB";
  const oppName = entry.ttbSide === "away" ? score.homeName || "Visitante" : score.awayName || "Visitante";
  if (scoreEl) {
    scoreEl.innerHTML = `
      <span>${escapeHtml(ttbName)}</span>
      <strong>${result.ttbRuns} - ${result.oppRuns}</strong>
      <span>${escapeHtml(oppName)}</span>
    `;
  }
  renderMatchHistoryDetail(entry, "#historyMatchDetail");
}

function setStatusView(view) {
  const isHistory = view === "history";
  const statusTab = document.querySelector("#statusTab");
  const historyPage = document.querySelector("#historyPage");
  if (statusTab) statusTab.hidden = isHistory;
  if (historyPage) historyPage.hidden = !isHistory;
  document.querySelector("#statusTopTab")?.classList.toggle("is-active", !isHistory);
  document.querySelector("#historyTopTab")?.classList.toggle("is-active", isHistory);
  if (isHistory) renderHistoryPage();
}

function computeRuns() {
  ["away", "home"].forEach((team) => {
    const cells = document.querySelectorAll(`td[data-team="${team}"]`);
    let total = 0;
    cells.forEach((cell) => {
      const val = parseInt(cell.textContent.trim(), 10);
      if (!isNaN(val)) total += val;
    });
    const runsEl = document.querySelector(`#${team}Runs`);
    if (runsEl) runsEl.textContent = total;
    const bigEl = document.querySelector(`#${team}RunsBig`);
    if (bigEl) bigEl.textContent = total;
  });
}

function getCellNumber(cell) {
  const value = parseInt(cell?.textContent.trim() || "0", 10);
  return Number.isNaN(value) ? 0 : value;
}

function currentBattingTeam() {
  return gameState.isTop ? "away" : "home";
}

function addCurrentTeamRuns(amount) {
  if (!amount) return;
  const cell = document.querySelector(
    `td[data-team="${currentBattingTeam()}"][data-inning="${gameState.inning}"]`,
  );
  if (!cell) return;
  cell.textContent = getCellNumber(cell) + amount;
  computeRuns();
}

function addCurrentTeamHit() {
  const hitsCell = document.querySelector(`#${currentBattingTeam()}Hits`);
  if (!hitsCell) return;
  hitsCell.textContent = getCellNumber(hitsCell) + 1;
}

function advanceBatterByWalk() {
  let [first, second, third] = gameState.bases;
  const forcedRun = first && second && third;
  const runs = forcedRun ? 1 : 0;

  if (first) {
    if (second) {
      third = true;
    }
    second = true;
  }

  first = true;
  gameState.bases = [first, second, third];
  addCurrentTeamRuns(runs);
  return runs;
}

function recordBatterStat(field, amount = 1) {
  const team = currentBattingTeam();
  let key;

  if (isOurTeamSide(team)) {
    const batters = getStatusBatterList();
    if (!batters.length) return;
    const batter = batters[getCurrentTeamBatterIndex(team) % batters.length];
    if (!batter) return;
    key = batter.id;
  } else {
    const idx = getCurrentTeamBatterIndex(team) % Math.max(opponentLineup.length, 1);
    key = getOpponentStatKey(idx);
  }

  if (!gameState.playerStats[key]) {
    gameState.playerStats[key] = { ab: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0 };
  }
  gameState.playerStats[key][field] = (gameState.playerStats[key][field] || 0) + amount;

  if (isOurTeamSide(team)) {
    recordSitePlayerStat(key, field, amount);
  }
}

function completeWalk() {
  const runs = advanceBatterByWalk();
  recordBatterStat("ab");
  recordBatterStat("bb");
  logPlay(runs ? "Walk (BB) - entrou 1 corrida" : "Walk (BB)");
  nextBatter();
}

function completeHitByPitch() {
  const runs = advanceBatterByWalk();
  recordBatterStat("ab");
  recordBatterStat("hbp");
  logPlay(runs ? "HBP - entrou 1 corrida" : "HBP");
  nextBatter();
}

function completeHit() {
  addCurrentTeamHit();
  recordBatterStat("ab");
  recordBatterStat("h");
  logPlay("Hit");
  nextBatter();
}

function completeHomeRun() {
  const runs = gameState.bases.filter(Boolean).length + 1;
  addCurrentTeamHit();
  addCurrentTeamRuns(runs);
  gameState.bases = [false, false, false];
  recordBatterStat("ab");
  recordBatterStat("h");
  recordBatterStat("hr");
  logPlay(runs > 1 ? `Home Run - ${runs} corridas` : "Home Run");
  nextBatter();
}

function highlightCurrentInning() {
  document.querySelectorAll(".scoreboard-table td[data-inning]").forEach((td) => {
    td.classList.toggle(
      "is-current-inning",
      parseInt(td.dataset.inning, 10) === gameState.inning,
    );
  });
}

function renderStatus() {
  const inningHalf = document.querySelector("#inningHalf");
  const inningNum  = document.querySelector("#inningNumber");
  if (inningHalf) inningHalf.textContent = gameState.isTop ? "▲" : "▼";
  if (inningNum)  inningNum.textContent  = gameState.inning;

  renderCountDots("ballDots",   gameState.balls,   4, false);
  renderCountDots("strikeDots", gameState.strikes, 3, false);
  renderCountDots("outDots",    gameState.outs,    3, true);

  ["baseFirst", "baseSecond", "baseThird"].forEach((id, i) => {
    const btn = document.querySelector(`#${id}`);
    if (btn) {
      btn.classList.toggle("is-occupied", gameState.bases[i]);
      btn.setAttribute("aria-pressed", String(gameState.bases[i]));
    }
  });

  renderPitchDots();
  renderPlayLog();
  renderStatusBattingOrder();
  renderOpponentLineup();
  renderStatusLineupTabs();
  renderScoreboardLabels();
  renderMatchHistory();
  renderHistoryPage();
  highlightCurrentInning();
  const gdBatter = document.querySelector("#gdCurrentBatter");
  if (gdBatter) gdBatter.textContent = getCurrentBatterLabel() || "— sem rebatedor —";
  if (typeof autosaveJogo === "function") autosaveJogo();
}

function resetCount() {
  gameState.balls   = 0;
  gameState.strikes = 0;
  gameState.currentPitches = [];
  renderStatus();
}

function nextBatter() {
  advanceCurrentTeamBatter();
  resetCount();
}

function addOut() {
  recordBatterStat("ab");
  recordBatterStat("k");
  gameState.outs += 1;
  logPlay(`Out (K) #${gameState.outs}`);
  if (gameState.outs >= 3) {
    gameState.outs = 0;
    gameState.isTop = !gameState.isTop;
    if (!gameState.isTop) gameState.inning += 1;
    gameState.bases = [false, false, false];
    logSystemPlay(`Fim do ${gameState.isTop ? "topo" : "baixo"} ${gameState.inning} inning`);
  }
  resetCount();
}

function logPlay(text) {
  const current = getCurrentBatterLabel();
  const meta = `${gameState.isTop ? "▲" : "▼"}${gameState.inning}`;
  gameState.plays.unshift({ meta, text: current ? `${current} - ${text}` : text });
  renderPlayLog();
}

function logSystemPlay(text) {
  const meta = `${gameState.isTop ? "▲" : "▼"}${gameState.inning}`;
  gameState.plays.unshift({ meta, text });
  renderPlayLog();
}

function getPlayBadge(text) {
  const t = text.toLowerCase();
  if (t.includes("strikeout"))               return ["K",    "k"];
  if (t.includes("walk") || t.includes("(bb)")) return ["BB", "bb"];
  if (t.includes("hbp") || t.includes("dead ball")) return ["HBP", "hbp"];
  if (t.includes("home run"))                return ["HR",   "hr"];
  if (t.includes(" hit") || text === "Hit")  return ["Hit",  "hit"];
  if (t.includes("out"))                     return ["Out",  "out"];
  return null;
}

function renderPlayLog() {
  const list = document.querySelector("#playLog");
  if (!list) return;
  list.innerHTML = gameState.plays
    .map(({ meta, text }) => {
      const badge = getPlayBadge(text);
      const isSys = text.toLowerCase().includes("fim do") || text.toLowerCase().includes("inning");
      return `<li class="gd-play-item${isSys ? " gd-play-sys" : ""}">
        <span class="gd-play-meta">${escapeHtml(meta)}</span>
        ${badge ? `<span class="gd-play-badge gd-badge-${badge[1]}">${escapeHtml(badge[0])}</span>` : ""}
        <span class="gd-play-text">${escapeHtml(text)}</span>
      </li>`;
    })
    .join("");
}

/* ── Pitch zone click ── */
const pitchWrapper = document.querySelector("#pitchZoneWrapper");
const pitchZoneBox = document.querySelector("#pitchZoneBox");

if (pitchWrapper && pitchZoneBox) {
  bindPitchZone(pitchWrapper, pitchZoneBox, ({ x, y, isStrike, zone }) => {
    gameState.currentPitches.push({ x, y, isStrike, zone });

    if (isStrike) {
      gameState.strikes += 1;
      if (gameState.strikes >= 3) {
        recordBatterStat("ab");
        recordBatterStat("k");
        logPlay("Strikeout");
        nextBatter();
        return;
      }
    } else {
      gameState.balls += 1;
      if (gameState.balls >= 4) {
        completeWalk();
        return;
      }
    }
    renderStatus();
  });
}

if (PAGE === "status") {
  loadCustomPlayers();
  loadPlayerTags();
  loadLineupState();
  loadOpponentLineup();
  syncSitePlayerStatsFromRemote();
  setStatusView(new URLSearchParams(window.location.search).get("view") === "history" ? "history" : "status");

  function refreshStatusLineupFromStorage() {
    loadCustomPlayers();
    loadPlayerTags();
    loadLineupState();
    renderStatus();
  }

  window.addEventListener("focus", refreshStatusLineupFromStorage);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshStatusLineupFromStorage();
  });
  window.addEventListener("storage", (event) => {
    const lineupKey = "ttb_lineup_" + getUser();
    if ([lineupKey, CUSTOM_PLAYERS_KEY, PLAYER_TAGS_KEY].includes(event.key)) {
      refreshStatusLineupFromStorage();
    }
  });

  /* ── Status button handlers ── */
  document.querySelector("#btnBall")?.addEventListener("click", () => {
    gameState.balls += 1;
    if (gameState.balls >= 4) { completeWalk(); }
    else renderStatus();
  });

  document.querySelector("#btnStrike")?.addEventListener("click", () => {
    gameState.strikes += 1;
    if (gameState.strikes >= 3) {
      recordBatterStat("ab");
      recordBatterStat("k");
      logPlay("Strikeout");
      nextBatter();
    } else renderStatus();
  });

  document.querySelector("#btnOut")?.addEventListener("click", addOut);
  document.querySelector("#btnHit")?.addEventListener("click", completeHit);
  document.querySelector("#btnHomeRun")?.addEventListener("click", completeHomeRun);
  document.querySelector("#btnHbp")?.addEventListener("click", completeHitByPitch);
  document.querySelector("#btnNextBatter")?.addEventListener("click", () => { nextBatter(); renderStatus(); });
  document.querySelector("#btnResetCount")?.addEventListener("click", resetCount);
  document.querySelector("#btnSwapTeams")?.addEventListener("click", swapTeamSides);

  document.querySelector("#homeLineupTab")?.addEventListener("click", () => {
    activeStatusLineupTab = "home";
    renderStatusLineupTabs();
  });

  document.querySelector("#awayLineupTab")?.addEventListener("click", () => {
    activeStatusLineupTab = "away";
    renderStatusLineupTabs();
  });

  document.querySelector("#historyLineupTab")?.addEventListener("click", () => {
    activeStatusLineupTab = "history";
    renderStatusLineupTabs();
    renderMatchHistory();
  });

  document.querySelector("#prevInning")?.addEventListener("click", () => {
    if (gameState.inning > 1 || !gameState.isTop) {
      if (gameState.isTop) { gameState.inning -= 1; gameState.isTop = false; }
      else gameState.isTop = true;
      renderStatus();
    }
  });

  document.querySelector("#nextInning")?.addEventListener("click", () => {
    if (gameState.isTop) gameState.isTop = false;
    else { gameState.isTop = true; gameState.inning += 1; }
    renderStatus();
  });

  ["baseFirst", "baseSecond", "baseThird"].forEach((id, i) => {
    document.querySelector(`#${id}`)?.addEventListener("click", () => {
      gameState.bases[i] = !gameState.bases[i];
      renderStatus();
    });
  });

  document.querySelector("#btnAddPlay")?.addEventListener("click", () => {
    const input = document.querySelector("#playInput");
    const text  = input?.value.trim();
    if (!text) return;
    logPlay(text);
    if (input) input.value = "";
    renderStatus();
  });

  document.querySelector("#playInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.querySelector("#btnAddPlay")?.click();
  });

  /* ── Scoreboard: auto-sum runs on cell edit ── */
  document.querySelectorAll(".scoreboard-table td[contenteditable][data-team]").forEach((td) => {
    td.addEventListener("input", computeRuns);
  });

  /* ── Team name inputs sync labels ── */
  document.querySelector("#awayName")?.addEventListener("input", renderScoreboardLabels);
  document.querySelector("#homeName")?.addEventListener("input", renderScoreboardLabels);

  renderStatus();
}

/* ═══════════════════════════════
   TESTE TAB
═══════════════════════════════ */

const testeState = {
  batters: [],        // { id, name, completedABs: ['hit'|'out'|'k'|'bb'], currentPitches: [{x,y,isStrike}] }
  currentIndex: 0,
  nextId: 1,
};

const SOFTBALL_ATBATS_KEY = "ttb_softball_atbats";
let softballAtBats = [];

function testeBatterAB(batter) {
  return batter.completedABs.filter((r) => r === "hit" || r === "out" || r === "k").length;
}
function testeBatterHits(batter) {
  return batter.completedABs.filter((r) => r === "hit").length;
}
function testeBatterBB(batter) {
  return batter.completedABs.filter((r) => r === "bb").length;
}
function testeBatterK(batter) {
  return batter.completedABs.filter((r) => r === "k").length;
}
function testeAvg(batter) {
  const ab = testeBatterAB(batter);
  if (ab === 0) return ".000";
  const avg = testeBatterHits(batter) / ab;
  return "." + String(Math.round(avg * 1000)).padStart(3, "0");
}

function testeCurrentBatter() {
  return testeState.batters[testeState.currentIndex] ?? null;
}

function testeCurrentBalls() {
  const b = testeCurrentBatter();
  return b ? b.currentPitches.filter((p) => !p.isStrike).length : 0;
}

function testeCurrentStrikes() {
  const b = testeCurrentBatter();
  return b ? b.currentPitches.filter((p) => p.isStrike).length : 0;
}

function testeCompleteAB(result) {
  const b = testeCurrentBatter();
  if (!b) return;
  b.completedABs.push(result);
  b.currentPitches = [];
  renderTeste();
}

function testeAddPitch(x, y, isStrike, zone = null) {
  const b = testeCurrentBatter();
  if (!b) return;
  b.currentPitches.push({ x, y, isStrike, zone });
  const strikes = testeCurrentStrikes();
  const balls   = testeCurrentBalls();
  if (strikes >= 3) { testeCompleteAB("k"); return; }
  if (balls   >= 4) { testeCompleteAB("bb"); return; }
  renderTeste();
}

function renderTestePitchDots() {
  const b    = testeCurrentBatter();
  const dots = document.querySelector("#testePitchDots");
  if (!dots) return;
  dots.innerHTML = (b?.currentPitches ?? [])
    .map(({ x, y, isStrike, zone }) =>
      `<span class="pitch-dot ${isStrike ? "is-strike" : "is-ball"}" style="left:${x}%;top:${y}%"${zone ? ` title="Zona ${zone}"` : ""}></span>`)
    .join("");
}

function renderTesteBatterList() {
  const list = document.querySelector("#testeBatterList");
  if (!list) return;
  if (testeState.batters.length === 0) {
    list.innerHTML = `<li style="color:var(--text-muted);font-size:0.8rem;padding:8px">Adicione rebatedores acima.</li>`;
    return;
  }
  list.innerHTML = testeState.batters
    .map((b, i) => {
      const isCurrent = i === testeState.currentIndex;
      return `<li class="teste-batter-item${isCurrent ? " is-current" : ""}" data-idx="${i}">
        <span class="teste-batter-num">${i + 1}</span>
        <span>${escapeHtml(b.name)}</span>
        <button class="teste-batter-remove" data-remove="${i}" aria-label="Remover ${escapeHtml(b.name)}">×</button>
      </li>`;
    })
    .join("");

  list.querySelectorAll(".teste-batter-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      testeState.currentIndex = Number(el.dataset.idx);
      renderTeste();
    });
  });
  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.remove);
      testeState.batters.splice(idx, 1);
      if (testeState.currentIndex >= testeState.batters.length) {
        testeState.currentIndex = Math.max(0, testeState.batters.length - 1);
      }
      renderTeste();
    });
  });
}

function renderTesteStats() {
  const tbody = document.querySelector("#testeStatsBody");
  if (!tbody) return;
  if (testeState.batters.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);padding:10px">Nenhum rebatedor.</td></tr>`;
    return;
  }
  tbody.innerHTML = testeState.batters
    .map((b, i) => {
      const isCurrent = i === testeState.currentIndex;
      return `<tr class="${isCurrent ? "is-current-batter" : ""}">
        <td>${escapeHtml(b.name)}</td>
        <td>${testeBatterAB(b)}</td>
        <td>${testeBatterHits(b)}</td>
        <td>${testeBatterBB(b)}</td>
        <td>${testeBatterK(b)}</td>
        <td class="avg-cell">${testeAvg(b)}</td>
      </tr>`;
    })
    .join("");
}

function renderTesteLeaderboard() {
  const container = document.querySelector("#testeLeaderboard");
  const content   = document.querySelector("#testeLeaderboardContent");
  if (!container || !content) return;

  const withAB = testeState.batters.filter((b) => testeBatterAB(b) > 0);
  if (withAB.length === 0) { container.hidden = true; return; }

  container.hidden = false;
  const sorted = [...withAB].sort((a, b) => {
    const avgA = testeBatterHits(a) / testeBatterAB(a);
    const avgB = testeBatterHits(b) / testeBatterAB(b);
    return avgB - avgA;
  });

  const medals = ["🥇", "🥈", "🥉"];
  content.innerHTML = sorted
    .map((b, i) => {
      const rank = i < 3 ? medals[i] : `${i + 1}.`;
      return `<div class="leaderboard-entry">
        <span class="leaderboard-rank rank-${i + 1}">${rank}</span>
        <span>${escapeHtml(b.name)}</span>
        <span style="color:var(--text-muted);font-size:0.76rem;margin-left:6px">${testeBatterAB(b)} AB · ${testeBatterHits(b)} H</span>
        <span class="leaderboard-avg">${testeAvg(b)}</span>
      </div>`;
    })
    .join("");
}

function renderTeste() {
  const b = testeCurrentBatter();

  const nameEl  = document.querySelector("#testeCurrentName");
  const countEl = document.querySelector("#testeCurrentCount");
  if (nameEl)  nameEl.textContent  = b ? b.name : "— selecione um rebatedor —";
  if (countEl) countEl.textContent = b ? `B: ${testeCurrentBalls()} · S: ${testeCurrentStrikes()}` : "B: 0 · S: 0";

  const pitcherDisplay = document.querySelector("#testePitcherInput");
  // no separate display needed; input is visible

  renderTesteBatterList();
  renderTesteStats();
  renderTestePitchDots();
  renderTesteLeaderboard();
}

function showTesteToast(message, type = "ok") {
  if (typeof mostrarToast === "function") {
    mostrarToast(message, type);
    return;
  }

  const toast = document.querySelector("#testeToast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `teste-toast is-visible${type === "erro" ? " is-erro" : ""}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("is-visible"), 3500);
}

function setTesteMode(mode) {
  const isSoftball = mode === "softball";
  document.querySelector("#testeTreinoTab")?.classList.toggle("is-active", !isSoftball);
  document.querySelector("#testeSoftballTab")?.classList.toggle("is-active", isSoftball);
  const treinoPanel = document.querySelector("#testeTreinoPanel");
  const softballPanel = document.querySelector("#testeSoftballPanel");
  const historicoView = document.querySelector("#testeHistoricoView");
  if (treinoPanel) treinoPanel.hidden = isSoftball;
  if (softballPanel) softballPanel.hidden = !isSoftball;
  if (historicoView) historicoView.hidden = isSoftball;
}

function loadSoftballAtBats() {
  try {
    const raw = localStorage.getItem(SOFTBALL_ATBATS_KEY);
    softballAtBats = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(softballAtBats)) softballAtBats = [];
  } catch (_) {
    softballAtBats = [];
  }
}

function saveSoftballAtBats() {
  try {
    localStorage.setItem(SOFTBALL_ATBATS_KEY, JSON.stringify(softballAtBats));
  } catch (_) {}
}

function getSoftballValue(id) {
  return document.querySelector(`#${id}`)?.value.trim() ?? "";
}

function resetSoftballForm(keepNames = true) {
  if (!keepNames) {
    const batter = document.querySelector("#softballBatter");
    const pitcher = document.querySelector("#softballPitcher");
    if (batter) batter.value = "";
    if (pitcher) pitcher.value = "";
  }

  const fields = {
    softballBalls: "0",
    softballStrikes: "0",
    softballResult: "1B",
    softballContact: "",
    softballDirection: "",
    softballRbi: "0",
    softballNotes: "",
  };

  Object.entries(fields).forEach(([id, value]) => {
    const field = document.querySelector(`#${id}`);
    if (field) field.value = value;
  });
}

function softballIsAtBat(result) {
  return ["1B", "2B", "3B", "HR", "K", "OUT", "FC", "ROE"].includes(result);
}

function softballIsHit(result) {
  return ["1B", "2B", "3B", "HR"].includes(result);
}

function formatSoftballAvg(decimal) {
  return "." + String(Math.round(decimal * 1000)).padStart(3, "0");
}

function saveSoftballAtBat() {
  const batter = getSoftballValue("softballBatter");
  if (!batter) {
    showTesteToast("Informe a rebatedora do at-bat.", "erro");
    return;
  }

  const result = getSoftballValue("softballResult") || "1B";
  const record = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    batter,
    pitcher: getSoftballValue("softballPitcher"),
    inning: Number(getSoftballValue("softballInning")) || 1,
    balls: Number(getSoftballValue("softballBalls")) || 0,
    strikes: Number(getSoftballValue("softballStrikes")) || 0,
    result,
    contact: getSoftballValue("softballContact"),
    direction: getSoftballValue("softballDirection"),
    rbi: Number(getSoftballValue("softballRbi")) || 0,
    notes: getSoftballValue("softballNotes"),
  };

  softballAtBats.unshift(record);
  saveSoftballAtBats();
  renderSoftballAtBats();
  resetSoftballForm(true);
  showTesteToast("At-bat de softball salvo.");
}

function removeSoftballAtBat(id) {
  softballAtBats = softballAtBats.filter((record) => record.id !== id);
  saveSoftballAtBats();
  renderSoftballAtBats();
}

function clearSoftballAtBats() {
  if (softballAtBats.length === 0) return;
  if (!confirm("Apagar todos os at-bats de softball salvos?")) return;
  softballAtBats = [];
  saveSoftballAtBats();
  renderSoftballAtBats();
  showTesteToast("Histórico de softball apagado.");
}

function renderSoftballSummary() {
  const container = document.querySelector("#softballSummary");
  if (!container) return;
  const ab = softballAtBats.filter((record) => softballIsAtBat(record.result)).length;
  const hits = softballAtBats.filter((record) => softballIsHit(record.result)).length;
  const walks = softballAtBats.filter((record) => record.result === "BB").length;
  const rbi = softballAtBats.reduce((total, record) => total + (Number(record.rbi) || 0), 0);
  const avg = ab > 0 ? hits / ab : 0;

  container.innerHTML = `
    <div class="softball-summary-item"><span>AB</span><strong>${ab}</strong></div>
    <div class="softball-summary-item"><span>Hits</span><strong>${hits}</strong></div>
    <div class="softball-summary-item"><span>BB</span><strong>${walks}</strong></div>
    <div class="softball-summary-item"><span>AVG</span><strong>${formatSoftballAvg(avg)}</strong></div>
    <div class="softball-summary-item"><span>RBI</span><strong>${rbi}</strong></div>
  `;
}

function renderSoftballAtBats() {
  renderSoftballSummary();
  const container = document.querySelector("#softballHistory");
  if (!container) return;

  if (softballAtBats.length === 0) {
    container.innerHTML = `<p class="softball-empty">Nenhum at-bat de softball salvo ainda.</p>`;
    return;
  }

  container.innerHTML = softballAtBats
    .map((record) => {
      const time = new Date(record.createdAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const details = [
        `Inning ${record.inning}`,
        `B${record.balls}-S${record.strikes}`,
        record.pitcher ? `Pitcher: ${record.pitcher}` : "",
        record.contact || "",
        record.direction || "",
        record.rbi ? `${record.rbi} RBI` : "",
      ].filter(Boolean).join(" · ");

      return `
        <article class="softball-atbat-card">
          <div class="softball-atbat-top">
            <span class="softball-result">${escapeHtml(record.result)}</span>
            <span class="softball-player">${escapeHtml(record.batter)}</span>
            <span class="softball-time">${escapeHtml(time)}</span>
            <button class="teste-batter-remove softball-remove" data-softball-remove="${escapeHtml(record.id)}" type="button" aria-label="Remover at-bat">x</button>
          </div>
          <div class="softball-atbat-meta">${escapeHtml(details || "Sem detalhes")}</div>
          ${record.notes ? `<div class="softball-atbat-note">${escapeHtml(record.notes)}</div>` : ""}
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-softball-remove]").forEach((button) => {
    button.addEventListener("click", () => removeSoftballAtBat(button.dataset.softballRemove));
  });
}

if (PAGE === "teste") {
  loadSoftballAtBats();
  renderSoftballAtBats();

  document.querySelector("#testeTreinoTab")?.addEventListener("click", () => setTesteMode("treino"));
  document.querySelector("#testeSoftballTab")?.addEventListener("click", () => setTesteMode("softball"));
  document.querySelector("#softballSave")?.addEventListener("click", saveSoftballAtBat);
  document.querySelector("#softballClear")?.addEventListener("click", () => resetSoftballForm(false));
  document.querySelector("#softballClearHistory")?.addEventListener("click", clearSoftballAtBats);
  /* ── Pitch zone (Teste) ── */
  const testePitchWrapper = document.querySelector("#testePitchWrapper");
  const testePitchBox     = document.querySelector("#testePitchBox");

  if (testePitchWrapper && testePitchBox) {
    bindPitchZone(testePitchWrapper, testePitchBox, ({ x, y, isStrike, zone }) => {
      if (!testeCurrentBatter()) return;
      testeAddPitch(x, y, isStrike, zone);
    });
  }

  /* ── Buttons ── */
  document.querySelector("#testeHit")?.addEventListener("click", () => {
    if (testeCurrentBatter()) testeCompleteAB("hit");
  });
  document.querySelector("#testeOut")?.addEventListener("click", () => {
    if (testeCurrentBatter()) testeCompleteAB("out");
  });
  document.querySelector("#testeBall")?.addEventListener("click", () => {
    const b = testeCurrentBatter();
    if (!b) return;
    b.currentPitches.push({ x: 10, y: 50, isStrike: false });
    if (testeCurrentBalls() >= 4) { testeCompleteAB("bb"); return; }
    renderTeste();
  });
  document.querySelector("#testeStrike")?.addEventListener("click", () => {
    const b = testeCurrentBatter();
    if (!b) return;
    b.currentPitches.push({ x: 50, y: 50, isStrike: true, zone: 5 });
    if (testeCurrentStrikes() >= 3) { testeCompleteAB("k"); return; }
    renderTeste();
  });
  document.querySelector("#testeUndo")?.addEventListener("click", () => {
    const b = testeCurrentBatter();
    if (!b) return;
    if (b.currentPitches.length > 0) {
      b.currentPitches.pop();
    } else if (b.completedABs.length > 0) {
      b.completedABs.pop();
    }
    renderTeste();
  });
  document.querySelector("#testeNextBatter")?.addEventListener("click", () => {
    if (testeState.batters.length === 0) return;
    testeState.currentIndex = (testeState.currentIndex + 1) % testeState.batters.length;
    renderTeste();
  });

  /* ── Add batter ── */
  function testeAddBatter() {
    const input = document.querySelector("#testeBatterInput");
    const name  = input?.value.trim();
    if (!name) return;
    testeState.batters.push({ id: testeState.nextId++, name, completedABs: [], currentPitches: [] });
    testeState.currentIndex = testeState.batters.length - 1;
    if (input) input.value = "";
    renderTeste();
  }

  document.querySelector("#testeAddBatter")?.addEventListener("click", testeAddBatter);
  document.querySelector("#testeBatterInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") testeAddBatter();
  });

  document.querySelector("#testeResetAll")?.addEventListener("click", () => {
    testeState.batters = [];
    testeState.currentIndex = 0;
    const pitcherInput = document.querySelector("#testePitcherInput");
    if (pitcherInput) pitcherInput.value = "";
    renderTeste();
  });

  renderTeste();
}
