// src/downloader/watcher.ts
// Tự động quét thư mục video để nhận diện file mới từ sync-to-vps.mjs
// Đưa video vào Database để xử lý caption và đăng bài

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("Watcher");

export async function scanNewVideos() {
  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(config.videoDir);
  const videoFiles = files.filter(f => f.endsWith(".mp4") && !f.includes("_c.mp4"));

  if (videoFiles.length === 0) return;

  for (const file of videoFiles) {
    const filePath = path.join(config.videoDir, file);
    const videoId = path.basename(file, ".mp4");
    
    // Kiểm tra xem video đã có trong DB chưa
    const existing = await db.videoLibrary.findFirst({
      where: { 
        OR: [
          { localPath: filePath },
          { originalUrl: { contains: videoId } }
        ]
      }
    });

    if (!existing) {
      logger.info(`Phát hiện video mới từ Sync: ${file}`);
      
      // Lấy thông tin cơ bản từ file
      const stats = fs.statSync(filePath);
      
      // Thêm vào DB với trạng thái chờ caption
      await db.videoLibrary.create({
        data: {
          source: "sync",
          originalUrl: `https://sync-upload/${videoId}`, // URL giả định cho video sync
          localPath: filePath,
          title: videoId, // Tạm thời dùng ID làm title, AI sẽ viết caption dựa trên cái này hoặc fallback
          status: "pending_caption",
          fileSize: stats.size,
          duration: 0, // Sẽ được cập nhật nếu có ffmpeg quét
        }
      });
      
      logger.success(`Đã đăng ký video ${videoId} vào hàng đợi xử lý.`);
    }
  }
}
