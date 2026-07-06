"use strict";

/* ════════════════════════════════════════════════════════════════════
   CONFIG — everything environment-specific lives here.
   ════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  // CAP OData V4 entity set URL, e.g.
  // https://<app>.cfapps.us10.hana.ondemand.com/odata/v4/todo/ToDo
  odataUrl:
    "https://b1d9f557trial-dev-todo-srv.cfapps.us10-001.hana.ondemand.com/odata/v4/to-do-/ToDo",

  // Field names in your CDS entity — adjust if yours differ.
  fields: {
    id: "ID",          // key, Edm.Guid (cuid aspect)
    task: "task",    // String
    complete: "complete", // Boolean
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
  create: (task) =>
    odata("POST", "", {
      [CONFIG.fields.task]: task,
      [CONFIG.fields.complete]: false,
    }),
  setCompleted: (id, complete) =>
    odata("PATCH", keyPath(id), { [CONFIG.fields.complete]: complete }),
  rename: (id, task) =>
    odata("PATCH", keyPath(id), { [CONFIG.fields.task]: task }),
  remove: (id) => odata("DELETE", keyPath(id)),
};

/* ── 3. DOM references & state ──────────────────────────────────── */
const els = {
  input: document.getElementById("taskInput"),
  addBtn: document.getElementById("addBtn"),
  list: document.getElementById("taskList"),
  empty: document.getElementById("emptyState"),
  loading: document.getElementById("loadingState"),
  banner: document.getElementById("banner"),
  counterOpen: document.getElementById("counterOpen"),
};

let tasks = [];

/* ── 4. Rendering ───────────────────────────────────────────────── */
function render() {
  const f = CONFIG.fields;
  els.list.innerHTML = "";
  els.empty.hidden = tasks.length !== 0;
  els.counterOpen.textContent = tasks.filter((t) => !t[f.complete]).length;

  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "task" + (task[f.complete] ? " done" : "");
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
    li.append(check, taskEl, actions);
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
  els.addBtn.disabled = true;
  try {
    const created = await api.create(task);
    tasks.push(created);
    els.input.value = "";
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
els.addBtn.disabled = true;
els.input.addEventListener("input", () => {
  els.addBtn.disabled = !els.input.value.trim();
});
els.addBtn.addEventListener("click", handleAdd);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAdd();
});

loadTasks();