import "dotenv/config";
import redisClient, { connectRedis } from "./config/redis.js";
import { initStream } from "./setup/initStream.js";
import { notificationWorker } from "./workers/notificationWorker.js";

async function start() {
  await connectRedis();
  await initStream(redisClient);
  await notificationWorker(redisClient);
}

start();
