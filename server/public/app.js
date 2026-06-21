const form = document.querySelector("#notification-form");
const health = document.querySelector("#health");
const notificationsBody = document.querySelector("#notifications");
const logsList = document.querySelector("#logs");
const retryQueue = document.querySelector("#retry-queue");
const dlq = document.querySelector("#dlq");

const countTotal = document.querySelector("#count-total");
const countDelivered = document.querySelector("#count-delivered");
const countRetry = document.querySelector("#count-retry");
const countDlq = document.querySelector("#count-dlq");

function formatTime(value) {
  if (!value) return "-";
  return new Date(Number(value)).toLocaleTimeString();
}

function badge(status) {
  return `<span class="badge ${status}">${String(status || "unknown").replaceAll("_", " ")}</span>`;
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function renderNotifications(items) {
  notificationsBody.innerHTML =
    items
      .map(
        (item) => `
          <tr>
            <td>${badge(item.status)}</td>
            <td>${item.email || "-"}</td>
            <td>${item.eventType || "-"}</td>
            <td>${item.attempts || 0}</td>
            <td>${formatTime(item.updatedAt)}</td>
          </tr>
        `,
      )
      .join("") ||
    `<tr><td colspan="5" class="muted">No notifications yet.</td></tr>`;
}

function renderLogs(items) {
  logsList.innerHTML =
    items
      .map(
        (item) => `
          <li>
            <strong>${item.message}</strong>
            <span>${item.status} - ${formatTime(item.timestamp)}</span>
          </li>
        `,
      )
      .join("") || `<li class="empty">No activity yet.</li>`;
}

function renderStack(target, items, emptyText, options = {}) {
  target.innerHTML =
    items
      .map(
        (item) => `
          <div class="stack-item">
            <strong>${item.email || item.eventId}</strong>
            <span>${item.eventType || "-"} - attempt ${item.retryCount || item.attempts || 0}</span>
            <span>${item.lastError || "Waiting for worker"}</span>
            ${
              options.replay
                ? `<button class="small-button" data-replay-event-id="${item.eventId}">Replay as Fixed</button>`
                : ""
            }
          </div>
        `,
      )
      .join("") || `<p class="empty">${emptyText}</p>`;
}

async function refresh() {
  try {
    const [healthData, notifications, logs, retries, dlqItems] = await Promise.all([
      getJson("/api/health"),
      getJson("/api/notifications"),
      getJson("/api/logs"),
      getJson("/api/retry-queue"),
      getJson("/api/dlq"),
    ]);

    health.textContent = `Redis ${healthData.redis} - Email ${healthData.emailProvider}`;
    renderNotifications(notifications);
    renderLogs(logs);
    renderStack(retryQueue, retries, "No scheduled retries.");
    renderStack(dlq, dlqItems, "No dead-lettered messages.", { replay: true });

    countTotal.textContent = notifications.length;
    countDelivered.textContent = notifications.filter((item) => item.status === "delivered").length;
    countRetry.textContent = retries.length;
    countDlq.textContent = dlqItems.length;
  } catch (error) {
    health.textContent = error.message;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  const response = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    alert(error.error || "Could not queue notification");
    return;
  }

  await refresh();
});

dlq.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-replay-event-id]");
  if (!button) return;

  button.disabled = true;
  button.textContent = "Replaying...";

  const eventId = button.dataset.replayEventId;
  const response = await fetch(`/api/dlq/${encodeURIComponent(eventId)}/replay`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    alert(error.error || "Could not replay DLQ message");
  }

  await refresh();
});

refresh();
setInterval(refresh, 1500);
