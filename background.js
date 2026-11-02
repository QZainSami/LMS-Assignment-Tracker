/* global chrome */
console.log('🔥 Background service worker loaded');

const REMINDER_OFFSETS = [
  { key: 'reminder_3d', ms: 3 * 24 * 60 * 60 * 1000 },
  { key: 'reminder_2d', ms: 2 * 24 * 60 * 60 * 1000 },
  { key: 'reminder_today', ms: 0 },
];

function normalize(str) {
  return (str || '').trim().toLowerCase();
}

function assignmentId(a) {
  const s = `${normalize(a.title)}||${normalize(a.deadline)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return 'a_' + Math.abs(h);
}

async function getStoredAssignments() {
  return new Promise((res) => {
    chrome.storage.local.get(['assignments'], (data) => {
      res(data.assignments || []);
    });
  });
}

async function getShownNotifications() {
  return new Promise((res) => {
    chrome.storage.local.get(['shownNotifications'], (data) => {
      res(data.shownNotifications || {});
    });
  });
}

async function markNotificationShown(assignmentId, offsetKey) {
  const shown = await getShownNotifications();
  const key = `${assignmentId}::${offsetKey}`;
  shown[key] = Date.now();
  return new Promise((res) => {
    chrome.storage.local.set({ shownNotifications: shown }, () => res());
  });
}

function formatDueDateString(deadlineMs) {
  try {
    const d = new Date(deadlineMs);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ----------------------------------------------------
// DYNAMIC TOOLBAR BADGE COUNTER
// ----------------------------------------------------
function updateBadge(assignments) {
  const actionApi = chrome.action || chrome.browserAction;
  if (!actionApi || !actionApi.setBadgeText) return;

  const list = Array.isArray(assignments) ? assignments : [];
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Filter only incomplete, non-expired assignments
  const pending = list.filter((a) => {
    if (a.status && /submitted/i.test(a.status)) return false;
    if (!a.deadline) return true;
    const d = new Date(a.deadline);
    return isNaN(d.getTime()) || d >= todayStart;
  });

  const count = pending.length;

  if (count === 0) {
    actionApi.setBadgeText({ text: '' });
    return;
  }

  actionApi.setBadgeText({ text: String(count) });

  // Urgency thresholds
  const msInHour = 60 * 60 * 1000;
  const hasUrgent = pending.some((a) => {
    if (!a.deadline) return false;
    const d = new Date(a.deadline);
    return !isNaN(d.getTime()) && (d.getTime() - now.getTime()) <= 24 * msInHour;
  });

  const hasSoon = pending.some((a) => {
    if (!a.deadline) return false;
    const d = new Date(a.deadline);
    return !isNaN(d.getTime()) && (d.getTime() - now.getTime()) <= 48 * msInHour;
  });

  if (hasUrgent) {
    actionApi.setBadgeBackgroundColor({ color: '#ef4444' }); // Red for <= 24h
  } else if (hasSoon) {
    actionApi.setBadgeBackgroundColor({ color: '#f59e0b' }); // Amber for <= 48h
  } else {
    actionApi.setBadgeBackgroundColor({ color: '#0284c7' }); // Blue for normal
  }
}

// Automatically update badge whenever assignments change in storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.assignments) {
    updateBadge(changes.assignments.newValue);
  }
});

// Initial badge check on service worker start
getStoredAssignments().then(updateBadge);

// ----------------------------------------------------
// PERIODIC DEADLINE NOTIFICATIONS
// ----------------------------------------------------
async function checkAndNotifyUpcomingDeadlines() {
  try {
    const assignments = await getStoredAssignments();
    const shown = await getShownNotifications();

    const msInDay = 24 * 60 * 60 * 1000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const a of assignments) {
      if (!a.deadline) continue;
      const deadline = new Date(a.deadline).getTime();
      if (isNaN(deadline)) continue;

      const dueDay = new Date(deadline);
      dueDay.setHours(0, 0, 0, 0);
      const dayDiff = Math.round((dueDay.getTime() - todayStart.getTime()) / msInDay);

      let keyToUse = null;
      let messageSuffix = '';
      if (dayDiff === 3) {
        keyToUse = 'reminder_3d';
        messageSuffix = `Due in 3 days • ${formatDueDateString(deadline)}`;
      } else if (dayDiff === 2) {
        keyToUse = 'reminder_2d';
        messageSuffix = `Due in 2 days • ${formatDueDateString(deadline)}`;
      } else if (dayDiff === 0) {
        keyToUse = 'reminder_today';
        messageSuffix = `Due today`;
      }

      if (!keyToUse) continue;

      const notificationKey = `${assignmentId(a)}::${keyToUse}`;
      if (shown[notificationKey]) continue;

      const title = `Upcoming due: ${a.title}`;
      const message = `${a.course ? a.course + ' — ' : ''}${messageSuffix}`;

      chrome.notifications.create(
        notificationKey,
        {
          type: 'basic',
          title,
          message,
          iconUrl: chrome.runtime.getURL('icon128.png'),
          priority: 2,
        },
        () => {}
      );

      await markNotificationShown(assignmentId(a), keyToUse);
    }
  } catch (err) {
    console.error('Error in periodic deadline check:', err);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodic_deadline_check') {
    checkAndNotifyUpcomingDeadlines();
    getStoredAssignments().then(updateBadge);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('periodic_deadline_check', { periodInMinutes: 180 });
  checkAndNotifyUpcomingDeadlines();
  getStoredAssignments().then(updateBadge);
});

chrome.runtime.onStartup.addListener(() => {
  getStoredAssignments().then(updateBadge);
});