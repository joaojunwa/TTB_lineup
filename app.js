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

const fieldSlots = document.querySelector("#fieldSlots");
const rosterCount = document.querySelector("#rosterCount");
const selectedPlayer = document.querySelector("#selectedPlayer");
const positionButtons = document.querySelector("#positionButtons");
const playerRoster = document.querySelector("#playerRoster");
const drawerToggle = document.querySelector("#drawerToggle");
const lineupPanel = document.querySelector("#lineupPanel");
const noDhMode = document.querySelector("#noDhMode");
const dhMode = document.querySelector("#dhMode");
const clearButton = document.querySelector("#clearField");
const resetButton = document.querySelector("#resetLineup");
const exportButton = document.querySelector("#exportLineup");
const exportDialog = document.querySelector("#exportDialog");
const exportOutput = document.querySelector("#exportOutput");

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
  lineupPending.add(playerId);
  if (!battingOrders[playerId]) {
    battingOrders[playerId] = getNextOpenBattingOrder();
  }
  selectedPlayerId = playerId;
  render();
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

  getRosterSections().forEach(({ groupName, players }) => {
    const group = document.createElement("section");
    group.className = `roster-group ${groupName === "Lineup" ? "is-lineup" : "is-elenco"}`;
    group.innerHTML = `<h3>${escapeHtml(groupName)}</h3>`;

    if (groupName === "Lineup") {
      addLineupDropTarget(group);
    }

    const grid = document.createElement("div");
    grid.className = "roster-grid";

    players.forEach((player) => {
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
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

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

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "lineup-remove-btn";
        removeBtn.setAttribute("aria-label", `Remover ${escapeHtml(player.name)} do lineup`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          removeFromLineup(player.id);
        });
        card.append(removeBtn);
      }

      grid.append(card);
    });

    group.append(grid);

    if (groupName === "Lineup" && players.length === 0) {
      const hint = document.createElement("p");
      hint.className = "lineup-empty-hint";
      hint.textContent = "Arraste jogadores do elenco para o lineup";
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
    .concat(dhPlayer && dhPlayer.group !== "Lineup" ? [dhPlayer] : [])
    .filter((player, index, list) => list.findIndex((item) => item.id === player.id) === index)
    .sort((first, second) => getLineupSortOrder(first) - getLineupSortOrder(second));

  const lineupIds = new Set(lineupCards.map((player) => player.id));
  const benchCards = roster
    .filter((player) => !lineupIds.has(player.id))
    .sort((first, second) => first.name.localeCompare(second.name));

  return [
    { groupName: "Lineup", players: lineupCards },
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

  return batterIds
    .filter((playerId) => playerId !== assignments.P)
    .concat(dhAssignment);
}

function renderOrderSelect(player) {
  const activeBatterIds = getActiveBatterIds();
  const maxOrder = activeBatterIds.length || 0;
  const currentOrder = battingOrders[player.id] || getPitcherBattingOrder();
  if (!maxOrder) {
    return "";
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

function render() {
  renderField();
  renderSelectedPlayer();
  renderPositionButtons();
  renderRoster();
  noDhMode.classList.toggle("is-active", !dhEnabled);
  dhMode.classList.toggle("is-active", dhEnabled);
}

clearButton.addEventListener("click", () => {
  assignments = buildEmptyAssignments();
  dhAssignment = "";
  battingOrders = {};
  lineupPending.clear();
  render();
});

resetButton.addEventListener("click", () => {
  assignments = buildInitialAssignments();
  battingOrders = buildInitialBattingOrders();
  dhAssignment = "";
  lineupPending.clear();
  selectedPlayerId = roster[0]?.id ?? "";
  render();
});

drawerToggle.addEventListener("click", () => {
  const collapsed = lineupPanel.classList.toggle("is-collapsed");
  drawerToggle.setAttribute("aria-expanded", String(!collapsed));
});

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
  exportOutput.value = JSON.stringify(exportAssignments(), null, 2);
  exportDialog.showModal();
  exportOutput.select();
});

selectedPlayer.addEventListener("dragstart", (event) => {
  if (!selectedPlayerId) {
    event.preventDefault();
    return;
  }

  beginDrag(event, selectedPlayerId);
});

selectedPlayer.addEventListener("dragend", endDrag);

render();

/* ═══════════════════════════════
   TAB NAVIGATION
═══════════════════════════════ */

const lineupTab = document.querySelector("#lineupTab");
const statusTab = document.querySelector("#statusTab");
const testeTab  = document.querySelector("#testeTab");
const tabBtns   = document.querySelectorAll(".tab-btn");

// Hide drawer toggle when not on lineup tab
function updateToolbarForTab(tab) {
  const drawerBtn = document.querySelector("#drawerToggle");
  if (drawerBtn) drawerBtn.style.display = tab === "lineup" ? "" : "none";
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    tabBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    lineupTab.hidden = tab !== "lineup";
    statusTab.hidden = tab !== "status";
    testeTab.hidden  = tab !== "teste";
    updateToolbarForTab(tab);
    if (tab === "status") renderStatus();
    if (tab === "teste")  renderTeste();
  });
});

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
  plays: [],
  currentPitches: [],
};

