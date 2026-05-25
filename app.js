const STORAGE_KEY = "checkpoint-attendance-v1";
const API_URL =
  "https://script.google.com/macros/s/AKfycbyTmVR71fqQx3pH--TS3hymsPBBRJSa3bRs1VimZ4B5M2FXQDz6nfLjbB1oeAI060BwrA/exec";

const state = loadState();

const elements = {
  addPersonForm: document.querySelector("#addPersonForm"),
  attendanceList: document.querySelector("#attendanceList"),
  clearAllButton: document.querySelector("#clearAllButton"),
  emptyState: document.querySelector("#emptyState"),
  exportButton: document.querySelector("#exportButton"),
  importFeedback: document.querySelector("#importFeedback"),
  importRosterForm: document.querySelector("#importRosterForm"),
  markAllPresent: document.querySelector("#markAllPresent"),
  personName: document.querySelector("#personName"),
  presentCount: document.querySelector("#presentCount"),
  absentCount: document.querySelector("#absentCount"),
  resetSession: document.querySelector("#resetSession"),
  rosterImport: document.querySelector("#rosterImport"),
  searchInput: document.querySelector("#searchInput"),
  sessionDate: document.querySelector("#sessionDate"),
  sessionLabel: document.querySelector("#sessionLabel"),
  template: document.querySelector("#attendeeTemplate"),
  totalCount: document.querySelector("#totalCount"),
};

init();

async function init() {
  elements.sessionDate.value = state.sessionDate;
  bindEvents();
  render();
  await loadRegistrantsFromSheet();
  window.setInterval(() => {
    if (!document.hidden) {
      loadRegistrantsFromSheet({ silent: true });
    }
  }, 15000);
  window.addEventListener("focus", () => loadRegistrantsFromSheet({ silent: true }));
}

function bindEvents() {
  elements.addPersonForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.personName.value.trim();

    if (!name) return;

    state.people.push({
      id: createId(),
      name,
      status: "absent",
      note: "",
      checkedInAt: "",
    });

    elements.personName.value = "";
    elements.importFeedback.textContent =
      "Added locally. Add this person to Google Sheets to share them across devices.";
    saveAndRender();
  });

  elements.importRosterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const names = parseRosterImport(elements.rosterImport.value);
    const knownNames = new Set(state.people.map((person) => normalizeName(person.name)));
    const newPeople = [];

    names.forEach((name) => {
      const normalizedName = normalizeName(name);

      if (knownNames.has(normalizedName)) return;

      knownNames.add(normalizedName);
      newPeople.push({
        id: createId(),
        name,
        status: "absent",
        note: "",
        checkedInAt: "",
      });
    });

    state.people.push(...newPeople);
    elements.rosterImport.value = "";
    elements.importFeedback.textContent = `${getImportMessage(
      names.length,
      newPeople.length,
    )} Add imported names to Google Sheets to share them across devices.`;
    saveAndRender();
  });

  elements.sessionDate.addEventListener("change", () => {
    state.sessionDate = elements.sessionDate.value || getToday();
    saveAndRender();
  });

  elements.searchInput.addEventListener("input", render);

  elements.markAllPresent.addEventListener("click", () => {
    state.people = state.people.map((person) => ({ ...person, status: "present" }));
    saveAndRender();
  });

  elements.resetSession.addEventListener("click", () => {
    state.people = state.people.map((person) => ({
      ...person,
      status: "absent",
      note: "",
      checkedInAt: "",
    }));
    saveAndRender();
  });

  elements.clearAllButton.addEventListener("click", () => {
    if (!state.people.length) return;
    const confirmed = window.confirm("Clear the entire roster?");
    if (!confirmed) return;

    state.people = [];
    saveAndRender();
  });

  elements.exportButton.addEventListener("click", exportCsv);
}

function render() {
  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  const visiblePeople = state.people.filter((person) =>
    person.name.toLowerCase().includes(searchTerm),
  );

  elements.attendanceList.replaceChildren();

  visiblePeople.forEach((person) => {
    elements.attendanceList.append(createAttendeeRow(person));
  });

  elements.emptyState.classList.toggle("is-hidden", state.people.length > 0);
  elements.attendanceList.classList.toggle("is-hidden", state.people.length === 0);
  elements.sessionLabel.textContent = formatDate(state.sessionDate);
  renderSummary();
}

