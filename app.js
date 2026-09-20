import { firebaseConfig } from "./firebase-config.js";
import { VAPID_PUBLIC_KEY } from "./push-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- Firebase setup ----------

const connectionNote = document.getElementById("connection-note");
let db;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  connectionNote.textContent =
    "Firebase isn't configured yet. Open firebase-config.js and paste in your project's config.";
  connectionNote.classList.add("error");
}

const tasksCol = db ? collection(db, "tasks") : null;

// ---------- State ----------

let allTasks = [];
let activeFilter = "all";

const STATUS_LABEL = {
  assigned: "Assigned",
  pending: "Pending",
  completed: "Completed",
  submitted: "Submitted",
  cancelled: "Not submitting"
};

// ---------- DOM refs ----------

const form = document.getElementById("task-form");
const formError = document.getElementById("form-error");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");
const filtersNav = document.getElementById("filters");

const statTotal = document.getElementById("stat-total");
const statPending = document.getElementById("stat-pending");
const statOverdue = document.getElementById("stat-overdue");

const notifyBtn = document.getElementById("notify-btn");
const notifyStatus = document.getElementById("notify-status");

// ---------- Helpers ----------

function todayISO() {
  // Build the local calendar date directly instead of going through
  // toISOString(), which converts to UTC and can silently return
  // yesterday's date for timezones ahead of UTC (e.g. UTC+5:30, UTC+8).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isOverdue(task) {
  if (task.status === "submitted" || task.status === "cancelled") return false;
  return task.deadline < todayISO();
}

function formatDate(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("-")) return String(iso || "");
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// ---------- Rendering ----------

function render() {
  // Stats
  statTotal.textContent = allTasks.length;
  statPending.textContent = allTasks.filter(t => t.status === "pending").length;
  statOverdue.textContent = allTasks.filter(isOverdue).length;

  // Filter
  let visible = allTasks;
  if (activeFilter === "overdue") {
    visible = allTasks.filter(isOverdue);
  } else if (activeFilter !== "all") {
    visible = allTasks.filter(t => t.status === activeFilter);
  }

  taskList.innerHTML = "";

  if (visible.length === 0) {
    emptyState.textContent = allTasks.length === 0
      ? "No tasks yet — add your first one on the left."
      : "Nothing here for this filter.";
    taskList.appendChild(emptyState);
    return;
  }

  visible
    .slice()
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .forEach(task => {
      try {
        taskList.appendChild(renderRow(task));
      } catch (err) {
        console.warn("Skipped a task that couldn't be rendered:", task.id, err);
      }
    });
}

function renderRow(task) {
  const overdue = isOverdue(task);

  const row = document.createElement("div");
  row.className = "task-row";
  row.dataset.status = task.status;
  row.dataset.overdue = overdue;

  const main = document.createElement("div");
  main.className = "task-main";

  const title = document.createElement("div");
  title.className = "task-title" + (task.status === "cancelled" ? " is-cancelled" : "");
  title.textContent = task.title;
  main.appendChild(title);

  if (task.description) {
    const desc = document.createElement("p");
    desc.className = "task-desc";
    desc.textContent = task.description;
    main.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "task-meta";

  const statusChip = document.createElement("span");
  statusChip.className = `chip chip-${task.status}`;
  statusChip.textContent = STATUS_LABEL[task.status];
  meta.appendChild(statusChip);

  if (overdue) {
    const overdueChip = document.createElement("span");
    overdueChip.className = "chip chip-overdue";
    overdueChip.textContent = "Overdue";
    meta.appendChild(overdueChip);
  }

  const dates = document.createElement("span");
  dates.textContent = `Assigned ${formatDate(task.assignedDate)} → Due ${formatDate(task.deadline)}`;
  meta.appendChild(dates);

  main.appendChild(meta);
  row.appendChild(main);

  // Actions
  const actions = document.createElement("div");
  actions.className = "task-actions";

  const select = document.createElement("select");
  select.className = "status-select";
  Object.entries(STATUS_LABEL).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === task.status) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => updateStatus(task.id, select.value));
  actions.appendChild(select);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => removeTask(task.id));
  actions.appendChild(removeBtn);

  row.appendChild(actions);
  return row;
}

