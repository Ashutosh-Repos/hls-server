import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL! + "?family=0", {
  // host: process.env.REDIS_HOST,
  // port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  maxRetriesPerRequest: null,
  //   password: process.env.REDIS_PASSWORD || undefined,
});
redis.on("connect", () => {
  console.log(
    process.env.REDIS_HOST,
    process.env.REDIS_PORT,
    typeof process.env.REDIS_PORT,
    typeof process.env.REDIS_HOST
  );
  console.log("Connected to Redis");
});

redis.on("error", (err: unknown) => {
  console.error(
    "Redis error:",
    err instanceof Error ? err.message : "Unknown error"
  );
});
