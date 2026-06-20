import {
  STREAM_NAME,
  GROUP_NAME,
  DLQ_STREAM,
  RETRY_QUEUE,
  MAX_RETRIES,
} from "../constants/streamConstants.js";
import { calculateBackoff } from "../utils/backoff.js";
import {appendActivityLog,updateNotificationStatus,} from "../services/notificationStore.js";
import { sendNotification } from "../services/notificationService.js";

let autoClaimSupported = true;

async function reclaimStuckMessages(redisClient, consumerName) {
  if (!autoClaimSupported) {
    return [];
  }

  const minIdleTime = 10000;

  try {
    const result = await redisClient.xAutoClaim(
      STREAM_NAME,
      GROUP_NAME,
      consumerName,
      minIdleTime,
      "0-0",
      { COUNT: 10 },
    );

    return result.messages || [];
  } catch (error) {
    if (error.message && error.message.includes("unknown command")) {
      autoClaimSupported = false;
      console.log("XAUTOCLAIM is not supported by this Redis version; stuck-message reclaim is disabled.");
      return [];
    }

    throw error;
  }
}

async function scheduleRetryOrDlq(redisClient, message, error) {
  const data = message.message;
  const retryCount = Number.parseInt(data.retryCount || "0", 10);
  const attempts = retryCount + 1;

  if (retryCount < MAX_RETRIES) {
    const delay = calculateBackoff(retryCount);
    const retryAt = Date.now() + delay;
    const updatedData = {
      ...data,
      retryCount: String(attempts),
      retryAt: String(retryAt),
      lastError: error.message,
    };

    await redisClient.zAdd(RETRY_QUEUE, {
      score: retryAt,
      value: JSON.stringify(updatedData),
    });

    await updateNotificationStatus(redisClient, data.eventId, {
      ...updatedData,
      status: "retry_scheduled",
      attempts,
      nextRetryAt: retryAt,
      updatedAt: Date.now(),
    });

    await appendActivityLog(redisClient, {
      eventId: data.eventId,
      streamId: message.id,
      status: "retry_scheduled",
      message: `Retry ${attempts} scheduled in ${delay}ms: ${error.message}`,
    });

    console.log(`Retry scheduled in ${delay}ms for ${data.eventId}`);
    return;
  }

  await redisClient.xAdd(DLQ_STREAM, "*", {
    ...data,
    lastError: error.message,
    failedAt: Date.now().toString(),
  });

  await updateNotificationStatus(redisClient, data.eventId, {
    ...data,
    status: "dead_lettered",
    attempts,
    lastError: error.message,
    updatedAt: Date.now(),
  });

  await appendActivityLog(redisClient, {
    eventId: data.eventId,
    streamId: message.id,
    status: "dead_lettered",
    message: `Moved to DLQ after ${attempts} attempts: ${error.message}`,
  });

  console.log(`Moved to DLQ: ${data.eventId}`);
}

async function processMessage(redisClient, message, source = "new") {
  const data = message.message;
  const processedKey = `processed:${data.eventId}`;
  const processingKey = `processing:${data.eventId}`;

  const alreadyProcessed = await redisClient.exists(processedKey);
  if (alreadyProcessed) {
    await appendActivityLog(redisClient, {
      eventId: data.eventId,
      streamId: message.id,
      status: "duplicate_skipped",
      message: "Duplicate event skipped because it was already processed",
    });
    await redisClient.xAck(STREAM_NAME, GROUP_NAME, message.id);
    return;
  }

  const lockAcquired = await redisClient.set(processingKey, "1", {NX: true,EX: 86400,});

  if (!lockAcquired) {
    await appendActivityLog(redisClient, {
      eventId: data.eventId,
      streamId: message.id,
      status: "duplicate_skipped",
      message: "Duplicate event skipped because another worker holds the lock",
    });
    await redisClient.xAck(STREAM_NAME, GROUP_NAME, message.id);
    return;
  }

  try {
    await updateNotificationStatus(redisClient, data.eventId, {
      ...data,
      status: "processing",
      attempts: Number.parseInt(data.retryCount || "0", 10) + 1,
      updatedAt: Date.now(),
    });

    await appendActivityLog(redisClient, {
      eventId: data.eventId,
      streamId: message.id,
      status: "processing",
      message: `Worker processing ${source} message for ${data.email}`,
    });

    const result = await sendNotification(data);

    await redisClient.set(processedKey, "1", { EX: 86400 });
    await updateNotificationStatus(redisClient, data.eventId, {
      ...data,
      status: "delivered",
      attempts: Number.parseInt(data.retryCount || "0", 10) + 1,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      deliveredAt: Date.now(),
      updatedAt: Date.now(),
    });

    await appendActivityLog(redisClient, {
      eventId: data.eventId,
      streamId: message.id,
      status: "delivered",
      message: `Notification delivered to ${data.email}`,
    });

    await redisClient.xAck(STREAM_NAME, GROUP_NAME, message.id);
    console.log(`Message acknowledged: ${message.id}`);
  } catch (error) {
    await scheduleRetryOrDlq(redisClient, message, error);
    await redisClient.xAck(STREAM_NAME, GROUP_NAME, message.id);
  } finally {
    await redisClient.del(processingKey);
  }
}

export async function notificationWorker(redisClient) {
  const consumerName = process.env.CONSUMER_NAME || "Worker-1";
  console.log(`Notification worker started as ${consumerName}`);

  while (true) {
    try {
      const reclaimedMessages = await reclaimStuckMessages(redisClient, consumerName);
      for (const message of reclaimedMessages) {
        await processMessage(redisClient, message, "reclaimed");
      }

      const response = await redisClient.xReadGroup(
        GROUP_NAME,
        consumerName,
        {
          key: STREAM_NAME,
          id: ">",
        },
        {
          COUNT: 1,
          BLOCK: 5000,
        },
      );

      if (!response) continue;

      for (const stream of response) {
        for (const message of stream.messages) {
          await processMessage(redisClient, message);
        }
      }
    } catch (systemError) {
      console.error("Worker system error:", systemError);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