function getStatusBatterList() {
  return getActiveBatterIds()
    .map((id) => getPlayer(id))
    .filter(Boolean)
    .sort((a, b) => (battingOrders[a.id] || 99) - (battingOrders[b.id] || 99));
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
      ({ x, y, isStrike }) =>
        `<span class="pitch-dot ${isStrike ? "is-strike" : "is-ball"}" style="left:${x}%;top:${y}%"></span>`,
    )
    .join("");
}

function renderStatusBattingOrder() {
  const list = document.querySelector("#statusBattingOrder");
  if (!list) return;
  const batters = getStatusBatterList();
  if (batters.length === 0) {
    list.innerHTML = `<li style="color:var(--text-muted);font-size:0.82rem;padding:8px">Monte o lineup na aba Lineup primeiro.</li>`;
    return;
  }
  const current = gameState.currentBatterIndex % batters.length;
  list.innerHTML = batters
    .map((player, i) => {
      const pos = getAssignedPosition(player.id) || "—";
      const isCurrent = i === current;
      return `<li class="status-batter-item${isCurrent ? " is-current" : ""}">
        <span class="status-batter-num">${i + 1}</span>
        <span>${escapeHtml(player.name)}</span>
        <span class="status-batter-pos">${escapeHtml(pos)}</span>
      </li>`;
    })
    .join("");
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
  });
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
  renderStatusBattingOrder();
  renderScoreboardLabels();
  highlightCurrentInning();
}

function resetCount() {
  gameState.balls   = 0;
  gameState.strikes = 0;
  gameState.currentPitches = [];
  renderStatus();
}

function nextBatter() {
  gameState.currentBatterIndex += 1;
  resetCount();
}

function addOut() {
  gameState.outs += 1;
  logPlay(`Out #${gameState.outs}`);
  if (gameState.outs >= 3) {
    gameState.outs = 0;
    gameState.isTop = !gameState.isTop;
    if (!gameState.isTop) gameState.inning += 1;
    gameState.bases = [false, false, false];
    logPlay(`— Fim do ${gameState.isTop ? "▲" : "▼"} ${gameState.inning}º inning —`);
  }
  resetCount();
}

function logPlay(text) {
  const batters   = getStatusBatterList();
  const current   = batters[gameState.currentBatterIndex % Math.max(batters.length, 1)];
  const meta      = `${gameState.isTop ? "▲" : "▼"}${gameState.inning}`;
  gameState.plays.unshift({ meta, text: current ? `${current.name} — ${text}` : text });
  renderPlayLog();
}

