// src/scheduler.ts
// Lịch đăng bài theo 2 khung giờ, mỗi video cách nhau 30-60 phút (Random Delay)
// Đã cải tiến: Tích hợp Watcher cho Sync-to-VPS, Random Delay, Đăng bài văn bản xen kẽ

import cron from "node-cron";
import { config } from "./config";
import { createLogger } from "./utils/logger";
import { processPendingCaptions } from "./processor/caption-generator";
import { publishOne, publishTextOnly } from "./publisher/twitter-publisher";
import { downloadAllChannels, cleanupPublishedVideos } from "./downloader/channel-downloader";
import { getPublishingStatus } from "./bot/telegram-bot";
import { scanNewVideos } from "./downloader/watcher";
import { generateFunnyText } from "./processor/text-generator";

const logger = createLogger("Scheduler");

// ─── Trạng thái publish queue ─────────────────────────────────────────────────

let publishQueue: { videosLeft: number; slotName: string } | null = null;
let publishTimer: NodeJS.Timeout | null = null;

// ─── Đăng từng video trong queue theo interval ngẫu nhiên ──────────────────────

async function startPublishQueue(totalVideos: number, slotName: string) {
  if (publishQueue) {
    logger.warn(`Đang trong khung giờ ${publishQueue.slotName}, bỏ qua ${slotName}`);
    return;
  }

  logger.info(`Bắt đầu khung giờ ${slotName}: đăng ${totalVideos} video, cách nhau ~${config.publishIntervalMinutes} phút`);
  publishQueue = { videosLeft: totalVideos, slotName };

  // Đăng video đầu tiên ngay lập tức
  await publishNextInQueue();
}

async function publishNextInQueue() {
  if (!publishQueue || publishQueue.videosLeft <= 0) {
    if (publishQueue) {
      logger.success(`Khung giờ ${publishQueue.slotName} hoàn tất!`);
      publishQueue = null;
    }
    return;
  }

  if (!getPublishingStatus()) {
    logger.info("Auto-publish đang tạm dừng, hủy khung giờ");
    publishQueue = null;
    return;
  }

  try {
    // 🎲 Cơ chế xen kẽ bài đăng văn bản (Xác suất 25%)
    const shouldPostText = Math.random() < 0.25;
    
    if (shouldPostText) {
      logger.info("🎲 Quyết định đăng một bài văn bản ngẫu nhiên để tăng tương tác...");
      const funnyText = await generateFunnyText();
      if (funnyText) {
        await publishTextOnly(funnyText);
        // Sau khi đăng bài text, chúng ta vẫn giữ nguyên số lượng videoLeft 
        // để đảm bảo đủ số lượng video anh muốn trong 1 slot.
      }
    }

    logger.info(`Đang đăng video (còn lại: ${publishQueue.videosLeft})`);
    const ok = await publishOne();
    if (!ok) {
      logger.warn("Không có video để đăng, kết thúc khung giờ sớm");
      publishQueue = null;
      return;
    }
    publishQueue.videosLeft--;
  } catch (err: any) {
    logger.error(`Lỗi đăng bài: ${err.message}`);
    publishQueue = null;
    return;
  }

  // Còn video → đặt hẹn giờ cho video tiếp theo với Random Delay (±20%)
  if (publishQueue && publishQueue.videosLeft > 0) {
    const baseDelayMs = config.publishIntervalMinutes * 60 * 1000;
    const randomFactor = 0.8 + Math.random() * 0.4; // 80% đến 120%
    const delayMs = Math.floor(baseDelayMs * randomFactor);
    
    logger.info(`Video tiếp theo sau ${(delayMs / 60000).toFixed(1)} phút...`);
    publishTimer = setTimeout(publishNextInQueue, delayMs);
  } else {
    if (publishQueue) {
      logger.success(`Khung giờ ${publishQueue.slotName} hoàn tất!`);
      publishQueue = null;
    }
  }
}

// ─── Khởi động scheduler ──────────────────────────────────────────────────────

export function startScheduler() {
  const slot1Hour = config.publishSlot1Hour;
  const slot2Hour = config.publishSlot2Hour;
  const slot1Videos = config.publishSlot1Videos;
  const slot2Videos = config.publishSlot2Videos;

  // ─── Quét video mới từ Sync-to-VPS (mỗi 1 phút) ───────────────────────────
  cron.schedule("*/1 * * * *", async () => {
    try { await scanNewVideos(); }
    catch (err: any) { logger.error(`Watcher job lỗi: ${err.message}`); }
  });

  // ─── Tạo caption (mỗi 2 phút) ───────────────────────────────────────────
  cron.schedule("*/2 * * * *", async () => {
    try { await processPendingCaptions(); }
    catch (err: any) { logger.error(`Caption job lỗi: ${err.message}`); }
  });

  // ─── Khung giờ 1 ────────────────────────────────────────────────────────
  cron.schedule(`0 ${slot1Hour} * * *`, async () => {
    if (!getPublishingStatus()) return;
    await startPublishQueue(slot1Videos, `Sáng (${slot1Hour}:00)`);
  });

  // ─── Khung giờ 2 ────────────────────────────────────────────────────────
  cron.schedule(`0 ${slot2Hour} * * *`, async () => {
    if (!getPublishingStatus()) return;
    await startPublishQueue(slot2Videos, `Tối (${slot2Hour}:00)`);
  });

  // ─── Tự động tải batch mới từ kênh (mỗi 6 giờ) ──────────────────────────
  cron.schedule("0 */6 * * *", async () => {
    try {
      logger.info("Auto crawl kênh theo lịch...");
      await downloadAllChannels(10);
    } catch (err: any) { logger.error(`Crawl job lỗi: ${err.message}`); }
  });

  // ─── Tự động xóa file video đã đăng (mỗi 1 giờ) ─────────────────────────
  cron.schedule("0 * * * *", async () => {
    try { await cleanupPublishedVideos(); }
    catch (err: any) { logger.error(`Cleanup job lỗi: ${err.message}`); }
  });

  logger.success(
    `Scheduler v2.1 khởi động:\n` +
    `  🔍 Watcher Sync : mỗi 1 phút\n` +
    `  📝 Tạo caption  : mỗi 2 phút\n` +
    `  📤 Khung sáng   : ${slot1Hour}:00 → ${slot1Videos} video\n` +
    `  📤 Khung tối    : ${slot2Hour}:00 → ${slot2Videos} video\n` +
    `  ⏱️  Cách nhau    : ~${config.publishIntervalMinutes} phút (Random Delay)\n` +
    `  🎲 Xen kẽ Text  : Có (Xác suất 25%)\n` +
    `  🗑️  Xóa file cũ  : mỗi 1 giờ`
  );
}

export async function triggerPublishNow() {
  if (publishQueue) {
    return `⚠️ Đang trong khung giờ *${publishQueue.slotName}*, còn *${publishQueue.videosLeft}* video chờ đăng`;
  }
  await startPublishQueue(1, "Thủ công");
  return `✅ Đang đăng 1 video ngay bây giờ...`;
}
