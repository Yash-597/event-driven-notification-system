const WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100);

function getClientIp(req) {
  if (req.ip) {
    return req.ip;
  }

  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

export async function checkRateLimit(redisClient, req) {
  const ip = getClientIp(req);
  const key = `rate-limit:notifications:${ip}`;
  const count = await redisClient.incr(key);

  if (count === 1) {
    await redisClient.expire(key, WINDOW_SECONDS);
  }

  const ttl = await redisClient.ttl(key);

  return {
    allowed: count <= MAX_REQUESTS,
    count,
    limit: MAX_REQUESTS,
    retryAfter: Math.max(ttl, 1),
    windowSeconds: WINDOW_SECONDS,
  };
}
