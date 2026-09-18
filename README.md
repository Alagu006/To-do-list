# Task Log

A simple to-do / task tracker with statuses (Assigned, Pending, Completed,
Submitted, Not submitting) and automatic overdue flagging, backed by a free
Firebase Firestore database and hosted on GitHub Pages.

## Files

- `index.html` — page structure
- `style.css` — styling
- `firebase-config.js` — **you edit this** with your own project keys
- `app.js` — app logic (add/edit/delete tasks, filters, overdue logic)

## 1. Create a free Firebase project

1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Click **Add project**, give it a name (e.g. `task-log`), and finish the
   wizard (you can turn off Google Analytics — not needed here).
3. In the left sidebar, go to **Build → Firestore Database** → **Create database**.
   - Choose a location close to you.
   - Start in **test mode** for now (we'll tighten this in step 3).

## 2. Get your web app config

1. In Project settings (gear icon, top left) → scroll to **Your apps**.
2. Click the **Web** icon (`</>`) to register a new web app. Any nickname is fine.
3. You do **not** need Firebase Hosting — just copy the `firebaseConfig`
   object shown.
4. Open `firebase-config.js` in this project and paste your values in,
   replacing the placeholder strings.

This config is safe to have visible in your code — it identifies your
project, it isn't a secret key. Access control happens in step 3.

## 3. Set Firestore security rules

Since this app has no login, anyone who has your config *and* knows to look
could technically read/write your `tasks` collection if left wide open.
Since you're keeping this for personal use with an unlisted GitHub Pages
URL, a reasonable middle ground is to at least restrict writes to the
shape you expect. In Firestore → **Rules**, replace the default with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /tasks/{taskId} {
      allow read: if true;

      allow create: if request.resource.data.keys().hasAll(['title','assignedDate','deadline','status'])
                    && request.resource.data.title is string
                    && request.resource.data.title.size() > 0
                    && request.resource.data.title.size() < 300
                    && request.resource.data.assignedDate is string
                    && request.resource.data.deadline is string
                    && (!('description' in request.resource.data) || (request.resource.data.description is string && request.resource.data.description.size() < 2000))
                    && request.resource.data.status in ['assigned','pending','completed','submitted','cancelled'];

      // Only status, description, and the two "already notified" flags may
      // change on update — title/assignedDate/deadline can't be silently
      // rewritten by anyone who has the public config.
      allow update: if request.resource.data.diff(resource.data).affectedKeys()
                      .hasOnly(['status','description','notifiedDueDate','notifiedOverdue'])
                    && request.resource.data.status in ['assigned','pending','completed','submitted','cancelled'];

      allow delete: if true;
    }

    // Push subscriptions: the GitHub Actions script reads/writes these
    // using a privileged Admin SDK credential, which bypasses these rules
    // entirely. These rules only govern what the *browser* can do.
    match /subscriptions/{subId} {
      allow read: if false;   // no reason a browser ever needs to list these
      allow create, update: if request.resource.data.keys().hasAll(['subscription','updatedAt'])
                    && request.resource.data.subscription.keys().hasAll(['endpoint','keys'])
                    && request.resource.data.subscription.endpoint is string;
      allow delete: if true;  // lets a device un-enroll itself
    }
  }
}
```

This is not real authentication — anyone with your Firebase config could
still find the project and, worst case, read your task titles or clear
your list. It stops the clearer abuse cases (malformed data, wrong field
types that could crash the app's rendering, rewriting fields it shouldn't,
reading push subscription contents) without adding login. If you ever want
this properly private, the next step up is adding Firebase Authentication
(email/password) and changing these rules to check `request.auth != null`.
Not needed to get started.

Click **Publish** after pasting the rules.

## 4. Put it on GitHub Pages

1. Create a new GitHub repository (private or public — either works, but
   note a private repo does not make the *published site* private, only
   Pro/Team/Enterprise plans support that).
2. Add these four files (`index.html`, `style.css`, `app.js`,
   `firebase-config.js`) to the repo and push.
3. Go to the repo's **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`,
   pick your branch (e.g. `main`) and folder `/ (root)`, then **Save**.
5. Wait a minute or two, then GitHub will show your live URL, something like:
   `https://yourusername.github.io/your-repo-name/`

## Using the app

- Add a task on the left with a title, optional description, assigned date,
  and deadline. New tasks start as **Assigned**.
- Change a task's status any time from the dropdown on its row.
- Tasks past their deadline that aren't **Submitted** or **Not submitting**
  are automatically flagged **Overdue** — no need to set this manually.
- Use the filter tabs to see just one status, or just overdue items.
- **Remove** deletes a task permanently.

## Notes

- Data lives in Firestore, so it syncs across any device/browser where you
  open the site — not tied to one browser like `localStorage` would be.