function createAttendeeRow(person) {
  const row = elements.template.content.firstElementChild.cloneNode(true);
  const statusText = getStatusText(person);

  row.dataset.status = person.status;
  row.querySelector(".person-name").textContent = person.name;
  row.querySelector(".status-label").textContent = statusText;
  row.querySelector(".note-input").value = person.note;

  row.querySelector(".check-in-button").addEventListener("click", async () => {
    row.querySelector(".check-in-button").disabled = true;
    await checkInPerson(person, {
      status: "present",
      checkedInAt: new Date().toISOString(),
    });
  });

  row.querySelectorAll("[data-status]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.status === person.status));
    button.addEventListener("click", () => {
      const checkedInAt =
        button.dataset.status === "present" ? person.checkedInAt || new Date().toISOString() : "";

      updatePerson(person.id, {
        status: button.dataset.status,
        checkedInAt,
      });
    });
  });

  row.querySelector(".note-input").addEventListener("input", (event) => {
    updatePerson(person.id, { note: event.target.value }, false);
  });

  row.querySelector(".remove-button").addEventListener("click", () => {
    state.people = state.people.filter((candidate) => candidate.id !== person.id);
    saveAndRender();
  });

  return row;
}

async function loadRegistrantsFromSheet(options = {}) {
  if (!options.silent) {
    elements.importFeedback.textContent = "Loading registrants from Google Sheets...";
  }

  try {
    const registrants = await fetchJson(`${API_URL}?action=list`);

    if (!Array.isArray(registrants)) {
      throw new Error("Google Sheets response was not a registrant list.");
    }

    state.people = registrants.map(normalizeRegistrant);
    saveAndRender();
    if (!options.silent) {
      elements.importFeedback.textContent = `Loaded ${state.people.length} registrants from Google Sheets.`;
    }
  } catch (error) {
    console.error(error);
    if (!options.silent) {
      elements.importFeedback.textContent =
        "Could not load Google Sheets. In Apps Script, deploy the web app with access set to Anyone.";
    }
  }
}

async function checkInPerson(person, changes) {
  updatePerson(person.id, changes);

  try {
    const params = new URLSearchParams({
      action: "checkin",
      id: person.id,
      name: person.name,
      email: person.email || "",
    });
    const result = await fetchJson(`${API_URL}?${params.toString()}`);

    if (result?.success === false) {
      throw new Error(result.error || "Google Sheets did not check in this registrant.");
    }

    elements.importFeedback.textContent = "Check-in saved to Google Sheets.";
    await loadRegistrantsFromSheet();
  } catch (error) {
    console.error(error);
    elements.importFeedback.textContent =
      "Check-in saved locally, but Google Sheets could not be updated. Check the Apps Script deployment access.";
  }
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

function normalizeRegistrant(registrant) {
  const email = String(registrant.email || (String(registrant.role || "").includes("@") ? registrant.role : ""));
  const role = String(email ? registrant.school || "" : registrant.role || "");
  const status = String(registrant.status || "absent").toLowerCase();

  return {
    id: String(registrant.id || email || registrant.name || createId()),
    name: String(registrant.name || "Unnamed registrant"),
    email,
    role,
    school: String(registrant.school || ""),
    status: status === "present" ? "present" : "absent",
    checkedInAt: registrant.checkedInAt || "",
    note: String(registrant.note || ""),
  };
}

function renderSummary() {
  const counts = state.people.reduce(
    (summary, person) => {
      if (person.status === "present") {
        summary.present += 1;
      } else {
        summary.absent += 1;
      }

      return summary;
    },
    { present: 0, absent: 0 },
  );

  elements.presentCount.textContent = counts.present;
  elements.absentCount.textContent = counts.absent;
  elements.totalCount.textContent = state.people.length;
}

function updatePerson(id, changes, shouldRender = true) {
  state.people = state.people.map((person) =>
    person.id === id ? { ...person, ...changes } : person,
  );

  saveState();

  if (shouldRender) {
    render();
  }
}

function exportCsv() {
  const rows = [
    ["Date", "Name", "Status", "Checked In At", "Note"],
    ...state.people.map((person) => [
      state.sessionDate,
      person.name,
      person.status,
      person.checkedInAt ? formatTime(person.checkedInAt) : "",
      person.note,
    ]),
  ];

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = `attendance-${state.sessionDate}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function saveAndRender() {
  saveState();
  render();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const fallback = {
    sessionDate: getToday(),
    people: [],
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      ...fallback,
      ...saved,
      people: Array.isArray(saved?.people) ? saved.people : [],
    };
  } catch {
    return fallback;
  }
}

function parseRosterImport(text) {
  return text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function getImportMessage(totalNames, importedNames) {
  if (!totalNames) {
    return "Paste at least one name to import.";
  }

  if (!importedNames) {
    return "No new names imported. They were already on the roster.";
  }

  return `Imported ${importedNames} of ${totalNames} registrants.`;
}

function getStatusText(person) {
  const statusText = person.status[0].toUpperCase() + person.status.slice(1);

  if (person.status !== "present" || !person.checkedInAt) {
    return statusText;
  }

  return `${statusText} at ${formatTime(person.checkedInAt)}`;
}

function formatTime(dateText) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateText));
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
