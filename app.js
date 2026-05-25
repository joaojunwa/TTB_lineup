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

function saveLineupState() {
  try {
    if (document.body.classList.contains("is-viewing-other")) return;
    localStorage.setItem("ttb_lineup_" + getUser(), JSON.stringify({
      assignments,
      battingOrders,
      lineupPending: [...lineupPending],
      bancoPlayers:  [...bancoPlayers],
      dhEnabled,
      dhAssignment,
    }));
    if (typeof autosaveLineup === "function") autosaveLineup();
  } catch (_) {}
}

function loadLineupState() {
  try {
    const raw = localStorage.getItem("ttb_lineup_" + getUser());
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.assignments)   assignments   = s.assignments;
    if (s.battingOrders) battingOrders = s.battingOrders;
    if (s.lineupPending) lineupPending = new Set(s.lineupPending);
    if (s.bancoPlayers)  bancoPlayers  = new Set(s.bancoPlayers);
    dhEnabled    = s.dhEnabled    ?? false;
    dhAssignment = s.dhAssignment ?? "";
  } catch (_) {}
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

  if (!isLineupPlayer(playerId) && getActiveBatterIds().length >= 9) return;

  bancoPlayers.delete(playerId);
  selectedPlayerId = playerId;

  if (positionId === dhPosition.id) {
    Object.keys(assignments).forEach((key) => {
      if (key !== "P" && assignments[key] === playerId) {
        assignments[key] = "";
      }
    });
    if (!battingOrders[playerId]) {
      battingOrders[playerId] = getPitcherBattingOrder();
    }
    lineupPending.delete(playerId);
    dhAssignment = playerId;
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
  if (getActiveBatterIds().length >= 9) return;
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
  lineupPending.delete(playerId);
  delete battingOrders[playerId];
  compactBattingOrders();
  bancoPlayers.add(playerId);
  render();
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

    /* Oculta seções sem resultado durante busca (exceto Lineup sempre visível) */
    if (term && filtered.length === 0 && groupName !== "Lineup") return;

    const groupClass =
      groupName === "Lineup" ? "is-lineup" :
      groupName === "Banco"  ? "is-banco"  : "is-elenco";

    const group = document.createElement("section");
    group.className = `roster-group ${groupClass}`;
    group.innerHTML = `<h3>${escapeHtml(groupName)}</h3>`;

    if (groupName === "Lineup") {
      addLineupDropTarget(group);
    } else if (groupName === "Banco") {
      addBancoDropTarget(group);
    }

    const grid = document.createElement("div");
    grid.className = "roster-grid";

    filtered.forEach((player) => {
      const assignedPosition = getAssignedPosition(player.id);
      const card = document.createElement("article");
      card.className = `roster-player ${player.id === selectedPlayerId ? "is-selected" : ""}`;
      card.draggable = true;
      card.tabIndex = 0;
      const battingPrefix = getBattingPrefix(player);
      const isDh = dhEnabled && dhAssignment === player.id;
      const canEditOrder = getActiveBatterIds().includes(player.id);

      card.innerHTML = `
        <img class="roster-photo" alt="Foto de ${escapeHtml(player.name)}" src="${escapeHtml(player.photo)}" />
        <span class="roster-name">${battingPrefix}${escapeHtml(player.name)}${isDh ? " DH" : ""}</span>
        <span class="roster-number">${player.number ? `#${escapeHtml(player.number)}` : "sem numero"}</span>
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
      }

      grid.append(card);
    });

    group.append(grid);

    if (filtered.length === 0 && !term) {
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

  if (!dhEnabled || !dhAssignment) {
    return batterIds;
  }

  return [
    ...new Set(
      batterIds
        .filter((playerId) => playerId !== assignments.P)
        .concat(dhAssignment),
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
  if (!activeBatterIds.includes(playerId)) {
    return;
  }
  const previousOrder = battingOrders[playerId];
  const otherPlayerId = activeBatterIds.find((id) => id !== playerId && battingOrders[id] === nextOrder);

  if (otherPlayerId && previousOrder) {
    battingOrders[otherPlayerId] = previousOrder;
  }

  battingOrders[playerId] = nextOrder;
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
let activeStatusLineupTab = "home";
let opponentLineup = buildBlankOpponentLineup();

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
  if (team === "home") {
    gameState.currentBatterIndex = gameState.batterIndexes.home;
  }
}

function getCurrentBatterLabel() {
  const team = currentBattingTeam();

  if (team === "away") {
    const row = opponentLineup[getCurrentTeamBatterIndex("away") % opponentLineup.length];
    if (!row) return "";
    if (row.name && row.number) return `#${row.number} ${row.name}`;
    if (row.name) return row.name;
    if (row.number) return `#${row.number}`;
    return `Adversario ${row.order}`;
  }

  const batters = getStatusBatterList();
  const current = batters[getCurrentTeamBatterIndex("home") % Math.max(batters.length, 1)];
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

  const current = getCurrentTeamBatterIndex("home") % batters.length;
  const totals = { ab: 0, h: 0, bb: 0, k: 0 };

  const rows = batters.map((player, i) => {
    const isCurrent = i === current;
    const pos = getAssignedPosition(player.id) || "—";
    const s = gameState.playerStats[player.id] || { ab: 0, h: 0, bb: 0, k: 0 };
    totals.ab += s.ab; totals.h += s.h; totals.bb += s.bb; totals.k += s.k;
    const avg = s.ab > 0 ? "." + String(Math.round((s.h / s.ab) * 1000)).padStart(3, "0") : "—";
    return `<tr class="${isCurrent ? "gd-stat-current" : ""}">
      <td class="gd-stat-num">${i + 1}</td>
      <td class="gd-stat-name">${escapeHtml(player.name)}<span class="gd-stat-pos"> ${escapeHtml(pos)}</span></td>
      <td>${s.ab || 0}</td>
      <td>${s.h  || 0}</td>
      <td>${s.bb || 0}</td>
      <td>${s.k  || 0}</td>
      <td class="gd-stat-avg">${avg}</td>
    </tr>`;
  }).join("");

  const totalAvg = totals.ab > 0
    ? "." + String(Math.round((totals.h / totals.ab) * 1000)).padStart(3, "0")
    : "—";

  container.innerHTML = `
    <table class="gd-stats-table">
      <thead>
        <tr>
          <th colspan="2" class="gd-stats-head-team">Nosso Time</th>
          <th>AB</th><th>H</th><th>BB</th><th>K</th><th>AVG</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="gd-stat-totals">
          <td colspan="2">Totais</td>
          <td>${totals.ab}</td><td>${totals.h}</td>
          <td>${totals.bb}</td><td>${totals.k}</td>
          <td class="gd-stat-avg">${totalAvg}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderOpponentLineup() {
  const container = document.querySelector("#opponentLineup");
  if (!container) return;
  const current = getCurrentTeamBatterIndex("away") % opponentLineup.length;
  const totals = { ab: 0, h: 0, bb: 0, k: 0 };

  const rows = opponentLineup.map((row, index) => {
    const isCurrent = index === current;
    const key = `away_${index}`;
    const s = gameState.playerStats[key] || { ab: 0, h: 0, bb: 0, k: 0 };
    totals.ab += s.ab; totals.h += s.h; totals.bb += s.bb; totals.k += s.k;
    const avg = s.ab > 0 ? "." + String(Math.round((s.h / s.ab) * 1000)).padStart(3, "0") : "—";
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
      <td>${s.bb || 0}</td>
      <td>${s.k  || 0}</td>
      <td class="gd-stat-avg">${avg}</td>
    </tr>`;
  }).join("");

  const totalAvg = totals.ab > 0
    ? "." + String(Math.round((totals.h / totals.ab) * 1000)).padStart(3, "0")
    : "—";

  container.innerHTML = `
    <table class="gd-stats-table">
      <thead>
        <tr>
          <th colspan="2" class="gd-stats-head-team">Adversário</th>
          <th>AB</th><th>H</th><th>BB</th><th>K</th><th>AVG</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="gd-stat-totals">
          <td colspan="2">Totais</td>
          <td>${totals.ab}</td><td>${totals.h}</td>
          <td>${totals.bb}</td><td>${totals.k}</td>
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
  const homePanel = document.querySelector("#homeLineupPanel");
  const awayPanel = document.querySelector("#awayLineupPanel");

  homeButton?.classList.toggle("is-active", activeStatusLineupTab === "home");
  awayButton?.classList.toggle("is-active", activeStatusLineupTab === "away");
  if (homePanel) homePanel.hidden = activeStatusLineupTab !== "home";
  if (awayPanel) awayPanel.hidden = activeStatusLineupTab !== "away";
}

function renderScoreboardLabels() {
  const awayName = document.querySelector("#awayName")?.value || "Visitante";
  const homeName = document.querySelector("#homeName")?.value || "TTB";
  const awayLabel = document.querySelector("#awayLabel");
  const homeLabel = document.querySelector("#homeLabel");
  if (awayLabel) awayLabel.textContent = awayName;
  if (homeLabel) homeLabel.textContent = homeName;
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

  if (team === "home") {
    const batters = getStatusBatterList();
    if (!batters.length) return;
    const batter = batters[getCurrentTeamBatterIndex("home") % batters.length];
    if (!batter) return;
    key = batter.id;
  } else {
    const idx = getCurrentTeamBatterIndex("away") % Math.max(opponentLineup.length, 1);
    key = `away_${idx}`;
  }

  if (!gameState.playerStats[key]) {
    gameState.playerStats[key] = { ab: 0, h: 0, bb: 0, k: 0 };
  }
  gameState.playerStats[key][field] = (gameState.playerStats[key][field] || 0) + amount;
}

function completeWalk() {
  const runs = advanceBatterByWalk();
  recordBatterStat("bb");
  logPlay(runs ? "Walk (BB) - entrou 1 corrida" : "Walk (BB)");
  nextBatter();
}

function completeHit() {
  addCurrentTeamHit();
  recordBatterStat("ab");
  recordBatterStat("h");
  logPlay("Hit");
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
  gameState.outs += 1;
  logPlay(`Out #${gameState.outs}`);
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
  loadLineupState();
  loadOpponentLineup();

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
  document.querySelector("#btnNextBatter")?.addEventListener("click", () => { nextBatter(); renderStatus(); });
  document.querySelector("#btnResetCount")?.addEventListener("click", resetCount);

  document.querySelector("#homeLineupTab")?.addEventListener("click", () => {
    activeStatusLineupTab = "home";
    renderStatusLineupTabs();
  });

  document.querySelector("#awayLineupTab")?.addEventListener("click", () => {
    activeStatusLineupTab = "away";
    renderStatusLineupTabs();
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
