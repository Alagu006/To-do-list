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
                    && request.resource.data.status in ['assigned','pending','completed','submitted','cancelled'];
      allow update: if request.resource.data.status in ['assigned','pending','completed','submitted','cancelled'];
      allow delete: if true;
    }
  }
}
```

This is not real authentication — anyone with your Firebase config could
still find the project. It just stops obviously malformed writes. If you
ever want this properly private, the next step up is adding Firebase
Authentication (email/password) and changing these rules to check
`request.auth != null`. Not needed to get started.

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
