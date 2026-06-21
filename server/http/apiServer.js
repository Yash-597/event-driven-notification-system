import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { checkRateLimit } from "../middleware/rateLimiter.js";
import { publishNotificationEvent } from "../producer/producer.js";
import {
  listActivityLogs,
  listDlq,
  listNotificationStatuses,
  listRetryQueue,
  replayDlqMessage,
} from "../services/notificationStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function startApiServer(redisClient, port = 3000) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      redis: redisClient.isReady ? "connected" : "not-ready",
      emailProvider: process.env.RESEND_API_KEY ? "resend" : "demo",
    });
  });

  app.post("/api/notifications",asyncRoute(async (req, res) => {
      const rateLimit = await checkRateLimit(redisClient, req);

      res.set("X-RateLimit-Limit", String(rateLimit.limit));
      res.set(
        "X-RateLimit-Remaining",
        String(Math.max(rateLimit.limit - rateLimit.count, 0)),
      );
      res.set("X-RateLimit-Reset", String(rateLimit.retryAfter));

      if (!rateLimit.allowed) {
        res.set("Retry-After", String(rateLimit.retryAfter));
        res.status(429).json({
          error: "Too many notification requests. Please try again later.",
          limit: rateLimit.limit,
          windowSeconds: rateLimit.windowSeconds,
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }

      const body = req.body || {};
      if (!body.email || !body.email.includes("@")) {
        res.status(400).json({ error: "A valid email is required" });
        return;
      }

      const result = await publishNotificationEvent(redisClient, body);
      res.status(201).json(result);
    }),
  );

  app.get("/api/notifications", asyncRoute(async (req, res) => {
      res.status(200).json(await listNotificationStatuses(redisClient));
    }),
  );

  app.get("/api/logs", asyncRoute(async (req, res) => {
      res.status(200).json(await listActivityLogs(redisClient));
    }),
  );

  app.get("/api/retry-queue", asyncRoute(async (req, res) => {
      res.status(200).json(await listRetryQueue(redisClient));
    }),
  );

  app.get("/api/dlq", asyncRoute(async (req, res) => {
      res.status(200).json(await listDlq(redisClient));
    }),
  );

  app.post("/api/dlq/:eventId/replay", asyncRoute(async (req, res) => {
      const result = await replayDlqMessage(redisClient, req.params.eventId);

      if (!result) {
        res.status(404).json({ error: "DLQ message not found" });
        return;
      }

      res.status(200).json(result);
    }),
  );

  app.use(express.static(publicDir));

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  app.use((error, req, res, next) => {
    console.error("API error:", error);

    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
      return;
    }

    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      res.status(400).json({ error: "Invalid JSON request body" });
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  });

  const server = app.listen(port, () => {
    console.log(`Dashboard and API running at http://localhost:${port}`);
  });

  return server;
}
