# Bahria LMS Assignment Tracker

A lightweight Manifest V3 browser extension for Bahria University students that aggregates pending assignment deadlines across all enrolled courses on the LMS portal into a clean, priority-sorted dashboard with automated background notifications.

---

## Features

- **Automated Multi-Course Crawl:** Scans through every course section in your LMS dropdown and extracts active deadlines in one click.
- **Priority-Sorted Deadlines:** Urgency badges highlight items due today, within 48 hours, or upcoming.
- **Direct Submission Links:** Quickly navigate straight to the relevant assignment submission page.
- **Background Reminders:** Periodic background checks notify you of deadlines due in 3 days, 2 days, and on the due date.
- **Compact 2-Column Grid:** Designed in a clean slate theme matching the Bahria CMS Attendance Tracker, displaying all active tasks without vertical clutter.
- **Pure Vanilla Architecture:** Zero heavy frameworks or minified bundles—runs on lightweight, fast, native WebExtension APIs.

---

## Installation & Setup

### 1. Firefox / Zen Browser (AMO Store)

1. Navigate to the official **[Mozilla Add-ons (AMO)](https://addons.mozilla.org/)** listing.
2. Search for **"Bahria LMS Assignment Tracker"**.
3. Click **Add to Firefox**.
4. The extension installs permanently and updates automatically with new releases.

---

### 2. Google Chrome / Brave / Edge (Developer Mode)

1. Clone or download this repository as a `.zip` archive and extract it locally.
2. Open your browser and navigate to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** via the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the extracted project folder (containing `manifest.json`).

---

## How to Use

1. Log in to your Bahria LMS portal: `https://lms.bahria.edu.pk/`
2. Navigate to **Assignments** (`Student/Assignments.php`).
3. Click the extension icon in your browser toolbar.
4. Click **Sync All Courses**.
5. The extension will automatically step through your registered courses in the background tab and aggregate all incomplete assignments into your dashboard.

---

## Technical Details & Permissions

- **`storage`:** Caches assignments locally on your machine to display tasks immediately when clicking the toolbar popup.
- **`alarms`:** Powers periodic 3-hour background checks for upcoming deadlines.
- **`notifications`:** Sends system desktop notifications for approaching due dates.
- **`tabs` / `activeTab`:** Orchestrates seamless tab navigation across course query parameters (`?oc=...`) during sync.
- **`host_permissions` (`*://lms.bahria.edu.pk/*`):** Restricted solely to the university LMS domain to read assignment tables and deadlines.

---

## Notes for AMO Reviewers

- **Source Code:** All files (`background.js`, `content.js`, `dist/popup.html`, `dist/popup.js`) are 100% human-readable vanilla JavaScript, HTML, and CSS. No bundlers, compilers, or minifiers are used.
- **Notification Compatibility:** Background notifications utilize standard WebExtension APIs. Any unsupported properties on specific Gecko platforms (such as `requireInteraction`) are gracefully disregarded without breaking notification delivery.
- **Target URL:** `https://lms.bahria.edu.pk/Student/Assignments.php`

---

## License

This project is licensed under the [MIT License](LICENSE) — free for student use, contributions, and community improvements.