- Firebase's free "Spark" tier (1 GB storage, 50k reads/day, 20k writes/day)
  is far more than a personal task list will ever use, and requires no
  credit card.

---

## Part 2 — Deadline push notifications (works even with the browser closed)

This adds real OS-level notifications ("Task due today" / "Task overdue")
using the Web Push standard. No Firebase billing plan required — the
scheduled check runs on **GitHub Actions**, which is free.

New files involved: `sw.js`, `push-config.js`, `.github/workflows/check-deadlines.yml`,
`scripts/check-deadlines.js`, `scripts/package.json`.

### 1. Generate a VAPID key pair

VAPID keys let push services (Chrome, Firefox, etc.) verify that pushes are
coming from you. Generate them once, locally, so the private key never
touches a third-party website:

```
npx web-push generate-vapid-keys
```

(Needs [Node.js](https://nodejs.org) installed on your computer. This
prints a Public Key and a Private Key — keep both, you'll use each once.)

### 2. Paste the public key into the app

Open `push-config.js` and replace the placeholder:

```js
export const VAPID_PUBLIC_KEY = "your public key here";
```

### 3. Get a Firebase service account key

This is a privileged credential that lets the GitHub Actions script read/write
Firestore directly, bypassing the security rules above (that's expected —
it's your own trusted script, running only in CI, never in a browser).

1. Firebase Console → gear icon → **Project settings** → **Service accounts**.
2. Click **Generate new private key** → confirm → a `.json` file downloads.
3. **Treat this file like a master password.** Never commit it to the repo,
   never paste it anywhere public.

### 4. Add three GitHub Actions secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add:

| Secret name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | The *entire contents* of the service account `.json` file, pasted as-is |
| `VAPID_PUBLIC_KEY` | The public key from step 1 |
| `VAPID_PRIVATE_KEY` | The private key from step 1 |

### 5. Push everything and update your Firestore rules

Push all the new files to your repo (the workflow file must be at
`.github/workflows/check-deadlines.yml` for GitHub to pick it up
automatically). Also paste the updated rules from the Firestore Rules
section above — the `subscriptions` collection needs its own rules.

### 6. Test it

1. On your live site, click **Enable deadline notifications** and accept
   the browser's permission prompt.
2. In GitHub, go to the **Actions** tab → **Check task deadlines** →
   **Run workflow** (this triggers it immediately instead of waiting for
   the hourly schedule) → check the run's logs for `Notified: ...` lines.
3. Add a task with today's date as the deadline, run the workflow again,
   and you should get a real OS notification within moments.

### Good to know

- **Runs hourly**, on the hour, in UTC. GitHub doesn't guarantee the exact
  minute — it can occasionally run a few minutes late, especially on the
  free plan under load. Fine for a daily-deadline use case.
- **Cost:** each run takes well under a minute; even hourly (~730 runs/month)
  this uses only a few hours of Actions minutes — far under the free
  2,000 min/month for private repos (and unlimited/free for public repos).
- **Per-device opt-in:** each browser/device needs you to click "Enable
  deadline notifications" once. Uninstalling the site, clearing site data,
  or denying the permission stops notifications for that device only.
- **iOS/Safari:** Apple only allows web push if the site has been added to
  the Home Screen as an installed app (Settings → Share → Add to Home
  Screen), on iOS 16.4+ / macOS Safari 16+. From a normal Safari tab it
  won't work — this is an Apple platform restriction, not something fixable
  in this code.
- **Timezone note:** the Actions script checks "today" using UTC time (GitHub's
  servers don't know your local timezone), so due-date notifications can be
  off by a few hours around midnight in your local time. Good enough for a
  daily reminder; not perfectly exact to the minute.

## Security notes

This app has no login by design — access is controlled only by keeping the
GitHub Pages URL unlisted. Given that, here's what is and isn't protected:

- **Accepted risk:** the Firebase config is a public static file, so anyone
  who finds your URL could technically read or delete your tasks directly
  via the Firestore API, bypassing the UI entirely. This is a known, accepted
  tradeoff of skipping login for a personal tool — not something these rules
  can fully close.
- **Closed:** the rules validate field types and restrict which fields can
  change on update, so a malformed or malicious write can no longer crash
  the app's rendering or silently rewrite a task's title/dates.
- **Closed:** push subscription contents are unreadable by any browser client
  (`allow read: if false`) — only your own GitHub Actions script, using a
  privileged credential, can read them.
- **Never commit:** the Firebase service-account key or VAPID private key.
  Both live only as GitHub Actions secrets. `.gitignore` is set up to help
  catch accidental commits of key files and `node_modules/`.
- If you ever want this properly locked down, add Firebase Authentication
  and require `request.auth != null` in the rules — a bigger change, not
  needed to use the app day-to-day.
