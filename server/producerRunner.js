import "dotenv/config";
import redisClient, { connectRedis } from "./config/redis.js";
import { publishTestEvent } from "./producer/producer.js";

async function start() {
  await connectRedis();
  await publishTestEvent(redisClient);
  process.exit(0);
}

start();
