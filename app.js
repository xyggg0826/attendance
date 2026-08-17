const STORAGE_KEY = "checkpoint-attendance-v1";
const API_URL =
  "https://script.google.com/macros/s/AKfycbyTmVR71fqQx3pH--TS3hymsPBBRJSa3bRs1VimZ4B5M2FXQDz6nfLjbB1oeAI060BwrA/exec";

const state = loadState();

const elements = {
  addPersonForm: document.querySelector("#addPersonForm"),
  attendanceHeader: document.querySelector("#attendanceHeader"),
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
  registrantSelect: document.querySelector("#registrantSelect"),
  resetSession: document.querySelector("#resetSession"),
  rosterImport: document.querySelector("#rosterImport"),
  selectedCheckIn: document.querySelector("#selectedCheckIn"),
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
  elements.addPersonForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.personName.value.trim();

    if (!name) return;

    await addPersonToSheet({ name });
    elements.personName.value = "";
  });

  elements.importRosterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const names = parseRosterImport(elements.rosterImport.value);

    if (!names.length) {
      elements.importFeedback.textContent = "Paste at least one name to import.";
      return;
    }

    elements.importFeedback.textContent = "Adding registrants to Google Sheets...";
    await addManyPeopleToSheet(names);
    elements.rosterImport.value = "";
  });

  elements.sessionDate.addEventListener("change", () => {
    state.sessionDate = elements.sessionDate.value || getToday();
    saveAndRender();
  });

  elements.registrantSelect.addEventListener("change", render);

  elements.selectedCheckIn.addEventListener("click", async () => {
    const person = getSelectedRegistrant();

    if (!person) {
      elements.importFeedback.textContent = "Choose your name before checking in.";
      return;
    }

    elements.selectedCheckIn.disabled = true;
    await checkInPerson(person, {
      status: "present",
      checkedInAt: new Date().toISOString(),
    });
    elements.selectedCheckIn.disabled = false;
  });

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
  renderRegistrantSelect();
  const selectedId = elements.registrantSelect.value;
  const visiblePeople = getSortedPeople().filter((person) => !selectedId || person.id === selectedId);

  elements.attendanceList.replaceChildren();

  visiblePeople.forEach((person) => {
    elements.attendanceList.append(createAttendeeRow(person));
  });

  elements.emptyState.classList.toggle("is-hidden", state.people.length > 0);
  elements.attendanceHeader.classList.toggle("is-hidden", state.people.length === 0);
  elements.attendanceList.classList.toggle("is-hidden", state.people.length === 0);
  elements.sessionLabel.textContent = formatDate(state.sessionDate);
  renderSummary();
}

function renderRegistrantSelect() {
  const selectedId = elements.registrantSelect.value;
  const options = [new Option("Choose your name", "")];
  const duplicateNames = getDuplicateNameSet();

  getSortedPeople().forEach((person) => {
    options.push(new Option(formatRegistrantOption(person, duplicateNames), person.id));
  });

  elements.registrantSelect.replaceChildren(...options);
  elements.registrantSelect.value = state.people.some((person) => person.id === selectedId)
    ? selectedId
    : "";
}

