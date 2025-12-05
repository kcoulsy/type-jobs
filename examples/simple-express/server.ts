import express from "express";
import exampleJob from "./jobs/example-job.js";
import { setDriver } from "typed-jobs";
import dotenv from "dotenv";

dotenv.config();

import config from "./typed-jobs.config.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize the driver (jobs are lazy, so they won't need it until dispatch/register)
setDriver(config.driver);

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Endpoint to trigger a job
app.get("/jobs/trigger", async (req, res) => {
  console.log("/jobs/trigger endpoint hit");
  try {
    // Dispatch the job
    await exampleJob.dispatch({
      userId: "1234567890",
      message: "Hello, world!",
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      message: "Job dispatched successfully",
      userId: "1234567890",
    });
  } catch (error) {
    console.error("Error dispatching job:", error);
    res.status(500).json({
      error: "Failed to dispatch job",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Endpoint to trigger a delayed job
app.post("/jobs/trigger-delayed", async (req, res) => {
  try {
    const { userId, message, delayMs } = req.body;

    if (!userId || !message) {
      return res.status(400).json({
        error: "Missing required fields: userId and message",
      });
    }

    const delay = delayMs || 5000; // Default 5 seconds

    // Dispatch the job with delay
    await exampleJob.dispatchWithDelay(
      {
        userId,
        message,
        timestamp: Date.now(),
      },
      delay
    );

    res.json({
      success: true,
      message: `Job dispatched successfully with ${delay}ms delay`,
      userId,
      delayMs: delay,
    });
  } catch (error) {
    console.error("Error dispatching delayed job:", error);
    res.status(500).json({
      error: "Failed to dispatch delayed job",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Trigger job: POST http://localhost:${PORT}/jobs/trigger`);
  console.log(
    `Trigger delayed job: POST http://localhost:${PORT}/jobs/trigger-delayed`
  );
});
