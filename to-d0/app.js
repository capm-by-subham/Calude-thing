"use strict";

/* ════════════════════════════════════════════════════════════════════
   CONFIG — everything environment-specific lives here.
   (Unchanged: same OData endpoint, fields, and CRUD behavior.)
   ════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  // CAP OData V4 entity set URL
  odataUrl:
    "https://b1d9f557trial-dev-todo-srv.cfapps.us10-001.hana.ondemand.com/odata/v4/to-do-/ToDo",

  // Server-side proxy that sends the push via OneSignal's REST API —
  // see todo/srv/server.js. The browser can't call OneSignal directly
  // (no CORS, and it'd expose the REST API key).
  // notifyUrl:
  //   "https://b1d9f557trial-dev-todo-srv.cfapps.us10-001.hana.ondemand.com/notify",

  fields: {
    id: "ID",           // key, Edm.Guid (cuid aspect)
    task: "task",       // String
    complete: "complete", // Boolean
    priority: "priority", // String enum: high | low
  },
};

/* Motion preference — FX layer respects it everywhere */
const REDUCED_MOTION = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

/* ── 1. Generic OData request helper (unchanged) ────────────────── */
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
  return res.status === 204 ? null : res.json();
}

/* OData V4: Edm.Guid keys go in parentheses WITHOUT quotes */
const keyPath = (id) => `(${id})`;

/* ── 2. CRUD operations (unchanged) ─────────────────────────────── */
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
  progressFill: document.getElementById("progressFill"),
  progressPct: document.getElementById("progressPct"),
  progressCount: document.getElementById("progressCount"),
  soundToggle: document.getElementById("soundToggle"),
};

let tasks = [];

/* ids that should play the entrance animation on the next render */
let animateIn = new Set();
let staggerNext = false;

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

/* ════════════════════════════════════════════════════════════════════
   FX LAYER — sound, ripples, confetti, FLIP reorders, ember canvas.
   Purely additive: core CRUD logic above stays the same.
   ════════════════════════════════════════════════════════════════════ */

/* ── Sound (WebAudio blips, muted by default) ───────────────────── */
const sound = (() => {
  let enabled = false;
  try {
    enabled = localStorage.getItem("daylist-sound") === "on";
  } catch (_) { /* private mode etc. */ }

  let ctx = null;
  const audioCtx = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  };

  function tone(freq, duration, type = "sine", gainPeak = 0.12, when = 0) {
    const ac = audioCtx();
    if (!ac) return;
    const t0 = ac.currentTime + when;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem("daylist-sound", enabled ? "on" : "off"); } catch (_) {}
      if (enabled) tone(660, 0.12, "sine", 0.08); // confirmation blip
      return enabled;
    },
    complete() {
      if (!enabled) return;
      tone(523.25, 0.14, "sine", 0.1);        // C5
      tone(783.99, 0.18, "sine", 0.1, 0.09);  // G5 — little rising "ding"
    },
    delete() {
      if (!enabled) return;
      tone(220, 0.16, "triangle", 0.09);       // soft low thud
    },
    add() {
      if (!enabled) return;
      tone(440, 0.1, "sine", 0.07);
    },
  };
})();

/* ── Ripple press feedback ──────────────────────────────────────── */
function attachRipple(btn) {
  btn.addEventListener("pointerdown", (e) => {
    if (REDUCED_MOTION) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(span);
    span.addEventListener("animationend", () => span.remove());
  });
}

/* ── Confetti burst on completion (canvas-confetti via CDN) ─────── */
function sparkBurst(x, y) {
  if (REDUCED_MOTION || typeof confetti !== "function") return;
  confetti({
    particleCount: 26,
    startVelocity: 22,
    spread: 70,
    gravity: 0.9,
    scalar: 0.75,
    ticks: 110,
    origin: { x: x / window.innerWidth, y: y / window.innerHeight },
    colors: ["#ff8a3d", "#ffc857", "#ff5f52", "#ffe9c9"],
    disableForReducedMotion: true,
  });
}

/* ── FLIP: smooth reorders when the list resorts ────────────────── */
function capturePositions() {
  const map = new Map();
  for (const li of els.list.children) {
    map.set(li.dataset.id, li.getBoundingClientRect());
  }
  return map;
}

function playFlip(first) {
  if (REDUCED_MOTION || !first) return;
  for (const li of els.list.children) {
    const prev = first.get(li.dataset.id);
    if (!prev) continue;
    const next = li.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (!dx && !dy) continue;
    li.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }
}

/* ── Counter bump micro-interaction ─────────────────────────────── */
function bumpCounter() {
  els.counterOpen.classList.remove("bump");
  void els.counterOpen.offsetWidth; // restart animation
  els.counterOpen.classList.add("bump");
}

