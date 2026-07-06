"use strict";

/* ════════════════════════════════════════════════════════════════════
   CONFIG — everything environment-specific lives here.
   ════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  // CAP OData V4 entity set URL, e.g.
  // https://<app>.cfapps.us10.hana.ondemand.com/odata/v4/todo/ToDo
  odataUrl:
    "https://b1d9f557trial-dev-todo-srv.cfapps.us10-001.hana.ondemand.com/odata/v4/to-do-/ToDo",

  // Server-side proxy that sends the push via OneSignal's REST API —
  // see todo/srv/server.js. The browser can't call OneSignal directly
  // (no CORS, and it'd expose the REST API key).
  notifyUrl:
    "https://b1d9f557trial-dev-todo-srv.cfapps.us10-001.hana.ondemand.com/notify",

  // Field names in your CDS entity — adjust if yours differ.
  fields: {
    id: "ID",          // key, Edm.Guid (cuid aspect)
    task: "task",    // String
    complete: "complete", // Boolean
    priority: "priority", // String enum: high | medium | low
  },
};

/* ── 1. Generic OData request helper ────────────────────────────── */
async function odata(method, path = "", body = null) {
  const headers = { Accept: "application/json" };
  if (body !== null) headers["Content-Type"] = "application/json";

  const res = await fetch(CONFIG.odataUrl + path, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail)?.error?.message || detail;
    } catch (_) { /* keep raw text */ }
    throw new Error(`${method} ${res.status}: ${detail}`);
  }
  // DELETE and some PATCH responses are 204 No Content
  return res.status === 204 ? null : res.json();
}

/* OData V4: Edm.Guid keys go in parentheses WITHOUT quotes */
const keyPath = (id) => `(${id})`;

/* ── 2. CRUD operations ─────────────────────────────────────────── */
const api = {
  list: () =>
    odata("GET", `?$orderby=${CONFIG.fields.complete} asc`).then(
      (d) => d.value
    ),
  create: (task, priority) =>
    odata("POST", "", {
      [CONFIG.fields.task]: task,
      [CONFIG.fields.complete]: false,
      [CONFIG.fields.priority]: priority,
    }),
  setCompleted: (id, complete) =>
    odata("PATCH", keyPath(id), { [CONFIG.fields.complete]: complete }),
  rename: (id, task) =>
    odata("PATCH", keyPath(id), { [CONFIG.fields.task]: task }),
  setPriority: (id, priority) =>
    odata("PATCH", keyPath(id), { [CONFIG.fields.priority]: priority }),
  remove: (id) => odata("DELETE", keyPath(id)),
};

/* high always sorts before low */
const PRIORITY_RANK = { high: 0, low: 1 };

/* ── 3. DOM references & state ──────────────────────────────────── */
const els = {
  input: document.getElementById("taskInput"),
  priorityInput: document.getElementById("priorityInput"),
  addBtn: document.getElementById("addBtn"),
  list: document.getElementById("taskList"),
  empty: document.getElementById("emptyState"),
  loading: document.getElementById("loadingState"),
  banner: document.getElementById("banner"),
  counterOpen: document.getElementById("counterOpen"),
};

let tasks = [];

/* incomplete first, then high priority before low, stable otherwise */
function sortedTasks() {
  const f = CONFIG.fields;
  return [...tasks].sort((a, b) => {
    if (!!a[f.complete] !== !!b[f.complete]) return a[f.complete] ? 1 : -1;
    const pa = PRIORITY_RANK[a[f.priority]] ?? 1;
    const pb = PRIORITY_RANK[b[f.priority]] ?? 1;
    return pa - pb;
  });
}

/* ── 4. Rendering ───────────────────────────────────────────────── */
function render() {
  const f = CONFIG.fields;
  els.list.innerHTML = "";
  els.empty.hidden = tasks.length !== 0;
  els.counterOpen.textContent = tasks.filter((t) => !t[f.complete]).length;

  for (const task of sortedTasks()) {
    const priority = task[f.priority] || "low";
    const li = document.createElement("li");
    li.className = "task" + (task[f.complete] ? " done" : "") + ` priority-${priority}`;
    li.dataset.id = task[f.id];

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = !!task[f.complete];
    check.setAttribute("aria-label", "Mark task complete");
    check.addEventListener("change", () =>
      handleToggle(task[f.id], check.checked)
    );

    const taskEl = document.createElement("span");
    taskEl.className = "task-task";
    taskEl.textContent = task[f.task];
    taskEl.addEventListener("dblclick", () => startEdit(li, task));

    const priorityBadge = document.createElement("button");
    priorityBadge.type = "button";
    priorityBadge.className = "priority-badge";
    priorityBadge.textContent = priority;
    priorityBadge.title = "Click to toggle priority";
    priorityBadge.addEventListener("click", () => handlePriorityToggle(task[f.id]));

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEdit(li, task));

    const delBtn = document.createElement("button");
    delBtn.className = "del-btn";
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => handleDelete(task[f.id]));

    actions.append(editBtn, delBtn);
    li.append(check, taskEl, priorityBadge, actions);
    els.list.appendChild(li);
  }
}

function showError(msg) {
  els.banner.textContent = msg;
  els.banner.hidden = false;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => (els.banner.hidden = true), 6000);
}

/* ── 5. Handlers ────────────────────────────────────────────────── */
async function loadTasks() {
  els.loading.hidden = false;
  try {
    tasks = await api.list();
    render();
  } catch (err) {
    showError(`Couldn't load tasks. ${err.message}`);
  } finally {
    els.loading.hidden = true;
  }
}

