import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import path from "path";
import fs from "node:fs/promises";
import fsSync from "fs";
import Busboy from "busboy";
import { redis } from "./redis"; // Your ioredis instance
import { videoQueue } from "./queue"; // Your BullMQ queue instance
import { Readable } from "stream";

export const app = express();

app.use(cors({ credentials: true, origin: true }));

app.post("/process", async (req, res) => {
  // Check Redis connection
  if (!redis || redis.status !== "ready") {
    try {
      await redis.connect();
    } catch (err: unknown) {
      console.error("Redis connect error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Redis connection failed" });
    }
  }

  // Generate unique IDs and path structure
  const folderUUID = randomUUID();
  const date = new Date().toISOString().replace(/[:.-]/g, "");
  const videoId = `${folderUUID}_${date}`;

  const uploadDir = path.join("/tmp", videoId, "out");
  const inputDir = path.join("/tmp", videoId, "in");

  // Create directories for input and output
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(inputDir, { recursive: true });
  } catch (err: unknown) {
    console.error("Directory creation error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to prepare upload directories" });
  }

  let fileSavedPath: string | null = null;
  let originalFilename: string | null = null;

  const ALLOWED_VIDEO_TYPES = [
    "video/mp4",
    "video/mkv",
    "video/webm",
    "video/avi",
  ];
  const allowedExtensions = [".mp4", ".mkv", ".webm", ".avi"];

  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const busboy = Busboy({ headers: req.headers });

      busboy.on(
        "file",
        (
          name: string,
          fileStream: Readable,
          info: {
            filename: string;
            encoding: string;
            mimeType: string;
          }
        ) => {
          const { filename, encoding, mimeType } = info;
          if (done) {
            console.warn(
              "File event called but processing is done; resuming stream"
            );
            fileStream.resume();
            return;
          }

          if (name !== "file") {
            console.warn(`Ignored file field: ${name}`);
            fileStream.resume();
            return;
          }

          if (!filename || typeof filename !== "string") {
            done = true;
            const errMsg = "Uploaded file missing or invalid filename.";
            console.error(errMsg);
            reject(new Error(errMsg));
            fileStream.resume();
            return;
          }

          originalFilename = filename;
          const fileExt = path.extname(filename).toLowerCase();
          const isValidMimeType = ALLOWED_VIDEO_TYPES.includes(mimeType);
          const isValidExtension = allowedExtensions.includes(fileExt);

          if (!isValidMimeType && !isValidExtension) {
            done = true;
            const errMsg = "Invalid file type. Allowed: mp4, mkv, webm, avi.";
            console.error(errMsg);
            reject(new Error(errMsg));
            fileStream.resume();
            return;
          }

          const uniqueFilename = `${path.basename(
            filename,
            fileExt
          )}-${randomUUID()}${fileExt}`;
          fileSavedPath = path.join(inputDir, uniqueFilename);

          const writeStream = fsSync.createWriteStream(fileSavedPath);

          fileStream.pipe(writeStream);

          writeStream.on("error", (err: unknown) => {
            if (!done) {
              done = true;
              console.error("Write stream error:", err);
              reject(
                err instanceof Error ? err : new Error("Unknown write error")
              );
            }
          });
          fileStream.on("error", (err: unknown) => {
            if (!done) {
              done = true;
              console.error("File stream error:", err);
              reject(
                err instanceof Error ? err : new Error("Unknown read error")
              );
            }
          });
          writeStream.on("close", () => {
            if (!done) {
              done = true;
              resolve();
            }
          });
        }
      );

      busboy.on("error", (err: unknown) => {
        if (!done) {
          done = true;
          console.error("Busboy error:", err);
          reject(
            err instanceof Error ? err : new Error("Unknown busboy error")
          );
        }
      });

      busboy.on("finish", () => {
        if (!done && !fileSavedPath) {
          done = true;
          console.error("No file uploaded with field name 'file'.");
          reject(new Error("No file uploaded with field name 'file'."));
        }
      });

      req.pipe(busboy);
    });
  } catch (err: unknown) {
    console.error("Upload error:", err);
    if (fileSavedPath) {
      try {
        await fs.unlink(fileSavedPath);
      } catch {}
    }
    return res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : "File upload failed",
    });
  }

  if (!fileSavedPath || !originalFilename) {
    console.error("No valid file saved or original filename missing");
    return res
      .status(400)
      .json({ success: false, error: "No valid file was saved" });
  }

  try {
    await redis.hset(`video:${videoId}`, {
      status: "queued",
      progress: "0",
      error: "",
      createdAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error("Redis status update error:", err);
    if (fileSavedPath) {
      await fs.unlink(fileSavedPath).catch(() => {});
    }
    return res
      .status(500)
      .json({ success: false, error: "Failed to set video status" });
  }

  try {
    await videoQueue.add(
      "video-processing",
      {
        videoId,
        inputFilePath: fileSavedPath,
        uploadDir,
        inputDir,
        originalName: originalFilename,
      },
      { attempts: 1, backoff: 0, removeOnComplete: true, removeOnFail: true }
    );
  } catch (err: unknown) {
    console.error("Queue add error:", err);
    if (fileSavedPath) {
      await fs.unlink(fileSavedPath).catch(() => {});
    }
    return res
      .status(500)
      .json({ success: false, error: "Failed to enqueue job" });
  }
  return res.status(200).json({
    success: true,
    videoId,
    message: "Video queued for processing.",
  });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello from the video processing server!");
});

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// GET /status/:videoId - returns current status and progress info
app.get("/status/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) {
    return res.status(400).json({ success: false, error: "Missing videoId." });
  }

  try {
    // Try to fetch status from Redis
    const statusData = await redis.hgetall(`video:${videoId}`);

    if (!statusData || Object.keys(statusData).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Video ID not found or processing not started.",
      });
    }

    // You can return all saved status fields, or just a subset if you prefer
    return res.status(200).json({
      success: true,
      videoId,
      status: statusData.status,
      progress: statusData.progress,
      error: statusData.error ?? null,
      masterUrl: statusData.masterUrl ?? null,
      urls: statusData.urls ? JSON.parse(statusData.urls) : null,
      createdAt: statusData.createdAt,
    });
  } catch (err) {
    console.error("Error fetching status for video ID", videoId, ":", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch video status" });
  }
});
