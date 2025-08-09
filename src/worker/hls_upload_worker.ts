import { parentPort, workerData } from "worker_threads";
import chokidar from "chokidar";
import cloudinaryModule from "cloudinary";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const cloudinary = cloudinaryModule.v2;

interface UploadSubDir {
  dir: string;
  height: number;
}

interface WorkerData {
  uploadSubDir: UploadSubDir[];
  folderUUID: string;
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

// Upload file to Cloudinary
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
        } else {
          resolve(result!.url);
        }
      }
    );
  });
};

// Watch the folder for .ts and .m3u8 files and upload them to Cloudinary
const watchAndUpload = (
  uploadDir: string,
  cloudFolder: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    let m3u8Uploaded = false;
    const uploadedSegments = new Set<string>();

    const watcher = chokidar.watch(`${uploadDir}`, { persistent: true });

    watcher.on("add", async (filePath) => {
      const ext = path.extname(filePath);

      if (ext === ".ts" && !uploadedSegments.has(filePath)) {
        try {
          const tsFile = path.basename(filePath);
          parentPort?.postMessage({
            success: true,
            message: `Processing ${tsFile}...`,
          });

          await uploadToCloudinary(filePath, cloudFolder);
          uploadedSegments.add(filePath);
          await fs.rm(filePath);

          parentPort?.postMessage({
            success: true,
            message: `Uploaded and removed ${tsFile}`,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          parentPort?.postMessage({
            success: false,
            error: `Failed to process ${filePath}: ${errorMessage}`,
          });
        }
      }

      if (ext === ".m3u8" && !m3u8Uploaded) {
        try {
          const m3u8File = path.basename(filePath);
          parentPort?.postMessage({
            success: true,
            message: `Processing ${m3u8File}...`,
          });

          const m3u8Url = await uploadToCloudinary(filePath, cloudFolder);
          m3u8Uploaded = true;

          await fs.rm(filePath);
          watcher.close();

          parentPort?.postMessage({
            success: true,
            message: `Uploaded and removed ${m3u8File}`,
          });

          resolve(m3u8Url);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          parentPort?.postMessage({
            success: false,
            error: `Failed to upload ${filePath}: ${errorMessage}`,
          });
          reject(error);
        }
      }
    });

    watcher.on("error", (error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      parentPort?.postMessage({ success: false, error: errorMessage });
      reject(new Error(`Chokidar watcher error: ${errorMessage}`));
    });

    watcher.on("ready", () => {
      parentPort?.postMessage({
        success: true,
        message: `Watcher is ready and monitoring directory: ${uploadDir}`,
      });
    });
  });
};

// Main upload worker logic
(async () => {
  try {
    const { uploadSubDir, folderUUID } = workerData as WorkerData;

    parentPort?.postMessage({
      success: true,
      message: `Starting to watch directory: ${JSON.stringify(uploadSubDir)}`,
    });

    const urls: { type: number; url: string }[] = [];

    for (const element of uploadSubDir) {
      const m3u8Url = await watchAndUpload(
        element.dir,
        `${folderUUID}/${element.height}p`
      );
      urls.push({ type: element.height, url: m3u8Url });
    }

    parentPort?.postMessage({
      success: true,
      urls,
      message: "All files processed successfully.",
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    parentPort?.postMessage({ success: false, error: errorMessage });
  }
})();