function createAttendeeRow(person) {
  const row = elements.template.content.firstElementChild.cloneNode(true);

  row.dataset.status = person.status;
  row.querySelector(".person-name").textContent = person.name;
  row.querySelector(".school-value").textContent = person.school || "-";
  row.querySelector(".status-value").textContent = getSheetStatusText(person);
  row.querySelector(".checked-in-value").textContent =
    person.status === "present" ? "Yes" : "No";
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

function getSelectedRegistrant() {
  return state.people.find((person) => person.id === elements.registrantSelect.value);
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
  if (!isValidSheetRowId(person.id)) {
    elements.importFeedback.textContent =
      "This registrant is not synced with Google Sheets yet. Refreshing the roster...";
    await loadRegistrantsFromSheet();
    return;
  }

  elements.importFeedback.textContent = "Saving check-in to Google Sheets...";

  try {
    const params = new URLSearchParams({
      action: "checkin",
      id: person.id,
      name: person.name,
      school: person.school || "",
      status: getSheetStatusText({ ...person, status: "present" }),
      checkedIn: "true",
    });
    const result = await fetchJson(`${API_URL}?${params.toString()}`);

    if (result?.success === false) {
      throw new Error(result.error || "Google Sheets did not check in this registrant.");
    }

    updatePerson(person.id, changes);
    elements.importFeedback.textContent = "Check-in saved to Google Sheets.";
    await loadRegistrantsFromSheet();
  } catch (error) {
    console.error(error);
    elements.importFeedback.textContent =
      `Google Sheets did not save this check-in: ${error.message}`;
  }
}

async function addPersonToSheet(person) {
  elements.importFeedback.textContent = "Adding registrant to Google Sheets...";

  try {
    const params = new URLSearchParams({
      action: "add",
      name: person.name,
      school: person.school || "",
      status: "",
      checkedIn: "false",
      note: "",
    });
    const result = await fetchJson(`${API_URL}?${params.toString()}`);

    if (result?.success === false) {
      throw new Error(result.error || "Google Sheets did not add this registrant.");
    }

    elements.importFeedback.textContent = "Registrant added to Google Sheets.";
    await loadRegistrantsFromSheet();
  } catch (error) {
    console.error(error);
    elements.importFeedback.textContent = `Google Sheets did not add this registrant: ${error.message}`;
  }
}

async function addManyPeopleToSheet(names) {
  let added = 0;

  for (const name of names) {
    try {
      const params = new URLSearchParams({
        action: "add",
        name,
        school: "",
        status: "",
        checkedIn: "false",
        note: "",
      });
      const result = await fetchJson(`${API_URL}?${params.toString()}`);

      if (result?.success !== false) {
        added += 1;
      }
    } catch (error) {
      console.error(error);
    }
  }

  elements.importFeedback.textContent = `Added ${added} of ${names.length} registrants to Google Sheets.`;
  await loadRegistrantsFromSheet({ silent: true });
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Google Apps Script returned a non-JSON error page.");
  }
}

function normalizeRegistrant(registrant) {
  const name = getField(registrant, "Name", "Your Full Name", "fullName", "name");
  const school = getField(registrant, "School", "school", "School Name or District Name", "DBN");
  const sheetStatus = getField(registrant, "Status", "status");
  const checkedInValue = getField(
    registrant,
    "Checked In",
    "checkedIn",
    "checkedInAt",
    "Checked In At",
    "Attended",
    "attended",
  );
  const status = isChecked(checkedInValue) ? "present" : "absent";
  const checkedInAt =
    registrant["Checked In"] ||
    registrant.checkedIn ||
    registrant.checkedInAt ||
    registrant.CheckedInAt ||
    registrant["Checked In At"] ||
    registrant["checked in at"] ||
    "";

  return {
    id: String(
      registrant.id || registrant.ID || [name, school, sheetStatus].filter(Boolean).join("|") || createId(),
    ),
    name: String(name || "Unnamed registrant"),
    school: String(school || ""),
    sheetStatus: String(sheetStatus || ""),
    status: status === "present" ? "present" : "absent",
    checkedInAt,
    note: String(getField(registrant, "Note", "note") || ""),
  };
}

function getField(source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return "";
}

function isChecked(value) {
  if (value === true) return true;

  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "yes", "y", "checked", "present", "1"].includes(normalized);
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

function getSheetStatusText(person) {
  if (person.sheetStatus) {
    return person.sheetStatus;
  }

  return person.status === "present" ? "Present" : "Not checked in";
}

function getSortedPeople() {
  return [...state.people].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

function getDuplicateNameSet() {
  const counts = state.people.reduce((summary, person) => {
    const name = normalizeName(person.name);
    summary.set(name, (summary.get(name) || 0) + 1);
    return summary;
  }, new Map());

  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function formatRegistrantOption(person, duplicateNames) {
  const isDuplicate = duplicateNames.has(normalizeName(person.name));
  const detail = isDuplicate ? person.school || person.sheetStatus : "";
  const status = person.status === "present" ? " - checked in" : "";
  const suffix = isDuplicate ? ` (${[detail, `ID ${person.id}`].filter(Boolean).join(", ")})` : "";

  return `${person.name}${suffix}${status}`;
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
    ["Date", "Name", "School", "Status", "Checked In", "Note"],
    ...state.people.map((person) => [
      state.sessionDate,
      person.name,
      person.school,
      getSheetStatusText(person),
      person.status === "present" ? "Yes" : "No",
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
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      sessionDate: state.sessionDate,
    }),
  );
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
      people: [],
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

function isValidSheetRowId(id) {
  const rowNumber = Number(id);
  return Number.isInteger(rowNumber) && rowNumber >= 2;
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
