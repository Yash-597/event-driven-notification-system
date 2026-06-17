import { STREAM_NAME, GROUP_NAME } from "../constants/streamConstants.js";

export async function initStream(redisClient) {
  try {
    await redisClient.xGroupCreate(STREAM_NAME, GROUP_NAME, "0", {
      MKSTREAM: true,
    });

    console.log("Consumer group created");
  } catch (err) {
    if (err.message.includes("BUSYGROUP")) {
      console.log("Consumer group already exists");
    } else {
      throw err;
    }
  }
}
