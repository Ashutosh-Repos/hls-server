import { app } from "./app";
import { redis } from "./redis";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function start() {
  try {
    // Only connect if not already ready/connecting
    if (!["ready", "connecting"].includes(redis.status)) {
      await redis.connect();
    }
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (err) {
    console.error(
      "Failed to connect to Redis: Restart the server",
      err instanceof Error ? err.message : "Unknown error"
    );
  }
}

start();
