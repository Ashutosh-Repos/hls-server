import { Worker, QueueEvents, Job, Queue } from "bullmq";
import { redis } from "../redis";
import fs from "node:fs/promises";
import { promisify } from "util";
import { exec } from "child_process";
import { v2 as cloudinary } from "cloudinary";
import { Worker as NodeWorker } from "worker_threads";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const execPromise = promisify(exec);

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

interface WorkerSuccessMessage {
  success: true;
  urls: { type: number; url: string }[];
  message?: string;
}

interface WorkerErrorMessage {
  success: false;
  error: string;
}

type WorkerMessage = WorkerSuccessMessage | WorkerErrorMessage;

const uploadToCloudinary = async (
  filePath: string,
  folder: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: "raw",
        folder,
        use_filename: true,
        unique_filename: false,
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          reject(
            new Error(
              `Cloudinary upload error for ${filePath}: ${error.message}`
            )
          );
        } else if (result) {
          resolve(result.url);
        } else {
          reject(new Error(`Unknown Cloudinary upload error for ${filePath}`));
        }
      }
    );
  });
};

const generateMasterPlaylist = (
  uploadSubDir: { dir: string; height: number; width: number }[]
): string => {
  return [
    "#EXTM3U",
    ...uploadSubDir.map(
      (elem, i) =>
        `#EXT-X-STREAM-INF:BANDWIDTH=${(i + 1) * 250000},RESOLUTION=${
          elem.width
        }x${elem.height}\n${elem.height}p/index.m3u8`
    ),
  ].join("\n");
};

const getVideoResolution = async (
  filePath: string
): Promise<{ width: number; height: number }> => {
  const { stdout } = await execPromise(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`
  );
  const metadata = JSON.parse(stdout);
  return {
    width: metadata.streams[0].width,
    height: metadata.streams[0].height,
  };
};

const runFFmpegWorker = (
  inputFilePath: string,
  uploadSubDir: { dir: string; height: number; width: number }[]
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(path.resolve("dist/worker/hls_worker.js"), {
      workerData: { inputFilePath, uploadSubDir },
    });

    worker.on("message", (message: { success: boolean; error?: string }) => {
      if (message.success) {
        resolve();
      } else {
        reject(new Error(message.error || "FFmpeg worker error"));
      }
    });

    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`FFmpeg worker exited with code ${code}`));
    });
  });
};

const runUploadWorker = (
  uploadSubDir: { dir: string; height: number; width: number }[],
  folderUUID: string
): Promise<WorkerSuccessMessage["urls"]> => {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(
      path.resolve("dist/worker/hls_upload_worker.js"),
      {
        workerData: { uploadSubDir, folderUUID },
      }
    );

    worker.on("message", (message: WorkerMessage) => {
      if (message.success && message.urls) {
        resolve(message.urls);
      } else if (!message.success && "error" in message) {
        reject(new Error(message.error));
      }
    });

    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Upload worker exited with code ${code}`));
    });
  });
};

const processJob = async (job: Job) => {
  const { videoId, inputFilePath, uploadDir, inputDir } = job.data;
  try {
    await redis.hset(`video:${videoId}`, {
      status: "checking video resolutions",
      progress: "5",
    });
    // Check resolution
    const { width, height } = await getVideoResolution(inputFilePath);
    if (height > width) throw new Error("Aspect ratio should be landscape");
    if (Math.min(height, width) < 360)
      throw new Error(`Video resolution too low: ${width}x${height}`);
    // Prepare subdirectories for output resolutions
    const uploadSubDir = [
      { dir: `${uploadDir}/360p`, height: 360, width: 640 },
    ];
    if (height >= 480)
      uploadSubDir.push({ dir: `${uploadDir}/480p`, height: 480, width: 854 });
    if (height >= 720)
      uploadSubDir.push({ dir: `${uploadDir}/720p`, height: 720, width: 1280 });
    if (height >= 1080)
      uploadSubDir.push({
        dir: `${uploadDir}/1080p`,
        height: 1080,
        width: 1920,
      });
    if (height >= 1620)
      uploadSubDir.push({
        dir: `${uploadDir}/1620p`,
        height: 1620,
        width: 2880,
      });
    if (height >= 2430)
      uploadSubDir.push({
        dir: `${uploadDir}/2430p`,
        height: 2430,
        width: 4320,
      });
    await Promise.all(
      uploadSubDir.map((d) => fs.mkdir(d.dir, { recursive: true }))
    );
    // FFmpeg HLS generation (parallelized in worker thread)
    const ffmpegPromise = runFFmpegWorker(inputFilePath, uploadSubDir);
    const uploadPromise = runUploadWorker(uploadSubDir, videoId);

    await redis.hset(`video:${videoId}`, {
      status: "Processing & Uploading",
      progress: "20",
    });

    await ffmpegPromise;

    const urls = await uploadPromise;
    // Write master playlist

    await redis.hset(`video:${videoId}`, {
      status: "Generating master file",
      progress: "20",
    });
    const masterPlaylistPath = `${uploadDir}/index.m3u8`;
    const masterPlaylistContent = generateMasterPlaylist(uploadSubDir);
    await fs.writeFile(masterPlaylistPath, masterPlaylistContent.trim());
    // Upload all m3u8 files to Cloudinary (parallelized in worker thread)
    await redis.hset(`video:${videoId}`, {
      status: "Uploading master file",
      progress: "20",
    });
    const masterUrl = await uploadToCloudinary(masterPlaylistPath, videoId);
    await redis.hset(`video:${videoId}`, {
      status: "completed",
      progress: "100",
      masterUrl,
      urls: JSON.stringify(urls),
    });
    // Cleanup
    // await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    // await fs.rm(inputDir, { recursive: true, force: true }).catch(() => {});
  } catch (err: unknown) {
    await redis.hset(`video:${videoId}`, {
      status: "error",
      error: err instanceof Error ? err.message : "Unkown error",
    });
  } finally {
    await Promise.all([
      fs.rm(uploadDir, { recursive: true, force: true }).catch(console.error),
      fs.rm(inputDir, { recursive: true, force: true }).catch(console.error),
    ]);
    await fs
      .rm(path.join("/tmp", `${videoId}`), {
        recursive: true,
        force: true,
      })
      .catch(console.error);
  }
};

const worker = new Worker("video-processing", processJob, {
  connection: redis,
  concurrency: 4,
  lockDuration: 600000,
});

const queue = new Queue("video-processing", { connection: redis });
const queueEvents = new QueueEvents("video-processing", {
  connection: redis,
});
queueEvents.on("failed", async ({ jobId, failedReason }) => {
  if (jobId) {
    const job = await queue.getJob(jobId);
    if (job && job.data && job.data.videoId) {
      await redis.hset(`video:${job.data.videoId}`, {
        status: "error",
        error: failedReason,
      });
    }
  }
});
queueEvents.on("completed", async ({ jobId }) => {
  if (jobId) {
    const job = await queue.getJob(jobId);
    if (job && job.data && job.data.videoId) {
      await redis.hset(`video:${job.data.videoId}`, {
        status: "completed",
        progress: "100",
      });
    }
  }
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
});
