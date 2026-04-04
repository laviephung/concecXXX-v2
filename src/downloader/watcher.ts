// src/downloader/watcher.ts
// Tự động quét thư mục video để nhận diện file mới từ sync-to-vps.mjs
// Đã cải tiến: Tự động che logo (Video Masking) và chèn overlay thương hiệu @0xFly_

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";
import { maskVideo } from "../utils/video-processor";

const logger = createLogger("Watcher");

export async function scanNewVideos() {
  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(config.videoDir);
  // Chỉ lấy các file .mp4 gốc, bỏ qua các file đã được xử lý (_masked.mp4)
  const videoFiles = files.filter(f => f.endsWith(".mp4") && !f.includes("_masked.mp4") && !f.includes("_c.mp4"));

  if (videoFiles.length === 0) return;

  for (const file of videoFiles) {
    const filePath = path.join(config.videoDir, file);
    const videoId = path.basename(file, ".mp4");
    const maskedPath = path.join(config.videoDir, `${videoId}_masked.mp4`);
    
    // Kiểm tra xem video đã có trong DB chưa (kiểm tra cả bản gốc và bản đã xử lý)
    const existing = await db.videoLibrary.findFirst({
      where: { 
        OR: [
          { localPath: filePath },
          { localPath: maskedPath },
          { originalUrl: { contains: videoId } }
        ]
      }
    });

    if (!existing) {
      logger.info(`Phát hiện video mới từ Sync: ${file}`);
      
      // 🛡️ BƯỚC XỬ LÝ VIDEO: Che logo cũ, chèn overlay thương hiệu
      logger.info(`Đang tiến hành che logo cho ${file}...`);
      const ok = await maskVideo(filePath, maskedPath);
      
      const finalPath = ok ? maskedPath : filePath;
      if (ok) {
        // Xóa file gốc để tiết kiệm dung lượng sau khi đã có bản masked
        try { fs.unlinkSync(filePath); } catch (e) {}
      }

      // Lấy thông tin cơ bản từ file cuối cùng
      const stats = fs.statSync(finalPath);
      
      // Thêm vào DB với trạng thái chờ caption
      await db.videoLibrary.create({
        data: {
          source: "sync",
          originalUrl: `https://sync-upload/${videoId}`, 
          localPath: finalPath,
          title: videoId, 
          status: "pending_caption",
          fileSize: stats.size,
          duration: 0, 
        }
      });
      
      logger.success(`Đã đăng ký video ${videoId} (Masked: ${ok}) vào hàng đợi xử lý.`);
    }
  }
}
