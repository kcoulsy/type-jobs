import { defineConfig } from "typed-jobs";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  driver: {
    type: "redis",
    redis: {
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      username: process.env.REDIS_USERNAME,
      tls: process.env.REDIS_TLS === "true",
    },
  },
  jobsDir: "./jobs",
});
