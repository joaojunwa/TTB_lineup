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
let assignments = buildInitialAssignments();
let battingOrders = buildInitialBattingOrders();
let dhEnabled = false;
let dhAssignment = "";
let draggedPlayerId = "";

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
  if (!playerId) {
    return;
  }

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

    dhAssignment = playerId;
    render();
    return;
  }

  Object.keys(assignments).forEach((key) => {
    if (assignments[key] === playerId) {
      assignments[key] = "";
    }
  });

  if (dhAssignment === playerId) {
    dhAssignment = "";
  }

  if (!battingOrders[playerId]) {
    const replacedPlayerId = assignments[positionId];
    battingOrders[playerId] = battingOrders[replacedPlayerId] || getNextOpenBattingOrder();
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
      grid.append(card);
    });

    group.append(grid);
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

  if (player.group === "Lineup") {
    return `${escapeHtml(battingOrders[player.id] || player.battingOrder)}- `;
  }

  return "";
}

function getRosterSections() {
  const dhPlayer = dhEnabled ? getPlayer(dhAssignment) : null;
  const assignedIds = new Set(Object.values(assignments).filter(Boolean));
  const lineupCards = roster
    .filter((player) => player.group === "Lineup" || assignedIds.has(player.id))
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

function getPlayerStatus(player, assignedPosition) {
  if (dhEnabled && dhAssignment === player.id) {
    const pitcher = getPlayer(assignments.P);
    return `DH do ${pitcher?.name || "pitcher"} (pitcher)`;
  }

  if (assignments.P === player.id) {
    return "pitcher";
  }

  return assignedPosition || "banco";
}

function getActiveBatterIds() {
  const starterIds = starters
    .map((starter) => getPlayer(assignments[starter.position])?.id)
    .filter(Boolean);

  if (!dhEnabled || !dhAssignment) {
    return starterIds;
  }

  return starterIds
    .filter((playerId) => playerId !== assignments.P)
    .concat(dhAssignment);
}

function renderOrderSelect(player) {
  const activeBatterIds = getActiveBatterIds();
  const maxOrder = activeBatterIds.length || 9;
  const currentOrder = battingOrders[player.id] || getPitcherBattingOrder();
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
  const previousOrder = battingOrders[playerId];
  const otherPlayerId = activeBatterIds.find((id) => id !== playerId && battingOrders[id] === nextOrder);

  if (otherPlayerId && previousOrder) {
    battingOrders[otherPlayerId] = previousOrder;
  }

  battingOrders[playerId] = nextOrder;
}

function getNextOpenBattingOrder() {
  const usedOrders = new Set(Object.values(battingOrders));

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
  assignments = positions.reduce((list, position) => {
    list[position.id] = "";
    return list;
  }, {});
  dhAssignment = "";
  render();
});

resetButton.addEventListener("click", () => {
  assignments = buildInitialAssignments();
  battingOrders = buildInitialBattingOrders();
  dhAssignment = "";
  selectedPlayerId = roster[0]?.id ?? "";
  render();
});

drawerToggle.addEventListener("click", () => {
  const collapsed = lineupPanel.classList.toggle("is-collapsed");
  drawerToggle.setAttribute("aria-expanded", String(!collapsed));
  drawerToggle.textContent = collapsed ? "Abrir jogadores" : "Jogadores";
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
