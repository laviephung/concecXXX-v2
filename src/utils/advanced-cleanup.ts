// src/utils/advanced-cleanup.ts
import * as fs from "fs";
import * as path from "path";
import db from "../db";
import { config } from "../config";
import { createLogger } from "./logger";

const logger = createLogger("AdvancedCleanup");

// 1. Dọn dẹp File Rác / File "Côi cút" (Orphaned Files)
export async function cleanupOrphanedFiles(): Promise<number> {
  if (!fs.existsSync(config.videoDir)) return 0;
  
  let deletedCount = 0;
  const now = Date.now();
  // 24 hours in milliseconds
  const ageLimitMs = 24 * 60 * 60 * 1000;
  
  // Lấy tất cả video hợp lệ (đang cần file local) từ DB
  const validVideos = await db.videoLibrary.findMany({
    where: { status: { in: ["pending_caption", "ready", "publishing", "failed"] } },
    select: { localPath: true }
  });
  
  const validPaths = new Set(validVideos.map(v => path.resolve(v.localPath)).filter(Boolean));

  const files = fs.readdirSync(config.videoDir);
  for (const file of files) {
    const filePath = path.resolve(path.join(config.videoDir, file));
    const stats = fs.statSync(filePath);
    
    // Nếu file cũ hơn 24h và KHÔNG nằm trong danh sách validPaths thì xóa
    if (now - stats.mtimeMs > ageLimitMs) {
      if (!validPaths.has(filePath)) {
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
          logger.info(`Đã xóa file rác: ${file}`);
        } catch (err: any) {
          logger.error(`Không thể xóa ${file}: ${err.message}`);
        }
      }
    }
  }

  if (deletedCount > 0) logger.success(`Đã xóa ${deletedCount} file video rác/mắc kẹt.`);
  return deletedCount;
}

// 2. Xử lý các video trạng thái `failed`
export async function cleanupFailedVideos(forceAll: boolean = false): Promise<number> {
  // forceAll = true: xóa tất cả failed. Nếu false: xóa video failed cũ hơn 3 ngày.
  let filterCondition: any = { status: "failed", localPath: { not: "" } };
  
  if (!forceAll) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    filterCondition.createdAt = { lt: threeDaysAgo };
  }
  
  const failedVideos = await db.videoLibrary.findMany({
    where: filterCondition
  });

  let deletedCount = 0;
  for (const video of failedVideos) {
    if (video.localPath && fs.existsSync(video.localPath)) {
      try {
        fs.unlinkSync(video.localPath);
        await db.videoLibrary.update({ where: { id: video.id }, data: { localPath: "" } });
        deletedCount++;
      } catch (err: any) {
        logger.error(`Một số lỗi xảy ra khi xóa file failed: ${video.localPath}`);
      }
    }
  }

  if (deletedCount > 0) logger.success(`Đã xóa ${deletedCount} file video bị failed.`);
  return deletedCount;
}

// 3. Dọn dẹp Database (Chống phình to DB)
export async function cleanupOldDatabaseRecords(): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const { count } = await db.videoLibrary.deleteMany({
    where: {
      status: { in: ["published", "failed"] },
      createdAt: { lt: thirtyDaysAgo }
    }
  });

  if (count > 0) logger.success(`Đã dọn dẹp ${count} bản ghi cũ (quá 30 ngày) khỏi Database.`);
  return count;
}

// Hàm chạy tổng hợp tất cả
export async function runFullAdvancedCleanup(): Promise<{
  orphaned: number, failed: number, records: number
}> {
  logger.info("Bắt đầu chạy Advanced Cleanup...");
  const failed = await cleanupFailedVideos();
  const orphaned = await cleanupOrphanedFiles();
  const records = await cleanupOldDatabaseRecords();
  logger.info("Advanced Cleanup hoàn tất.");
  return { orphaned, failed, records };
}
