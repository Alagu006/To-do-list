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

// "Today" is computed in Asia/Kolkata (IST) specifically, rather than the
// GitHub runner's UTC clock, so the due/overdue boundary lines up with
// your actual calendar day instead of being off by several hours.
const NOTIFY_TIMEZONE = "Asia/Kolkata";

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NOTIFY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
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

function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00Z");
  const b = new Date(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
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
    if (!isDueToday && !isOverdue) continue; // not due yet

    // One notification per task per calendar day, but repeats every day
    // it remains unresolved (not just once ever) — this is the fix for
    // "it notified once but never again the next day while overdue."
    if (task.lastNotifiedDate === today) continue;

    if (isDueToday) {
      await sendToAll(subs, {
        title: "Task due today",
        body: task.title,
        tag: `due-${docSnap.id}`,
        url: "./"
      });
      console.log("Notified (due today):", task.title);
    } else {
      const daysOverdue = daysBetween(task.deadline, today);
      await sendToAll(subs, {
        title: `Task overdue (${daysOverdue} day${daysOverdue === 1 ? "" : "s"})`,
        body: task.title,
        tag: `overdue-${docSnap.id}`,
        url: "./"
      });
      console.log(`Notified (overdue, ${daysOverdue}d):`, task.title);
    }

    await docSnap.ref.update({ lastNotifiedDate: today });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
