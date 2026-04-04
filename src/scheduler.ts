// src/scheduler.ts
// Lịch đăng bài theo 2 khung giờ, mỗi video cách nhau 30-60 phút (Random Delay)
// Đã cải tiến: Tích hợp Watcher cho Sync-to-VPS, Random Delay, Đăng bài văn bản xen kẽ, Kiểm tra Shadowban
// FIX v2.5: Giới hạn tần suất đăng bài văn bản (text-only) tối thiểu 12 tiếng một lần

import cron from "node-cron";
import { config } from "./config";
import { createLogger } from "./utils/logger";
import { processPendingCaptions } from "./processor/caption-generator";
import { publishOne, publishTextOnly } from "./publisher/twitter-publisher";
import { downloadAllChannels, cleanupPublishedVideos } from "./downloader/channel-downloader";
import { getPublishingStatus } from "./bot/telegram-bot";
import { scanNewVideos } from "./downloader/watcher";
import { generateFunnyText } from "./processor/text-generator";
import { checkShadowban, ShadowbanStatus } from "./utils/shadowban-checker";
import TelegramBot from "node-telegram-bot-api";

const logger = createLogger("Scheduler");
const tgBot = new TelegramBot(config.telegramBotToken);

// ─── Trạng thái publish queue ─────────────────────────────────────────────────

let publishQueue: { videosLeft: number; slotName: string } | null = null;
let publishTimer: NodeJS.Timeout | null = null;
let isShadowbanned = false; // Trạng thái Shadowban hiện tại
let lastTextPostTime: number = 0; // Lưu thời điểm đăng bài văn bản gần nhất

// ─── Đăng từng video trong queue theo interval ngẫu nhiên ──────────────────────

async function startPublishQueue(totalVideos: number, slotName: string) {
  if (publishQueue) {
    logger.warn(`Đang trong khung giờ ${publishQueue.slotName}, bỏ qua ${slotName}`);
    return;
  }

  // Nếu bị Shadowban, giảm số lượng video đăng xuống 1 bài/slot để "cứu" tài khoản
  let finalTotalVideos = totalVideos;
  if (isShadowbanned) {
    finalTotalVideos = 1;
    logger.warn(`⚠️ Đang bị Shadowban: Giảm số lượng video xuống còn ${finalTotalVideos} bài/slot.`);
  }

  logger.info(`Bắt đầu khung giờ ${slotName}: đăng ${finalTotalVideos} video, cách nhau ~${config.publishIntervalMinutes} phút`);
  publishQueue = { videosLeft: finalTotalVideos, slotName };

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
    logger.info(`Đang đăng video (còn lại: ${publishQueue.videosLeft})`);
    const ok = await publishOne(isShadowbanned); // Truyền trạng thái ban để xử lý hashtag
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

  // ─── Kiểm tra Shadowban (mỗi 6 giờ) ───────────────────────────────────────
  const checkBan = async () => {
    const username = "0xFly_"; // Tên tài khoản của anh
    const status = await checkShadowban(username);
    if (status) {
      isShadowbanned = status.is_banned;
      if (isShadowbanned) {
        const banTypes = [];
        if (status.search_ban) banTypes.push("Search Ban");
        if (status.search_suggestion_ban) banTypes.push("Search Suggestion Ban");
        if (status.ghost_ban) banTypes.push("Ghost Ban");
        if (status.reply_deboosting) banTypes.push("Reply Deboosting");
        
        for (const adminId of config.adminUserIds) {
          await tgBot.sendMessage(adminId, 
            `🚨 *CẢNH BÁO SHADOWBAN!*\n\n` +
            `Tài khoản @${username} đang bị: *${banTypes.join(", ")}*\n\n` +
            `🛡️ *Bot đã tự động kích hoạt Safe Mode:*\n` +
            `- Giảm số lượng video xuống 1 bài/slot.\n` +
            `- Tăng tỷ lệ bài đăng văn bản lên 50%.\n` +
            `- Tạm thời loại bỏ hashtag khỏi video.\n\n` +
            `🔗 Kiểm tra tại: https://shadowban.yuzurisa.com/${username}`,
            { parse_mode: "Markdown" }
          );
        }
      }
    }
  };
  
  // Chạy check ngay khi khởi động
  checkBan();
  // Lên lịch check mỗi 6 giờ
  cron.schedule("0 */6 * * *", checkBan);

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

  // 🎲 FIX v2.5: Đăng bài văn bản ngẫu nhiên rải rác trong ngày (Tối thiểu 12 tiếng/lần)
  cron.schedule("0 * * * *", async () => {
    if (!getPublishingStatus()) return;
    
    // Nếu đang trong khung giờ đăng video, bỏ qua để tránh dồn dập
    if (publishQueue) return;

    // Kiểm tra xem đã đủ 12 tiếng kể từ bài đăng văn bản gần nhất chưa
    const now = Date.now();
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    if (now - lastTextPostTime < twelveHoursMs) {
      return; // Chưa đủ 12 tiếng, bỏ qua
    }

    // Xác suất 25% mỗi giờ sau khi đã qua 12 tiếng
    const shouldPostText = Math.random() < 0.25;
    if (shouldPostText) {
      logger.info(`🎲 Quyết định đăng một bài văn bản ngẫu nhiên (Đã qua 12 tiếng)...`);
      const funnyText = await generateFunnyText();
      if (funnyText) {
        const ok = await publishTextOnly(funnyText);
        if (ok) {
          lastTextPostTime = Date.now(); // Cập nhật thời điểm đăng bài thành công
        }
      }
    }
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
    `Scheduler v2.5 (Strict Text Post Limit):\n` +
    `  🔍 Watcher Sync : mỗi 1 phút\n` +
    `  📝 Tạo caption  : mỗi 2 phút\n` +
    `  📤 Khung sáng   : ${slot1Hour}:00 → ${slot1Videos} video\n` +
    `  📤 Khung tối    : ${slot2Hour}:00 → ${slot2Videos} video\n` +
    `  ⏱️  Cách nhau    : ~${config.publishIntervalMinutes} phút (Random Delay)\n` +
    `  🎲 Bài đăng Text: Tối thiểu 12 tiếng/lần (Xác suất 25%/giờ)\n` +
    `  🛡️  Shadowban Check: Mỗi 6 giờ\n` +
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
