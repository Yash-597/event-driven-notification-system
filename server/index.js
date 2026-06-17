import "dotenv/config";
import redisClient from "./config/redis.js";
import { connectRedis } from "./config/redis.js";
import { initStream } from "./setup/initStream.js";
import { notificationWorker } from "./workers/notificationWorker.js";
import { retryWorker } from "./workers/retryWorker.js";
import { startApiServer } from "./http/apiServer.js";

async function startServer() {
  await connectRedis();
  await initStream(redisClient);

  startApiServer(redisClient, Number(process.env.PORT || 3000));

  const notificationClient = redisClient.duplicate();
  const retryClient = redisClient.duplicate();

  await notificationClient.connect();
  await retryClient.connect();

  notificationWorker(notificationClient).catch((error) => {
    console.error("Notification worker stopped:", error);
  });

  retryWorker(retryClient).catch((error) => {
    console.error("Retry worker stopped:", error);
  });
}

startServer();
