import { parentPort, workerData } from "worker_threads";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface UploadDir {
  dir: string;
  width: number;
  height: number;
}

interface WorkerInput {
  inputFilePath: string;
  uploadSubDir: UploadDir[];
}

// Run FFmpeg to generate HLS segments
const runFFmpeg = async (inputFilePath: string, uploadDir: UploadDir) => {
  const hlsCommand = `ffmpeg -i "${inputFilePath}" \
    -vf "scale=w=iw*min(${uploadDir.width}/iw\\,${uploadDir.height}/ih):h=ih*min(${uploadDir.width}/iw\\,${uploadDir.height}/ih),pad=${uploadDir.width}:${uploadDir.height}:(${uploadDir.width}-iw*min(${uploadDir.width}/iw\\,${uploadDir.height}/ih))/2:(${uploadDir.height}-ih*min(${uploadDir.width}/iw\\,${uploadDir.height}/ih))/2" \
    -c:v libx264 -preset veryfast -crf 23 \
    -g 48 -keyint_min 48 -sc_threshold 0 -hls_time 4 -hls_playlist_type vod \
    -c:a aac -b:a 128k -hls_segment_filename "${uploadDir.dir}/%03d.ts" \
    "${uploadDir.dir}/index.m3u8"`;

  await execAsync(hlsCommand);
};

// Main FFmpeg worker logic
(async () => {
  try {
    const { inputFilePath, uploadSubDir } = workerData as WorkerInput;

    for (const element of uploadSubDir) {
      await runFFmpeg(inputFilePath, element);
    }

    parentPort?.postMessage({
      success: true,
      message: "FFmpeg HLS processing completed",
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    parentPort?.postMessage({ success: false, error: errorMessage });
  }
})();