// ---------- Push notifications ----------
// Real background push: a service worker + a subscription saved to Firestore.
// The actual "check deadlines and send" work happens server-side, on a
// schedule, in the GitHub Actions workflow — see README.md Part 2. This
// section only handles registering for push and storing the subscription.

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function saveSubscription(subscription) {
  const docId = await sha256Hex(subscription.endpoint);
  await setDoc(doc(db, "subscriptions", docId), {
    subscription: subscription.toJSON(),
    updatedAt: Date.now()
  });
}

async function removeSubscriptionDoc(subscription) {
  const docId = await sha256Hex(subscription.endpoint);
  await deleteDoc(doc(db, "subscriptions", docId)).catch(() => {});
}

async function updateNotifyUI() {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    notifyBtn.disabled = true;
    notifyStatus.textContent = "Push notifications aren't supported in this browser.";
    return;
  }

  if (Notification.permission === "denied") {
    notifyBtn.disabled = true;
    notifyStatus.textContent = "Notifications are blocked for this site in your browser settings.";
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  if (existing) {
    notifyBtn.textContent = "Disable deadline notifications";
    notifyStatus.textContent = "You'll be notified when a task is due today or overdue.";
  } else {
    notifyBtn.textContent = "Enable deadline notifications";
    notifyStatus.textContent = "";
  }
}

async function toggleNotifications() {
  if (!tasksCol) {
    notifyStatus.textContent = "Firebase isn't configured yet.";
    return;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("PASTE_")) {
    notifyStatus.textContent = "push-config.js still has a placeholder VAPID key — see README.md Part 2.";
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  let statusOverride = null;

  try {
    if (existing) {
      await removeSubscriptionDoc(existing);
      await existing.unsubscribe();
      statusOverride = "Notifications disabled.";
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        notifyStatus.textContent = "Permission wasn't granted, so notifications stay off.";
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      try {
        await saveSubscription(subscription);
        statusOverride = "You'll be notified when a task is due today or overdue.";
      } catch (saveErr) {
        // The browser-level subscription succeeded but saving it to
        // Firestore didn't — roll back so we don't end up "subscribed"
        // locally with no record the server can ever find or send to.
        await subscription.unsubscribe().catch(() => {});
        throw new Error("Couldn't save your subscription to Firestore: " + saveErr.message);
      }
    }
  } catch (err) {
    notifyStatus.textContent = "Couldn't update notifications: " + err.message;
    return; // don't let updateNotifyUI() below overwrite this real error
  }

  await updateNotifyUI();
  if (statusOverride) notifyStatus.textContent = statusOverride;
}

async function initPush() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    notifyBtn.addEventListener("click", toggleNotifications);
    updateNotifyUI();
  } catch (err) {
    notifyStatus.textContent = "Service worker registration failed: " + err.message;
  }
}

// ---------- Firestore operations ----------

function subscribeToTasks() {
  if (!tasksCol) return;
  const q = query(tasksCol, orderBy("deadline", "asc"));
  onSnapshot(
    q,
    snapshot => {
      allTasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    },
    err => {
      connectionNote.textContent = "Couldn't load tasks: " + err.message;
      connectionNote.classList.add("error");
    }
  );
}

async function addTask(task) {
  await addDoc(tasksCol, task);
}

async function updateStatus(id, status) {
  await updateDoc(doc(db, "tasks", id), { status });
}

async function removeTask(id) {
  if (!confirm("Remove this task? This can't be undone.")) return;
  await deleteDoc(doc(db, "tasks", id));
}

// ---------- Events ----------

form.addEventListener("submit", async e => {
  e.preventDefault();
  formError.textContent = "";

  if (!tasksCol) {
    formError.textContent = "Firebase isn't configured yet — see the note below the form.";
    return;
  }

  const title = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();
  const assignedDate = document.getElementById("assigned-date").value;
  const deadline = document.getElementById("deadline-date").value;

  if (!title || !assignedDate || !deadline) {
    formError.textContent = "Please fill in the title, assigned date, and deadline.";
    return;
  }

  if (deadline < assignedDate) {
    formError.textContent = "Deadline can't be before the assigned date.";
    return;
  }

  try {
    await addTask({
      title,
      description,
      assignedDate,
      deadline,
      status: "assigned",
      createdAt: Date.now()
    });
    form.reset();
    document.getElementById("assigned-date").value = todayISO();
  } catch (err) {
    formError.textContent = "Couldn't save: " + err.message;
  }
});

filtersNav.addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  filtersNav.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  activeFilter = btn.dataset.filter;
  render();
});

// ---------- Init ----------

document.getElementById("assigned-date").value = todayISO();
subscribeToTasks();
initPush();