/* ── Ambient ember particles (canvas) + mouse parallax ──────────── */
(function initBackground() {
  const parallax = document.getElementById("bgParallax");
  if (parallax && !REDUCED_MOTION && matchMedia("(pointer: fine)").matches) {
    window.addEventListener("pointermove", (e) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      parallax.style.transform = `translate(${nx * -18}px, ${ny * -14}px)`;
    });
  }

  const canvas = document.getElementById("emberCanvas");
  if (!canvas || REDUCED_MOTION) return;
  const ctx = canvas.getContext("2d");
  let w, h, dpr;
  let particles = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const COUNT = Math.min(46, Math.floor(w / 16));
  const COLORS = ["255,138,61", "255,200,87", "255,170,110"];

  function spawn(initial) {
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + 8,
      r: 0.6 + Math.random() * 1.8,
      vy: 0.14 + Math.random() * 0.4,
      drift: (Math.random() - 0.5) * 0.25,
      phase: Math.random() * Math.PI * 2,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      alpha: 0.25 + Math.random() * 0.5,
    };
  }
  for (let i = 0; i < COUNT; i++) particles.push(spawn(true));

  let t = 0;
  (function frame() {
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.y -= p.vy;
      p.x += p.drift + Math.sin(t * 1.4 + p.phase) * 0.18;
      const twinkle = 0.75 + Math.sin(t * 2.2 + p.phase) * 0.25;
      if (p.y < -10 || p.x < -10 || p.x > w + 10) particles[i] = spawn(false);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${(p.alpha * twinkle).toFixed(3)})`;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
})();

/* ════════════════════════════════════════════════════════════════════
   4. Rendering
   ════════════════════════════════════════════════════════════════════ */
function updateProgress() {
  const f = CONFIG.fields;
  const total = tasks.length;
  const done = tasks.filter((t) => t[f.complete]).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (els.progressFill) els.progressFill.style.width = pct + "%";
  if (els.progressPct) els.progressPct.textContent = pct + "%";
  if (els.progressCount)
    els.progressCount.textContent = total
      ? `${done} of ${total} done`
      : "No tasks yet";
}

function render() {
  const f = CONFIG.fields;
  els.list.innerHTML = "";
  els.empty.hidden = tasks.length !== 0;
  els.counterOpen.textContent = tasks.filter((t) => !t[f.complete]).length;
  updateProgress();

  let index = 0;
  for (const task of sortedTasks()) {
    const priority = task[f.priority] || "low";
    const li = document.createElement("li");
    li.className =
      "task" + (task[f.complete] ? " done" : "") + ` priority-${priority}`;
    li.dataset.id = task[f.id];

    if (animateIn.has(task[f.id])) {
      li.classList.add("task-in");
      if (staggerNext) li.style.setProperty("--i", index);
      li.addEventListener(
        "animationend",
        () => li.classList.remove("task-in"),
        { once: true }
      );
    }

    /* custom animated checkbox (still a real <input> for a11y) */
    const checkWrap = document.createElement("label");
    checkWrap.className = "check-wrap";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = !!task[f.complete];
    check.setAttribute("aria-label", "Mark task complete");
    check.addEventListener("change", () =>
      handleToggle(task[f.id], check.checked)
    );

    const checkBox = document.createElement("span");
    checkBox.className = "check-box";
    checkBox.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 13 10 18 19 7"/></svg>';

    checkWrap.append(check, checkBox);

    const taskEl = document.createElement("span");
    taskEl.className = "task-task";
    taskEl.textContent = task[f.task];
    taskEl.addEventListener("dblclick", () => startEdit(li, task));

    const priorityBadge = document.createElement("button");
    priorityBadge.type = "button";
    priorityBadge.className = "priority-badge";
    priorityBadge.textContent = priority;
    priorityBadge.title = "Click to toggle priority";
    priorityBadge.addEventListener("click", () =>
      handlePriorityToggle(task[f.id])
    );

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

    attachRipple(editBtn);
    attachRipple(delBtn);

    actions.append(editBtn, delBtn);
    li.append(checkWrap, taskEl, priorityBadge, actions);
    els.list.appendChild(li);
    index++;
  }

  animateIn.clear();
  staggerNext = false;
}

function showError(msg) {
  els.banner.textContent = msg;
  els.banner.hidden = false;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => (els.banner.hidden = true), 6000);
}

/* ════════════════════════════════════════════════════════════════════
   5. Handlers — same optimistic-update + rollback flow as before,
   with animation hooks layered on top.
   ════════════════════════════════════════════════════════════════════ */
async function loadTasks() {
  els.loading.hidden = false;
  try {
    tasks = await api.list();
    const f = CONFIG.fields;
    tasks.forEach((t) => animateIn.add(t[f.id])); // staggered first paint
    staggerNext = true;
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
    const first = capturePositions();
    tasks.push(created);
    animateIn.add(created[CONFIG.fields.id]); // spring the new card in
    els.input.value = "";
    els.priorityInput.value = "low";
    updatePriorityFieldStyle();
    render();
    playFlip(first);
    bumpCounter();
    sound.add();
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

  /* fire the celebration from the checkbox's on-screen position
     before the list resorts */
  if (complete) {
    const li = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const box = li?.querySelector(".check-box");
    if (box) {
      const r = box.getBoundingClientRect();
      sparkBurst(r.left + r.width / 2, r.top + r.height / 2);
    }
    sound.complete();
  }

  const first = capturePositions();
  task[f.complete] = complete; // optimistic
  render();
  playFlip(first);
  bumpCounter();

  if (complete && !REDUCED_MOTION) {
    const li = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (li) {
      li.classList.add("just-done");
      li.addEventListener(
        "animationend",
        () => li.classList.remove("just-done"),
        { once: true }
      );
    }
  }

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
  const first = capturePositions();
  render();
  playFlip(first);
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

  /* exit animation first, then the same optimistic remove as before */
  sound.delete();
  const li = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (li && !REDUCED_MOTION) {
    li.classList.add("task-out");
    await new Promise((resolve) => {
      li.addEventListener("animationend", resolve, { once: true });
      setTimeout(resolve, 400); // safety net
    });
  }

  const first = capturePositions();
  tasks = tasks.filter((t) => t[f.id] !== id); // optimistic
  render();
  playFlip(first);
  bumpCounter();
  try {
    await api.remove(id);
  } catch (err) {
    tasks.push(removed); // roll back
    animateIn.add(id);
    render();
    showError(`Couldn't delete the task. ${err.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════
   6. Wire up
   ════════════════════════════════════════════════════════════════════ */
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

attachRipple(els.addBtn);

/* sound toggle (muted by default) */
if (els.soundToggle) {
  const paint = (on) => {
    els.soundToggle.setAttribute("aria-pressed", on ? "true" : "false");
    els.soundToggle.textContent = on ? "🔊" : "🔇";
    els.soundToggle.title = on ? "Mute sounds" : "Unmute sounds";
  };
  paint(sound.enabled);
  els.soundToggle.addEventListener("click", () => paint(sound.toggle()));
}

loadTasks();

/* ── 7. Daily push notification (OneSignal — stub, wire up later) ─
   Scheduling is pinned to IST (UTC+5:30) regardless of the browser's
   own timezone: shift "now" by the IST offset and read it back with
   the UTC getters, so the wall-clock fields are IST's, not local.

   Commented out for now — revisit later. */
// const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
//
// function nowInIST() {
//   return new Date(Date.now() + IST_OFFSET_MS);
// }
//
// function msUntilNextIST(hour, minute) {
//   const nowIST = nowInIST();
//   const target = new Date(Date.UTC(
//     nowIST.getUTCFullYear(),
//     nowIST.getUTCMonth(),
//     nowIST.getUTCDate(),
//     hour,
//     minute,
//     0,
//     0
//   ));
//   let diff = target - nowIST;
//   if (diff <= 0) diff += 24 * 60 * 60 * 1000;
//   return diff;
// }
//
// async function sendDailyReminderNotification(highPriorityTasks) {
//   if (!highPriorityTasks.length) return;
//
//   const count = highPriorityTasks.length;
//   const body =
//     count === 1
//       ? `High priority: "${highPriorityTasks[0][CONFIG.fields.task]}" is still open`
//       : `${count} high-priority tasks are still open`;
//
//   try {
//     const res = await fetch(CONFIG.notifyUrl, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ body, heading: "Daylist reminder" }),
//     });
//     const data = await res.json();
//     console.log("Notification sent:", data);
//   } catch (err) {
//     console.error("Couldn't send push notification.", err);
//   }
// }
//
// function scheduleDailyReminder(hour = 22, minute = 0) {
//   setTimeout(() => {
//     const f = CONFIG.fields;
//     const highPriorityTasks = tasks.filter(
//       (t) => !t[f.complete] && t[f.priority] === "high"
//     );
//     sendDailyReminderNotification(highPriorityTasks);
//     scheduleDailyReminder(hour, minute);
//   }, msUntilNextIST(hour, minute));
// }
//
// scheduleDailyReminder();
//
// // ── Manual test trigger — set TEST_HOUR/TEST_MINUTE (24h, IST) to a
// // couple minutes from now and reload the page to fire at that time
// // instead of waiting for 10 PM IST. Set TEST_HOUR to null to disable.
// const TEST_HOUR = 17;
// const TEST_MINUTE = 45;
//
// if (TEST_HOUR !== null) {
//   setTimeout(() => {
//     const f = CONFIG.fields;
//     sendDailyReminderNotification(
//       tasks.filter((t) => !t[f.complete] && t[f.priority] === "high")
//     );
//   }, msUntilNextIST(TEST_HOUR, TEST_MINUTE));
// }