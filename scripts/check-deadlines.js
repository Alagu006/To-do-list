// Runs on a schedule via GitHub Actions (see ../.github/workflows/check-deadlines.yml).
// Uses a privileged Firebase Admin credential (bypasses Firestore security
// rules entirely) — this script only ever runs server-side in CI, never
// in the browser. Never commit the service account key or VAPID private
// key to the repo; both are read from GitHub Actions secrets at runtime.

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
// Using the modular API (firebase-admin/app, firebase-admin/firestore)
// rather than the older `require("firebase-admin")` namespaced style
// (admin.credential.cert / admin.firestore()) — that older API was
// removed in firebase-admin v13+. If you see older examples online using
// `admin.credential.cert(...)`, they're for firebase-admin v12 or earlier.
const webpush = require("web-push");

const {
  FIREBASE_SERVICE_ACCOUNT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT
} = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("Missing one or more required secrets/env vars. See README.md Part 2.");
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT))
});
const db = getFirestore();

webpush.setVapidDetails(
  VAPID_SUBJECT || "mailto:you@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Note: this runs on GitHub's servers in UTC. "Today" here is the UTC
// calendar date, which may be a few hours offset from your local date.
// For an hourly check on a personal task list this is a reasonable
// tradeoff; it is not perfectly timezone-exact.
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function getSubscriptions() {
  const snap = await db.collection("subscriptions").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function sendToAll(subs, payload) {
  await Promise.all(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription is gone (uninstalled, browser data cleared, etc.) — clean it up.
          await db.collection("subscriptions").doc(sub.id).delete().catch(() => {});
        } else {
          console.error("Push failed for subscription", sub.id, err.message);
        }
      }
    })
  );
}

async function main() {
  const today = todayISO();
  const [tasksSnap, subs] = await Promise.all([db.collection("tasks").get(), getSubscriptions()]);

  if (subs.length === 0) {
    console.log("No push subscriptions saved yet — nothing to notify.");
    return;
  }

  for (const docSnap of tasksSnap.docs) {
    const task = docSnap.data();
    if (task.status === "submitted" || task.status === "cancelled") continue;
    if (!task.deadline) continue;

    const isDueToday = task.deadline === today;
    const isOverdue = task.deadline < today;

    if (isDueToday && task.notifiedDueDate !== today) {
      await sendToAll(subs, {
        title: "Task due today",
        body: task.title,
        tag: `due-${docSnap.id}`,
        url: "./"
      });
      await docSnap.ref.update({ notifiedDueDate: today });
      console.log("Notified (due today):", task.title);
    } else if (isOverdue && !task.notifiedOverdue) {
      await sendToAll(subs, {
        title: "Task overdue",
        body: task.title,
        tag: `overdue-${docSnap.id}`,
        url: "./"
      });
      await docSnap.ref.update({ notifiedOverdue: true });
      console.log("Notified (overdue):", task.title);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
