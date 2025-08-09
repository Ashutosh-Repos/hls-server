import { Queue } from "bullmq";
import { redis } from "./redis";
// Create and export the BullMQ queue for video processing
export const videoQueue = new Queue("video-processing", {
  connection: redis,
});
