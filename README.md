# Event-Driven Notification System

A resilient notification processing system built with Node.js, Express, and Redis Streams.

This version is shaped as an interview-ready backend project: it has an API, a dashboard, background workers, retry handling, idempotency, and a dead-letter queue.

## What This System Does

The system accepts notification requests, queues them as events, processes them asynchronously in a worker, retries failed notifications with exponential backoff, and preserves permanently failed messages in a Dead Letter Queue.

Example use cases:

- send a welcome email after user registration
- send an order shipped notification
- send a password reset notification
- safely retry temporary provider failures
- inspect permanently failed notifications

## Architecture

```text
Dashboard / API
      |
      v
Redis Stream: notifications-stream
      |
      v
Notification Worker
      |
      +--> success: mark as delivered
      |
      +--> failure: schedule retry in Redis Sorted Set
                         |
                         v
                  Retry Worker
                         |
                         v
              re-add event to main stream

After max retries: move to notifications-dlq
```

## Main Components

### API and Dashboard

The HTTP server exposes:

- `POST /api/notifications` - queue a notification
- `GET /api/notifications` - view current notification states
- `GET /api/logs` - view recent pipeline activity
- `GET /api/retry-queue` - inspect scheduled retries
- `GET /api/dlq` - inspect dead-lettered messages
- `POST /api/dlq/:eventId/replay` - replay a DLQ message after fixing the issue
- `GET /api/health` - check service health

`POST /api/notifications` is protected by a Redis-backed rate limiter. By default, each client IP can queue up to 100 notifications per 60 seconds. Requests above the limit are rejected with HTTP `429` before they enter the Redis Stream or call the email provider.

The dashboard runs at:

```text
http://localhost:3000
```

### Producer

Creates notification events and pushes them into Redis Streams.

Each event includes:

- event ID
- event type
- email
- subject
- channel
- retry count
- demo failure mode

### Notification Worker

Consumes events from the Redis Stream and processes them.

It handles:

- idempotency checks
- processing locks
- success status updates
- retry scheduling
- DLQ movement after max retries
- stuck message reclaiming

### Retry Worker

Polls the retry queue and re-adds ready messages back into the main stream.

### Notification Service

This project uses a demo notification provider. From the dashboard you can choose:

- always succeed
- randomly fail
- always fail

That makes retry and DLQ behavior easy to demonstrate during an interview.

## Redis Data Structures

| Name | Type | Purpose |
| --- | --- | --- |
| `notifications-stream` | Stream | Main event stream |
| `notifications-group` | Consumer Group | Worker load sharing |
| `notifications-retry-queue` | Sorted Set | Retry scheduling by timestamp |
| `notifications-dlq` | Stream | Permanently failed messages |
| `notifications-status` | Hash | Current state of each notification |
| `notifications-activity-log` | List | Recent activity for dashboard |
| `rate-limit:notifications:{ip}` | String | Per-IP ingestion API rate limit counter |

## Retry Logic

The system uses exponential backoff:

```text
1st failure -> retry after 1 second
2nd failure -> retry after 2 seconds
3rd failure -> retry after 4 seconds
4th failure -> move to DLQ
```

## Manual DLQ Replay

Dead-lettered notifications can be replayed from the dashboard with the `Replay as Fixed` button.

Replay does the following:

- finds the failed message in `notifications-dlq`
- removes that DLQ stream entry with `XDEL`
- resets `retryCount` to `0`
- changes `failMode` to `success` for demo recovery
- pushes the message back to `notifications-stream`
- updates status to `replayed`
- records an activity log

This models a real operations flow: an engineer fixes the root cause, then manually reprocesses failed messages.

## Run Locally

Prerequisites:

- Node.js 18+
- Redis running locally on `redis://localhost:6379`

Note: if your Redis version does not support `XAUTOCLAIM`, the app still runs. Stuck-message reclaiming is automatically disabled, while normal processing, retries, and DLQ behavior continue to work.

Install dependencies:

```bash
cd server
npm install
```

## Real Email Setup

The project supports real email delivery through Resend.

Without a Resend API key, it automatically runs in demo mode. In demo mode, notification delivery is simulated so you can still test retries, DLQ, and the dashboard.

To enable real email:

1. Create a Resend account.
2. Generate an API key.
3. Create a `.env` file inside the `server` folder:

```env
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=Notification Demo <onboarding@resend.dev>
PORT=3000
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=100
```

For quick testing, Resend allows the default `onboarding@resend.dev` sender. For production-style sending, verify your own domain and replace `FROM_EMAIL`.

When real email is enabled, the dashboard health badge shows:

```text
Email resend
```

When no API key is configured, it shows:

```text
Email demo
```

Start the all-in-one demo:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Run Workers Separately

For a production-like setup, run each process separately.

Terminal 1:

```bash
cd server
npm run worker:notification
```

Terminal 2:

```bash
cd server
npm run worker:retry
```

Terminal 3:

```bash
cd server
npm run producer
```

## Interview Pitch

"I built a resilient event-driven notification processing system using Node.js and Redis Streams. The API queues notification events, background workers process them asynchronously, failed messages are retried with exponential backoff, and permanently failed messages are moved to a Dead Letter Queue. I also added idempotency and processing locks to avoid duplicate work, plus a dashboard to inspect live pipeline state."

## Possible Next Improvements

- integrate a real email provider like Resend, SendGrid, or Nodemailer
- add MongoDB/PostgreSQL for long-term notification history
- add authentication for the dashboard
- add Docker Compose for Redis and the Node server
- add automated tests for retry and DLQ behavior
