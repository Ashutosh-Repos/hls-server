# 🎥 Video Processing Server

A **scalable, reliable, and efficient** video processing backend built with **Node.js, TypeScript, Redis, BullMQ, and Cloudinary**.  
This server accepts uploaded videos, transcodes them into multiple resolutions in **HLS format**, and uploads them to Cloudinary for streaming.

---

## 📑 Table of Contents

- [✨ Overview](#-overview)
- [🚀 Features](#-features)
- [🛠 Technology Stack](#-technology-stack)
- [📂 Project Structure](#-project-structure)
- [⚙️ Setup & Installation](#️-setup--installation)
- [💻 Usage](#-usage)
- [🔌 API Endpoints](#-api-endpoints)
- [📦 Processing Flow](#-processing-flow)
- [🧵 Worker Architecture](#-worker-architecture)
- [📦 Deployment](#-deployment)
- [🔑 Environment Variables](#-environment-variables)
- [⚡ Performance & Reliability](#-performance--reliability)
- [🔒 Security Considerations](#-security-considerations)
- [🐞 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)

---

## ✨ Overview

The **Video Processing Server**:

- Accepts video uploads (`.mp4`, `.mkv`, `.webm`, `.avi`)
- Converts them into **multi-resolution HLS segments**
- Uploads segments and playlists to **Cloudinary**
- Provides **status tracking** via REST API  
  It’s designed for **asynchronous**, **scalable**, and **fault-tolerant** media processing.

---

## 🚀 Features

✅ Upload multiple video formats  
✅ **Asynchronous** job queuing with BullMQ + Redis  
✅ Multi-resolution transcoding: `360p`, `480p`, `720p`, `1080p`  
✅ HLS segment generation (`.ts` + `.m3u8`)  
✅ Cloudinary CDN integration  
✅ Processing status tracking API  
✅ Docker-ready for deployment  
✅ Fault-tolerant with retries & error handling

---

## 🛠 Technology Stack

| Component      | Purpose                      |
| -------------- | ---------------------------- |
| **Node.js**    | Server runtime               |
| **TypeScript** | Strong typing                |
| **Express**    | HTTP API                     |
| **Redis**      | Job storage & pub/sub        |
| **BullMQ**     | Job queue processing         |
| **Cloudinary** | Media storage & CDN          |
| **FFmpeg**     | Transcoding & HLS generation |
| **Busboy**     | File upload parsing          |
| **Docker**     | Containerization             |

---

## 📂 Project Structure

video-processing-server/
├── src/
│ ├── app.ts # Express app and routes
│ ├── index.ts # Entry point
│ ├── queue.ts # BullMQ queue setup
│ ├── redis.ts # Redis connection
│ └── worker/
│ ├── hls_worker.ts # FFmpeg transcoding
│ ├── hls_upload_worker.ts# Uploads to Cloudinary
│ └── redis_consumer.ts # Job orchestration
├── .env # Environment variables
├── package.json
├── tsconfig.json
├── Dockerfile
└── docker-compose.yml

yaml
Copy
Edit

---

## ⚙️ Setup & Installation

### 📌 Prerequisites

- Node.js v18+
- Redis (local or via Docker)
- Cloudinary account
- (Optional) Docker & Docker Compose

### 🔧 Installation

```bash
# 1️⃣ Clone repository
git clone <repository-url>
cd video-processing-server

# 2️⃣ Install dependencies
npm ci

# 3️⃣ Configure environment variables
cp .env.example .env

# 4️⃣ Build the project
npm run build

# 5️⃣ Start API and Worker
npm start
💻 Usage
Upload a video

bash
Copy
Edit
curl -X POST http://localhost:8080/process \
  -F "file=@/path/to/video.mp4"
Check processing status

bash
Copy
Edit
curl http://localhost:8080/status/<videoId>
Health check

bash
Copy
Edit
curl http://localhost:8080/health
🔌 API Endpoints
Method	Endpoint	Description
POST	/process	Upload video for processing
GET	/status/:videoId	Get processing status
GET	/health	Health check

📦 Processing Flow
Upload video via /process

Save temp file & generate videoId

Store initial status in Redis

Queue job in BullMQ

Worker:

Run FFmpeg → generate .ts + .m3u8 for multiple resolutions

Upload to Cloudinary

Create master playlist

Update Redis with final status & URLs

Client polls /status/:videoId

🧵 Worker Architecture
Redis Consumer → Orchestrates FFmpeg + Upload workers

FFmpeg Worker → Transcodes video into HLS

Upload Worker → Uploads HLS segments to Cloudinary

📦 Deployment
Build Docker image

bash
Copy
Edit
docker build -t video-processing-server .
Run with Docker Compose

bash
Copy
Edit
docker-compose up -d --build
Stop services

bash
Copy
Edit
docker-compose down
🔑 Environment Variables
Variable	Description	Example
PORT	Server port	8080
REDIS_HOST	Redis host	redis
REDIS_PORT	Redis port	6379
CLOUD_NAME	Cloudinary cloud name	mycloud
CLOUD_KEY	Cloudinary API key	123456
CLOUD_SECRET	Cloudinary API secret	secret

⚡ Performance & Reliability
BullMQ + Redis = Scalable asynchronous processing

Parallel FFmpeg transcoding

Worker retries & fault-tolerance

Health check endpoint for monitoring

🔒 Security Considerations
No hardcoded secrets (use .env)

File type & size validation

Optional rate limiting

Secure credentials handling in production

🐞 Troubleshooting
Check .env path resolution

Verify Redis is running

Validate Cloudinary credentials

Inspect logs for API & Worker

🤝 Contributing
Pull requests welcome!

Fork

Create a branch

Commit changes

Push & open PR

📜 License
MIT License © Your Name / Organization
```
