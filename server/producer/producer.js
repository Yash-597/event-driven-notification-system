import { randomUUID } from "crypto";
import { STREAM_NAME } from "../constants/streamConstants.js";
import { appendActivityLog, updateNotificationStatus } from "../services/notificationStore.js";

export async function publishNotificationEvent(redisClient, payload = {}) {
  const event = {
    eventId: payload.eventId || randomUUID(),
    eventType: payload.eventType || "USER_REGISTERED",
    email: payload.email || "test@example.com",
    subject: payload.subject || "Welcome notification",
    channel: payload.channel || "email",
    failMode: payload.failMode || "random",
    retryCount: "0",
    createdAt: Date.now().toString(),
  };

  const id = await redisClient.xAdd(STREAM_NAME, "*", event);

  await updateNotificationStatus(redisClient, event.eventId, {
    ...event,
    streamId: id,
    status: "queued",
    attempts: 0,
    updatedAt: Date.now(),
  });

  await appendActivityLog(redisClient, {
    eventId: event.eventId,
    streamId: id,
    status: "queued",
    message: `Notification queued for ${event.email}`,
  });

  console.log("Test event published:", id);
  return { streamId: id, event };
}

export async function publishTestEvent(redisClient) {
  return publishNotificationEvent(redisClient);
}
