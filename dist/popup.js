/* global chrome */

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('assignments-grid');
  const refreshBtn = document.getElementById('refresh-btn');
  const clearBtn = document.getElementById('clear-btn');
  const countTag = document.getElementById('assignment-count');
  const syncStatus = document.getElementById('sync-status');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

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
            <div class="assignment-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            <div class="course-name" title="${escapeHtml(item.course || '')}">${escapeHtml(item.course || 'Unknown Course')}</div>
          </div>
          <span class="badge ${diff.class}">${diff.label}</span>
        </div>
        <div class="card-footer">
          <span class="deadline-time">📅 ${escapeHtml(dateDisplay)}</span>
          <button class="btn-open" data-link="${escapeHtml(item.link || 'https://lms.bahria.edu.pk/Student/Assignments.php')}">Open ↗</button>
        </div>
      `;

      card.querySelector('.btn-open').addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-link');
        chrome.tabs.create({ url });
      });

      if (item.downloads?.length) {
        const actions = document.createElement('div');
        actions.className = 'download-actions';
        item.downloads.forEach((file, index) => {
          const button = document.createElement('button');
          button.className = 'btn-open';
          button.textContent = item.downloads.length > 1 ? `Download file ${index + 1}` : 'Download assignment';
          button.title = file.filename || 'Assignment file';
          button.addEventListener('click', async () => {
            button.disabled = true;
            const label = button.textContent;
            button.textContent = 'Downloading…';
            syncStatus.textContent = 'Fetching assignment file…';
            try {
              const result = await chrome.runtime.sendMessage({ type: 'download_assignment', title: item.title, course: item.course, link: item.link, url: file.url });
              if (!result?.ok) throw new Error(result?.error || 'Download failed.');
              syncStatus.textContent = 'Download started';
            } catch (error) {
              syncStatus.textContent = 'Download failed';
              alert(error.message);
            } finally { button.disabled = false; button.textContent = label; }
          });
          actions.appendChild(button);
        });
        card.appendChild(actions);
      } else if (!item.downloads) {
        const hint = document.createElement('div');
        hint.className = 'download-hint';
        hint.textContent = 'Sync All Courses to load download links.';
        card.appendChild(hint);
      }

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
      const result = await chrome.runtime.sendMessage({ type: 'sync_assignments' });
      if (!result?.ok) throw new Error(result?.error || 'Could not sync assignments.');
      syncStatus.textContent = `Done (${result.count || 0} found)`;
      loadStored();
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Sync All Courses';
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