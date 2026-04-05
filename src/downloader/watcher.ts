// src/downloader/watcher.ts
// Tự động quét thư mục video để nhận diện file mới từ sync-to-vps.mjs
// Đã cải tiến: Tự động che logo (Video Masking) và chèn overlay thương hiệu @0xFly_
// Cập nhật v3.2: Đọc file .info.json để lấy tiêu đề gốc của video

import * as fs from "fs/promises"; // Sử dụng fs/promises cho async/await
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";
import { maskVideo } from "../utils/video-processor";

const logger = createLogger("Watcher");

export async function scanNewVideos() {
  if (!fs.existsSync(config.videoDir)) {
    await fs.mkdir(config.videoDir, { recursive: true });
    return;
  }

  const files = await fs.readdir(config.videoDir);
  // Chỉ lấy các file .mp4 gốc, bỏ qua các file đã được xử lý (_masked.mp4) và các file .info.json
  const videoFiles = files.filter(f => f.endsWith(".mp4") && !f.includes("_masked.mp4") && !f.includes("_c.mp4"));

  if (videoFiles.length === 0) return;

  for (const file of videoFiles) {
    const filePath = path.join(config.videoDir, file);
    const videoId = path.basename(file, ".mp4");
    const maskedPath = path.join(config.videoDir, `${videoId}_masked.mp4`);
    const infoJsonPath = path.join(config.videoDir, `${videoId}.info.json`); // Đường dẫn đến file info.json

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
      
      let videoTitle = videoId; // Mặc định dùng videoId làm title
      // Đọc file .info.json nếu tồn tại
      try {
        const infoJsonContent = await fs.readFile(infoJsonPath, "utf-8");
        const videoInfo = JSON.parse(infoJsonContent);
        if (videoInfo.title) {
          videoTitle = videoInfo.title; // Cập nhật title nếu có trong info.json
          logger.info(`Đã đọc tiêu đề gốc từ ${videoId}.info.json: "${videoTitle}"`);
        }
      } catch (e) {
        logger.warn(`Không tìm thấy hoặc không đọc được ${videoId}.info.json, sẽ dùng video ID làm tiêu đề.`);
      }

      // 🛡️ BƯỚC XỬ LÝ VIDEO: Che logo cũ, chèn overlay thương hiệu
      logger.info(`Đang tiến hành che logo cho ${file}...`);
      const ok = await maskVideo(filePath, maskedPath);
      
      const finalPath = ok ? maskedPath : filePath;
      if (ok) {
        // Xóa file gốc để tiết kiệm dung lượng sau khi đã có bản masked
        try { await fs.unlink(filePath); } catch (e) { logger.error(`Lỗi xóa file gốc ${filePath}: ${e.message}`); }
      }

      // Xóa file .info.json sau khi đã đọc xong
      try {
        if (await fs.stat(infoJsonPath)) {
          await fs.unlink(infoJsonPath);
          logger.info(`Đã xóa file metadata ${infoJsonPath}.`);
        }
      } catch (e) { /* File không tồn tại hoặc lỗi khác, bỏ qua */ }

      // Lấy thông tin cơ bản từ file cuối cùng
      const stats = await fs.stat(finalPath);
      
      // Thêm vào DB với trạng thái chờ caption
      await db.videoLibrary.create({
        data: {
          source: "sync",
          originalUrl: `https://sync-upload/${videoId}`, 
          localPath: finalPath,
          title: videoTitle, // Sử dụng tiêu đề từ info.json hoặc videoId
          status: "pending_caption",
          fileSize: stats.size,
          duration: 0, 
        }
      });
      
      logger.success(`Đã đăng ký video ${videoId} (Masked: ${ok}) với tiêu đề "${videoTitle}" vào hàng đợi xử lý.`);
    }
  }
}
