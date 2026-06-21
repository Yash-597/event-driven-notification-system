import { STREAM_NAME, RETRY_QUEUE } from "../constants/streamConstants.js";
import {
  appendActivityLog,
  updateNotificationStatus,
} from "../services/notificationStore.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWorker(redisClient) {
  console.log("Retry worker started");

  while (true) {
    try {
      const now = Date.now();
      const readyMessages = await redisClient.zRangeByScore(RETRY_QUEUE, 0, now, {
        LIMIT: { offset: 0, count: 10 },
      });

      for (const raw of readyMessages) {
        const removed = await redisClient.zRem(RETRY_QUEUE, raw);

        if (removed === 1) {
          const message = JSON.parse(raw);
          const streamId = await redisClient.xAdd(STREAM_NAME, "*", message);

          await updateNotificationStatus(redisClient, message.eventId, {
            ...message,
            streamId,
            status: "requeued",
            updatedAt: Date.now(),
          });

          await appendActivityLog(redisClient, {
            eventId: message.eventId,
            streamId,
            status: "requeued",
            message: "Retry worker re-added message to the main stream",
          });

          console.log(`Re-added retry message: ${message.eventId}`);
        }
      }

      await sleep(500);
    } catch (error) {
      console.error("Retry worker error:", error);
      await sleep(1000);
    }
  }
}
