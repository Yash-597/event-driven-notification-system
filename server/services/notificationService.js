export async function sendNotification(data) {
  if (process.env.RESEND_API_KEY) {
    return sendRealEmail(data);
  }

  await new Promise((resolve) => setTimeout(resolve, 250));

  if (data.failMode === "always") {
    throw new Error("Demo provider rejected this notification");
  }

  if (data.failMode === "random" && Math.random() < 0.3) {
    throw new Error("Demo provider had a temporary failure");
  }

  return {
    provider: "demo-email-provider",
    providerMessageId: `demo-${Date.now()}`,
  };
}

async function sendRealEmail(data) {
  if (data.failMode === "always") {
    throw new Error("Demo failure requested before calling email provider");
  }

  if (data.failMode === "random" && Math.random() < 0.3) {
    throw new Error("Demo temporary failure before calling email provider");
  }

  const fromEmail = process.env.FROM_EMAIL || "Notification Demo <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [data.email],
      subject: data.subject || "Notification from event-driven system",
      html: buildEmailHtml(data),
      text: buildEmailText(data),
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = result.message || result.error || "Email provider request failed";
    throw new Error(message);
  }

  return {
    provider: "resend",
    providerMessageId: result.id,
  };
}

function buildEmailHtml(data) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #18212f;">
      <h2>${escapeHtml(data.eventType || "Notification")}</h2>
      <p>${escapeHtml(data.subject || "You have a new notification.")}</p>
      <p><strong>Channel:</strong> ${escapeHtml(data.channel || "email")}</p>
      <p><strong>Event ID:</strong> ${escapeHtml(data.eventId || "-")}</p>
      <hr />
      <p style="color: #657084; font-size: 13px;">
        Sent by the Event-Driven Notification System demo.
      </p>
    </div>
  `;
}

function buildEmailText(data) {
  return [
    data.eventType || "Notification",
    "",
    data.subject || "You have a new notification.",
    `Channel: ${data.channel || "email"}`,
    `Event ID: ${data.eventId || "-"}`,
    "",
    "Sent by the Event-Driven Notification System demo.",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