async function handleAdd() {
  const task = els.input.value.trim();
  if (!task) return;
  const priority = els.priorityInput.value || "low";
  els.addBtn.disabled = true;
  try {
    const created = await api.create(task, priority);
    tasks.push(created);
    els.input.value = "";
    els.priorityInput.value = "low";
    updatePriorityFieldStyle();
    render();
    els.input.focus();
  } catch (err) {
    showError(`Couldn't add the task. ${err.message}`);
  } finally {
    els.addBtn.disabled = false;
  }
}

async function handleToggle(id, complete) {
  const f = CONFIG.fields;
  const task = tasks.find((t) => t[f.id] === id);
  const previous = task[f.complete];
  task[f.complete] = complete; // optimistic
  render();
  try {
    await api.setCompleted(id, complete);
  } catch (err) {
    task[f.complete] = previous; // roll back
    render();
    showError(`Couldn't update the task. ${err.message}`);
  }
}

async function handlePriorityToggle(id) {
  const f = CONFIG.fields;
  const task = tasks.find((t) => t[f.id] === id);
  const previous = task[f.priority];
  task[f.priority] = previous === "high" ? "low" : "high"; // optimistic
  render();
  try {
    await api.setPriority(id, task[f.priority]);
  } catch (err) {
    task[f.priority] = previous; // roll back
    render();
    showError(`Couldn't update priority. ${err.message}`);
  }
}

function startEdit(li, task) {
  const f = CONFIG.fields;
  const titleEl = li.querySelector(".task-task");
  if (!titleEl) return; // already editing

  const editor = document.createElement("input");
  editor.type = "text";
  editor.className = "task-edit-input";
  editor.value = task[f.task];
  editor.maxLength = 200;
  titleEl.replaceWith(editor);
  editor.focus();
  editor.select();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const newTitle = editor.value.trim();
    if (save && newTitle && newTitle !== task[f.task]) {
      const previous = task[f.task];
      task[f.task] = newTitle; // optimistic
      render();
      try {
        await api.rename(task[f.id], newTitle);
      } catch (err) {
        task[f.task] = previous;
        render();
        showError(`Couldn't rename the task. ${err.message}`);
      }
    } else {
      render();
    }
  };

  editor.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  editor.addEventListener("blur", () => finish(true));
}

async function handleDelete(id) {
  const f = CONFIG.fields;
  const removed = tasks.find((t) => t[f.id] === id);
  tasks = tasks.filter((t) => t[f.id] !== id); // optimistic
  render();
  try {
    await api.remove(id);
  } catch (err) {
    tasks.push(removed); // roll back
    render();
    showError(`Couldn't delete the task. ${err.message}`);
  }
}

/* ── 6. Wire up ─────────────────────────────────────────────────── */
function updatePriorityFieldStyle() {
  els.priorityInput.classList.toggle(
    "priority-select-high",
    els.priorityInput.value === "high"
  );
}

els.addBtn.disabled = true;
els.input.addEventListener("input", () => {
  els.addBtn.disabled = !els.input.value.trim();
});
els.addBtn.addEventListener("click", handleAdd);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAdd();
});
els.priorityInput.addEventListener("change", updatePriorityFieldStyle);
updatePriorityFieldStyle();

loadTasks();

/* ── 7. Daily push notification (OneSignal — stub, wire up later) ─
   Scheduling is pinned to IST (UTC+5:30) regardless of the browser's
   own timezone: shift "now" by the IST offset and read it back with
   the UTC getters, so the wall-clock fields are IST's, not local. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function nowInIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function msUntilNextIST(hour, minute) {
  const nowIST = nowInIST();
  const target = new Date(Date.UTC(
    nowIST.getUTCFullYear(),
    nowIST.getUTCMonth(),
    nowIST.getUTCDate(),
    hour,
    minute,
    0,
    0
  ));
  let diff = target - nowIST;
  if (diff <= 0) diff += 24 * 60 * 60 * 1000;
  return diff;
}

async function sendDailyReminderNotification(highPriorityTasks) {
  if (!highPriorityTasks.length) return;

  const count = highPriorityTasks.length;
  const body =
    count === 1
      ? `High priority: "${highPriorityTasks[0][CONFIG.fields.task]}" is still open`
      : `${count} high-priority tasks are still open`;

  try {
    const res = await fetch(CONFIG.notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, heading: "Daylist reminder" }),
    });
    const data = await res.json();
    console.log("Notification sent:", data);
  } catch (err) {
    console.error("Couldn't send push notification.", err);
  }
}

function scheduleDailyReminder(hour = 22, minute = 0) {
  setTimeout(() => {
    const f = CONFIG.fields;
    const highPriorityTasks = tasks.filter(
      (t) => !t[f.complete] && t[f.priority] === "high"
    );
    sendDailyReminderNotification(highPriorityTasks);
    scheduleDailyReminder(hour, minute);
  }, msUntilNextIST(hour, minute));
}

scheduleDailyReminder();

// ── Manual test trigger — set TEST_HOUR/TEST_MINUTE (24h, IST) to a
// couple minutes from now and reload the page to fire at that time
// instead of waiting for 10 PM IST. Set TEST_HOUR to null to disable.
const TEST_HOUR = 17;
const TEST_MINUTE = 45;

if (TEST_HOUR !== null) {
  setTimeout(() => {
    const f = CONFIG.fields;
    sendDailyReminderNotification(
      tasks.filter((t) => !t[f.complete] && t[f.priority] === "high")
    );
  }, msUntilNextIST(TEST_HOUR, TEST_MINUTE));
}