function renderPlayLog() {
  const list = document.querySelector("#playLog");
  if (!list) return;
  list.innerHTML = gameState.plays
    .map(
      ({ meta, text }) =>
        `<li class="play-log-item">
          <span class="play-log-meta">${escapeHtml(meta)}</span>
          <span class="play-log-text">${escapeHtml(text)}</span>
        </li>`,
    )
    .join("");
}

/* ── Pitch zone click ── */
const pitchWrapper = document.querySelector("#pitchZoneWrapper");
const pitchZoneBox = document.querySelector("#pitchZoneBox");

if (pitchWrapper && pitchZoneBox) {
  pitchWrapper.addEventListener("click", (event) => {
    const wRect = pitchWrapper.getBoundingClientRect();
    const zRect = pitchZoneBox.getBoundingClientRect();
    const x = ((event.clientX - wRect.left) / wRect.width)  * 100;
    const y = ((event.clientY - wRect.top)  / wRect.height) * 100;

    const insideX = event.clientX >= zRect.left && event.clientX <= zRect.right;
    const insideY = event.clientY >= zRect.top  && event.clientY <= zRect.bottom;
    const isStrike = insideX && insideY;

    gameState.currentPitches.push({ x, y, isStrike });

    if (isStrike) {
      gameState.strikes += 1;
      if (gameState.strikes >= 3) {
        logPlay("Strikeout");
        nextBatter();
        return;
      }
    } else {
      gameState.balls += 1;
      if (gameState.balls >= 4) {
        logPlay("Walk (BB)");
        nextBatter();
        return;
      }
    }
    renderStatus();
  });
}

/* ── Status button handlers ── */
document.querySelector("#btnBall")?.addEventListener("click", () => {
  gameState.balls += 1;
  if (gameState.balls >= 4) { logPlay("Walk (BB)"); nextBatter(); }
  else renderStatus();
});

document.querySelector("#btnStrike")?.addEventListener("click", () => {
  gameState.strikes += 1;
  if (gameState.strikes >= 3) { logPlay("Strikeout"); nextBatter(); }
  else renderStatus();
});

document.querySelector("#btnOut")?.addEventListener("click", addOut);
document.querySelector("#btnNextBatter")?.addEventListener("click", () => { nextBatter(); renderStatus(); });
document.querySelector("#btnResetCount")?.addEventListener("click", resetCount);

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

/* ═══════════════════════════════
   TESTE TAB
═══════════════════════════════ */

const testeState = {
  batters: [],        // { id, name, completedABs: ['hit'|'out'|'k'|'bb'], currentPitches: [{x,y,isStrike}] }
  currentIndex: 0,
  nextId: 1,
};

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

function testeAddPitch(x, y, isStrike) {
  const b = testeCurrentBatter();
  if (!b) return;
  b.currentPitches.push({ x, y, isStrike });
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
    .map(({ x, y, isStrike }) =>
      `<span class="pitch-dot ${isStrike ? "is-strike" : "is-ball"}" style="left:${x}%;top:${y}%"></span>`)
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

/* ── Pitch zone (Teste) ── */
const testePitchWrapper = document.querySelector("#testePitchWrapper");
const testePitchBox     = document.querySelector("#testePitchBox");

if (testePitchWrapper && testePitchBox) {
  testePitchWrapper.addEventListener("click", (event) => {
    if (!testeCurrentBatter()) return;
    const wRect = testePitchWrapper.getBoundingClientRect();
    const zRect = testePitchBox.getBoundingClientRect();
    const x = ((event.clientX - wRect.left) / wRect.width)  * 100;
    const y = ((event.clientY - wRect.top)  / wRect.height) * 100;
    const isStrike = event.clientX >= zRect.left && event.clientX <= zRect.right
                  && event.clientY >= zRect.top  && event.clientY <= zRect.bottom;
    testeAddPitch(x, y, isStrike);
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
  b.currentPitches.push({ x: 50, y: 50, isStrike: true });
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
