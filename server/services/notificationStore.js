import {
  ACTIVITY_LOG,
  DLQ_STREAM,
  RETRY_QUEUE,
  STATUS_HASH,
  STREAM_NAME,
} from "../constants/streamConstants.js";

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function updateNotificationStatus(redisClient, eventId, updates) {
  const existingRaw = await redisClient.hGet(STATUS_HASH, eventId);
  const existing = existingRaw ? safeParse(existingRaw) || {} : {};
  const next = {
    ...existing,
    ...updates,
    eventId,
    updatedAt: updates.updatedAt || Date.now(),
  };

  await redisClient.hSet(STATUS_HASH, eventId, JSON.stringify(next));
  return next;
}

export async function appendActivityLog(redisClient, entry) {
  const log = {
    ...entry,
    timestamp: Date.now(),
  };

  await redisClient.rPush(ACTIVITY_LOG, JSON.stringify(log));
  await redisClient.lTrim(ACTIVITY_LOG, -200, -1);
  return log;
}

export async function listNotificationStatuses(redisClient) {
  const values = await redisClient.hVals(STATUS_HASH);
  return values
    .map(safeParse)
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function listActivityLogs(redisClient) {
  const values = await redisClient.lRange(ACTIVITY_LOG, -100, -1);
  return values
    .map(safeParse)
    .filter(Boolean)
    .reverse();
}

export async function listRetryQueue(redisClient) {
  const values = await redisClient.zRange(RETRY_QUEUE, 0, -1);
  return values
    .map(safeParse)
    .filter(Boolean)
    .sort((a, b) => Number(a.retryAt || 0) - Number(b.retryAt || 0));
}

export async function listDlq(redisClient) {
  try {
    const messages = await redisClient.xRange(DLQ_STREAM, "-", "+", {
      COUNT: 50,
    });

    return messages.map((message) => ({
      id: message.id,
      ...message.message,
    }));
  } catch (error) {
    if (error.message && error.message.includes("no such key")) {
      return [];
    }
    return [];
  }
}

export async function replayDlqMessage(redisClient, eventId) {
  const messages = await listDlq(redisClient);
  const dlqMessage = messages.find((message) => message.eventId === eventId);

  if (!dlqMessage) {
    return null;
  }

  const replayEvent = {
    eventId: dlqMessage.eventId,
    eventType: dlqMessage.eventType,
    email: dlqMessage.email,
    subject: dlqMessage.subject || "Replayed notification",
    channel: dlqMessage.channel || "email",
    failMode: "success",
    retryCount: "0",
    createdAt: dlqMessage.createdAt || Date.now().toString(),
    replayedAt: Date.now().toString(),
    replayedFromDlqId: dlqMessage.id,
  };

  const streamId = await redisClient.xAdd(STREAM_NAME, "*", replayEvent);
  await redisClient.xDel(DLQ_STREAM, dlqMessage.id);

  await updateNotificationStatus(redisClient, eventId, {
    ...replayEvent,
    streamId,
    status: "replayed",
    attempts: 0,
    lastError: "",
    nextRetryAt: "",
    updatedAt: Date.now(),
  });

  await appendActivityLog(redisClient, {
    eventId,
    streamId,
    status: "replayed",
    message: `DLQ message replayed as fixed for ${replayEvent.email}`,
  });

  return {
    streamId,
    event: replayEvent,
    removedDlqId: dlqMessage.id,
  };
}
