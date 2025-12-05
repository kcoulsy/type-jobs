# Simple Express Example

This example demonstrates how to use `typed-jobs` with an Express server.

## Setup

1. Install dependencies:
```bash
npm install
```

2. **Make sure Redis is running** (default: localhost:6379)

   If you don't have Redis installed:
   - **Windows**: Download from [redis.io](https://redis.io/download) or use WSL
   - **macOS**: `brew install redis` then `brew services start redis`
   - **Linux**: `sudo apt-get install redis-server` (Ubuntu/Debian) or use your package manager
   - **Docker**: `docker run -d -p 6379:6379 redis:latest`

   Verify Redis is running:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

## Running

### Terminal 1: Start the Worker
```bash
npm run worker
```

This will start the worker process that processes jobs from the queue.

### Terminal 2: Start the Express Server
```bash
npm run dev
```

The server will start on http://localhost:3000

## Usage

### Trigger a Job

```bash
curl -X POST http://localhost:3000/jobs/trigger \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "message": "Hello from API!"}'
```

### Trigger a Delayed Job

```bash
curl -X POST http://localhost:3000/jobs/trigger-delayed \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "message": "Delayed message", "delayMs": 5000}'
```

### Health Check

```bash
curl http://localhost:3000/health
```

## Project Structure

```
simple-express/
├── jobs/
│   └── example-job.ts    # Job definition
├── server.ts             # Express server with job dispatch endpoints
├── typed-jobs.config.ts  # typed-jobs configuration
└── package.json
```

## How It Works

1. The Express server (`server.ts`) initializes the driver and exposes endpoints to dispatch jobs
2. Jobs are defined in the `jobs/` directory
3. The worker process (`npm run worker` or `typed-jobs run`) discovers and registers all jobs from the `jobs/` directory
4. When you call the `/jobs/trigger` endpoint, it dispatches a job to the queue
5. The worker picks up the job and processes it

