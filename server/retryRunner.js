import "dotenv/config";
import redisClient, { connectRedis } from "./config/redis.js";
import { initStream } from "./setup/initStream.js";
import { retryWorker } from "./workers/retryWorker.js";

async function start() {
  await connectRedis();
  await initStream(redisClient);
  await retryWorker(redisClient);
}

start();
