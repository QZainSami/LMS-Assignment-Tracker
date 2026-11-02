/* global chrome */

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('assignments-grid');
  const refreshBtn = document.getElementById('refresh-btn');
  const clearBtn = document.getElementById('clear-btn');
  const countTag = document.getElementById('assignment-count');
  const syncStatus = document.getElementById('sync-status');

  function parseDeadline(isoStr) {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  function computeDiff(deadlineDate) {
    if (!deadlineDate) return { label: 'No date', class: 'badge-expired' };
    const now = new Date();
    const diffMs = deadlineDate.getTime() - now.getTime();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    if (deadlineDate >= startOfToday && deadlineDate <= endOfToday) {
      return { label: 'Due today', class: 'badge-urgent' };
    }
    if (diffMs <= 0) {
      return { label: 'Passed', class: 'badge-expired' };
    }

    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return { label: `${mins}m left`, class: 'badge-urgent' };

    const hours = Math.round(mins / 60);
    if (hours < 48) return { label: `${hours}h left`, class: 'badge-soon' };

    const days = Math.round(hours / 24);
    return { label: `${days}d left`, class: 'badge-normal' };
  }

  function render(items) {
    if (!items || items.length === 0) {
      grid.innerHTML = '<div class="empty-state">No pending assignments found 🎉<br><span style="font-size:0.75rem; color:#64748b; margin-top:4px; display:inline-block;">Click "Sync All Courses" to scan all courses.</span></div>';
      countTag.textContent = '0 Due';
      return;
    }

    countTag.textContent = `${items.length} Due`;
    grid.innerHTML = '';

    items.forEach((item) => {
      const dateObj = parseDeadline(item.deadline);
      const diff = computeDiff(dateObj);
      const dateDisplay = dateObj
        ? dateObj.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : (item.deadlineText || 'No Date');

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-header">
          <div class="title-box">
            <div class="assignment-title" title="${item.title}">${item.title}</div>
            <div class="course-name" title="${item.course || ''}">${item.course || 'Unknown Course'}</div>
          </div>
          <span class="badge ${diff.class}">${diff.label}</span>
        </div>
        <div class="card-footer">
          <span class="deadline-time">📅 ${dateDisplay}</span>
          <button class="btn-open" data-link="${item.link || 'https://lms.bahria.edu.pk/Student/Assignments.php'}">Open ↗</button>
        </div>
      `;

      card.querySelector('.btn-open').addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-link');
        chrome.tabs.create({ url });
      });

      grid.appendChild(card);
    });
  }

  function loadStored() {
    chrome.storage.local.get(['assignments'], (data) => {
      const list = Array.isArray(data.assignments) ? data.assignments : [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const pending = list
        .filter((a) => {
          const d = parseDeadline(a.deadline);
          const notExpired = !d || d >= now;
          const notSubmitted = !a.status || !/submitted/i.test(a.status);
          return notExpired && notSubmitted;
        })
        .sort((a, b) => {
          const da = parseDeadline(a.deadline)?.getTime() || Infinity;
          const db = parseDeadline(b.deadline)?.getTime() || Infinity;
          return da - db;
        });

      render(pending);
    });
  }

  loadStored();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.assignments) {
      loadStored();
    }
  });

  // Track progress updates sent from content.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'sync_progress') {
      refreshBtn.disabled = true;
      refreshBtn.textContent = `Scanning (${msg.current}/${msg.total})...`;
      syncStatus.textContent = msg.courseName || `Course ${msg.current}/${msg.total}`;
    } else if (msg.type === 'sync_complete') {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Sync All Courses';
      syncStatus.textContent = `Done (${msg.totalAssignments || 0} found)`;
      loadStored();
    }
  });

  // Automated one-click background sync
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Scanning...';
    syncStatus.textContent = 'Checking LMS...';

    try {
      const tabs = await chrome.tabs.query({ url: '*://lms.bahria.edu.pk/*' });
      if (!tabs || tabs.length === 0) {
        await chrome.tabs.create({ url: 'https://lms.bahria.edu.pk/Student/Assignments.php' });
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Sync All Courses';
        syncStatus.textContent = 'LMS tab opened';
        alert('LMS tab opened. Please log in and click Sync All Courses again.');
        return;
      }

      let lmsTab = tabs.find((t) => /Assignments\.php/i.test(t.url)) || tabs[0];
      if (!/Assignments\.php/i.test(lmsTab.url)) {
        syncStatus.textContent = 'Opening assignments page...';
        await chrome.tabs.update(lmsTab.id, { url: 'https://lms.bahria.edu.pk/Student/Assignments.php' });
        await new Promise((r) => setTimeout(r, 1500));
      }

      syncStatus.textContent = 'Scanning all courses...';
      chrome.tabs.sendMessage(lmsTab.id, { type: 'crawl_all_courses' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = 'Sync All Courses';
          syncStatus.textContent = 'Sync failed';
          alert('Could not start sync: ' + (resp?.error || chrome.runtime.lastError?.message || 'Please reload your LMS tab and try again.'));
        }
      });
    } catch (err) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Sync All Courses';
      syncStatus.textContent = 'Error';
      alert('Error: ' + err.message);
    }
  });

  // Reset button to clear cached assignments
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear all stored assignments?')) {
      chrome.storage.local.set({ assignments: [] }, () => {
        chrome.alarms.clearAll(() => {
          loadStored();
          syncStatus.textContent = 'Cache cleared';
        });
      });
    }
  });
});