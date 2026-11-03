if (!globalThis.__bahriaAssignmentTracker) {
globalThis.__bahriaAssignmentTracker = true;
/* global chrome */

function parseTableRows(rows, courseName, pageUrl) {
  const data = [];
  for (const r of rows) {
    const cols = r.querySelectorAll('td');
    if (!cols || cols.length < 2) continue;

    const title = cols[1]?.textContent?.trim();
    if (!title) continue;

    const lastCol = cols[cols.length - 1];
    let deadlineText = lastCol?.textContent?.trim() || '';

    const extendedLabel = lastCol?.querySelector('.label-warning');
    const actualLabel = lastCol?.querySelector('.label-info');

    if (extendedLabel) {
      deadlineText = (extendedLabel.textContent || '').trim();
    } else if (actualLabel) {
      deadlineText = (actualLabel.textContent || '').trim();
    } else {
      let lines = deadlineText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 1) {
        const monthRegex =
          /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
        const candidate = lines.find((l) => monthRegex.test(l)) || lines[0];
        deadlineText = candidate;
      } else if (lines.length === 1) {
        deadlineText = lines[0];
      } else {
        deadlineText = '';
      }
    }

    deadlineText = deadlineText
      .replace(/\s+-\s+/g, ' ')
      .replace(/\u2013|\u2014/g, ' ')
      .replace(/-/g, ' ');

    let deadline = null;
    if (deadlineText) {
      const tryDate = Date.parse(deadlineText);
      if (!isNaN(tryDate)) {
        deadline = new Date(tryDate);
      } else {
        const isoMatch = deadlineText.match(/\d{1,2}\s+\w+\s+\d{4}.*$/);
        const pick = isoMatch ? isoMatch[0] : deadlineText;
        const parsed = Date.parse(pick);
        if (!isNaN(parsed)) {
          deadline = new Date(parsed);
        }
      }
    }

    // Submission check from Column 3
    const submissionCol = cols[3]?.innerHTML || '';
    const noSubmission = /no\s+submission/i.test(submissionCol);
    const hasSubmission = /<a[^>]*>[\s\S]*?Submission[\s\S]*?<\/a>/i.test(submissionCol);
    const isSubmitted = hasSubmission && !noSubmission;

    if (isSubmitted) {
      continue;
    }

    data.push({
      title,
      course: courseName,
      deadlineText: deadlineText || null,
      deadline: deadline ? deadline.toISOString() : null,
      link: pageUrl,
      status: submissionCol,
    });
  }
  return data;
}

// Scrape currently visible DOM
function scrapeCurrentPage() {
  const select =
    document.querySelector('#courseId') ||
    document.querySelector('#course') ||
    document.querySelector("select[name='courseName']") ||
    (document.querySelectorAll('select').length >= 2 ? document.querySelectorAll('select')[1] : null);

  const courseName = select?.selectedOptions?.[0]?.textContent?.trim() || '';
  const rows = Array.from(document.querySelectorAll('table tr'));
  return parseTableRows(rows, courseName, location.href);
}

// Fast multi-course crawl via background fetch (No tab reloads!)
async function crawlAllCourses() {
  const assignmentUrl = new URL('/Student/Assignments.php', location.origin);
  const response = await fetch(assignmentUrl, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load assignments. Please try again.');
  const assignmentDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const select = assignmentDoc.querySelector('#courseId') ||
    assignmentDoc.querySelector('#course') ||
    assignmentDoc.querySelector("select[name='courseName']") ||
    (assignmentDoc.querySelectorAll('select').length >= 2 ? assignmentDoc.querySelectorAll('select')[1] : null);

  if (!select) {
    throw new Error('No course list found. Please log in to LMS and try again.');
  }

  const options = Array.from(select.options)
    .map((o) => ({ value: o.value, label: o.textContent?.trim() }))
    .filter((o) => o.value && o.value !== '' && !/select\s*course/i.test(o.label));

  if (options.length === 0) {
    throw new Error('No courses found in dropdown.');
  }

  const parser = new DOMParser();
  const allAssignments = [];
  const currentUrl = assignmentUrl;

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];

    chrome.runtime
      .sendMessage({
        type: 'sync_progress',
        current: i + 1,
        total: options.length,
        courseName: opt.label,
      })
      .catch(() => {});

    try {
      const targetUrl = new URL(currentUrl);
      targetUrl.searchParams.set('oc', opt.value);

      const resp = await fetch(targetUrl.toString(), { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('Could not load ' + opt.label);
      {
        const html = await resp.text();
        const doc = parser.parseFromString(html, 'text/html');
        if (!doc.querySelector('select')) throw new Error('LMS session expired. Please log in again.');
        const rows = Array.from(doc.querySelectorAll('table tr'));
        const items = parseTableRows(rows, opt.label, targetUrl.toString());
        allAssignments.push(...items);
      }
    } catch (err) {
      throw new Error('Sync stopped for ' + opt.label + ': ' + err.message);
    }
  }

  // Deduplicate by title + deadline
  const map = new Map();
  for (const a of allAssignments) {
    const id = `${(a.title || '').trim().toLowerCase()}||${(a.deadline || '').trim().toLowerCase()}`;
    map.set(id, a);
  }
  const unique = Array.from(map.values());

  await new Promise((res) => chrome.storage.local.set({ assignments: unique }, res));

  chrome.runtime
    .sendMessage({
      type: 'sync_complete',
      totalAssignments: unique.length,
    })
    .catch(() => {});

  return unique;
}

// One listener per document, including when injected into a pre-existing tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'tracker_ping') { sendResponse({ ok: true }); return; }
  if (msg?.type === 'crawl_all_courses') {
    crawlAllCourses()
      .then(items => sendResponse({ ok: true, count: items.length }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
chrome.runtime.sendMessage({ type: 'auto_sync_lms' }).catch(() => {});

}
