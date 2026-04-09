// src/bot/telegram-bot.ts

import TelegramBot from "node-telegram-bot-api";
import * as fs from "fs";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import { downloadOne, getVideoStats } from "../downloader/video-downloader";
import { downloadAllChannels, cleanupPublishedVideos, getDiskUsage } from "../downloader/channel-downloader";
import { downloadInstagramOne, downloadInstagramProfile } from "../downloader/instagram-downloader";
import { triggerPublishNow, checkBanNow, downloadAllChannels } from "../scheduler";
import db from "../db";

const logger = createLogger("TelegramBot");
let bot: TelegramBot;
let isPublishing = true;

export function startTelegramBot(): TelegramBot {
  bot = new TelegramBot(config.telegramBotToken, { polling: true });
  logger.success("Telegram bot đã khởi động");

  // Tự động đăng ký danh sách lệnh (Menu) với Telegram
  bot.setMyCommands([
    { command: "start", description: "Hướng dẫn sử dụng" },
    { command: "status", description: "Thống kê kho video + dung lượng" },
    { command: "checkban", description: "Kiểm tra Shadowban @0xFly_ 🛡️" },
    { command: "queue", description: "Xem hàng đợi chờ đăng" },
    { command: "recent", description: "Xem các tweet vừa đăng" },
    { command: "postnow", description: "Đăng 1 video ngay lập tức" },
    { command: "crawlnow", description: "Tải batch video ngay bây giờ" },
    { command: "channels", description: "Danh sách kênh đang theo dõi" },
    { command: "cleanup", description: "Xóa file video đã đăng" },
    { command: "pause", description: "Tạm dừng auto-publish" },
    { command: "resume", description: "Bật lại auto-publish" },
    { command: "retry", description: "Thử lại các video bị lỗi" }
  ]).then(() => {
    logger.success("Đã cập nhật danh sách menu lệnh lên Telegram");
  }).catch(err => {
    logger.error(`Lỗi khi cập nhật menu lệnh: ${err.message}`);
  });

  const isAdmin = (userId?: number) =>
    !!userId && config.adminUserIds.includes(userId);

  async function reply(chatId: number, text: string) {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch {
      await bot.sendMessage(chatId, text);
    }
  }

  // ─── /start ──────────────────────────────────────────────────────────────
  bot.onText(/\/start|\/help/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    await reply(msg.chat.id,
      `🤖 *Content Bot v2.8*\n\n` +
      `*📥 Tải video:*\n` +
      `/addchannel <url> - Thêm kênh\n` +
      `/removechannel <url> - Xóa kênh\n` +
      `/channels - Danh sách kênh\n` +
      `/crawlnow - Tải batch ngay (10 video/kênh)\n` +
      `/add <url> - Thêm 1 video lẻ\n\n` +
      `*📊 Quản lý:*\n` +
      `/status - Thống kê + dung lượng\n` +
      `/checkban - Kiểm tra Shadowban 🛡️\n` +
      `/queue - Hàng đợi\n` +
      `/recent - Tweet gần đây\n` +
      `/cleanup - Xóa file đã đăng\n\n` +
      `*⚙️ Điều khiển:*\n` +
      `/postnow - Đăng ngay 1 bài\n` +
      `/pause - Tạm dừng đăng\n` +
      `/resume - Bật lại đăng\n` +
      `/retry - Thử lại video lỗi`
    );
  });

  // ─── /status ─────────────────────────────────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const stats = await getVideoStats();
    const historyCount = fs.existsSync("data/downloaded-history.txt")
      ? fs.readFileSync("data/downloaded-history.txt", "utf-8").split("\n").filter(Boolean).length
      : 0;

    await reply(msg.chat.id,
      `📊 *Thống Kê Bot*\n\n` +
      `🎬 *Kho video:*\n` +
      `  ✅ Sẵn sàng đăng: *${stats.ready}*\n` +
      `  ⏳ Chờ caption: *${stats.pending}*\n` +
      `  📤 Đã đăng: *${stats.published}*\n` +
      `  ❌ Lỗi: *${stats.failed}*\n\n` +
      `💾 Dung lượng: *${getDiskUsage()}*\n` +
      `📋 Lịch sử đã tải: ${historyCount} video\n` +
      `🔄 Auto-publish: ${isPublishing ? "✅ Đang chạy" : "⏸️ Tạm dừng"}\n` +
      `⏰ Chu kỳ đăng: mỗi *${config.publishIntervalMinutes} phút*`
    );
  });

  // ─── /checkban ───────────────────────────────────────────────────────────
  bot.onText(/\/checkban/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    await reply(msg.chat.id, `🔍 Đang kiểm tra trạng thái Shadowban cho @0xFly_...`);
    
    try {
      const status = await checkBanNow();
      if (!status) {
        await reply(msg.chat.id, `❌ Không thể kết nối tới API kiểm tra Shadowban.`);
        return;
      }

      const getIcon = (val: boolean) => val ? "🔴 BỊ BAN" : "🟢 SẠCH";
      
      let report = `🛡️ *Kết quả kiểm tra Shadowban (@0xFly_):*\n\n` +
        `• Search Ban: ${getIcon(status.search_ban)}\n` +
        `• Search Suggestion Ban: ${getIcon(status.search_suggestion_ban)}\n` +
        `• Ghost Ban: ${getIcon(status.ghost_ban)}\n` +
        `• Reply Deboosting: ${getIcon(status.reply_deboosting)}\n\n`;

      if (status.is_banned) {
        report += `⚠️ *Trạng thái:* Đang bị Shadowban!\n` +
          `🛡️ *Hệ thống:* Đã kích hoạt Safe Mode (Giảm tần suất, xóa hashtag).`;
      } else {
        report += `✅ *Trạng thái:* Tài khoản hoàn toàn sạch!`;
      }

      await reply(msg.chat.id, report);
    } catch (err: any) {
      await reply(msg.chat.id, `❌ Lỗi khi kiểm tra: ${err.message}`);
    }
  });

  // ─── /addchannel ─────────────────────────────────────────────────────────
  bot.onText(/\/addchannel (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from?.id)) return;
    const url = match?.[1]?.trim();
    if (!url) { await reply(msg.chat.id, "❌ Cú pháp: `/addchannel <url>`"); return; }

    const channelsFile = "channels.txt";
    const existing = fs.existsSync(channelsFile) ? fs.readFileSync(channelsFile, "utf-8") : "";
    if (existing.includes(url)) { await reply(msg.chat.id, "⚠️ Kênh này đã có rồi!"); return; }

    fs.appendFileSync(channelsFile, url + "\n");
    await reply(msg.chat.id, `✅ Đã thêm kênh!\nDùng /crawlnow để tải ngay.`);
  });

  // ─── /removechannel ──────────────────────────────────────────────────────
  bot.onText(/\/removechannel (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from?.id)) return;
    const url = match?.[1]?.trim();
    if (!url) return;
    const channelsFile = "channels.txt";
    if (!fs.existsSync(channelsFile)) return;
    const lines = fs.readFileSync(channelsFile, "utf-8").split("\n").filter(l => !l.includes(url));
    fs.writeFileSync(channelsFile, lines.join("\n"));
    await reply(msg.chat.id, `✅ Đã xóa kênh`);
  });

  // ─── /channels ───────────────────────────────────────────────────────────
  bot.onText(/\/channels/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const channelsFile = "channels.txt";
    const channels = fs.existsSync(channelsFile)
      ? fs.readFileSync(channelsFile, "utf-8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))
      : [];

    if (channels.length === 0) {
      await reply(msg.chat.id, "📭 Chưa có kênh nào. Dùng /addchannel để thêm."); return;
    }
    await reply(msg.chat.id,
      `📋 *Danh sách ${channels.length} kênh:*\n\n` +
      channels.map((c, i) => `${i + 1}. ${c}`).join("\n")
    );
  });

  // ─── /crawlnow ───────────────────────────────────────────────────────────
  bot.onText(/\/crawlnow/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    await reply(msg.chat.id, `⏳ Đang tải batch 10 video từ mỗi kênh...\n_Có thể mất vài phút_`);
    try {
      await downloadAllChannels(10); // Gọi hàm downloadAllChannels đã export từ scheduler
      const stats = await getVideoStats();
      await reply(msg.chat.id,
        `✅ Tải xong!\n📦 Chờ đăng: *${stats.ready + stats.pending}* video\n💾 Dung lượng: ${getDiskUsage()}`
      );
    } catch (err: any) {
      await reply(msg.chat.id, `❌ Lỗi khi crawl: ${err.message}`);
    }
  });

  // ─── /add <url> ──────────────────────────────────────────────────────────
  bot.onText(/\/add (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from?.id)) return;
    const url = match?.[1]?.trim();
    if (!url) return;
    await reply(msg.chat.id, `⏳ Đang tải: ${url}`);
    const ok = await downloadOne(url);
    await reply(msg.chat.id, ok ? `✅ Đã thêm vào kho!` : `❌ Tải thất bại`);
  });

  // ─── /cleanup ────────────────────────────────────────────────────────────
  bot.onText(/\/cleanup/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const deleted = await cleanupPublishedVideos();
    await reply(msg.chat.id,
      `🗑️ Đã xóa *${deleted}* file video đã đăng\n💾 Dung lượng còn lại: ${getDiskUsage()}`
    );
  });

  // ─── /queue ──────────────────────────────────────────────────────────────
  bot.onText(/\/queue/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const queue = await db.videoLibrary.findMany({
      where: { status: { in: ["ready", "pending_caption"] } },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    if (queue.length === 0) {
      await reply(msg.chat.id, "📭 Hàng đợi trống. Dùng /crawlnow để tải thêm."); return;
    }
    const lines = queue.map((v, i) => {
      const icon = v.status === "ready" ? "✅" : "⏳";
      return `${icon} ${i + 1}. ${(v.title || "Untitled").substring(0, 45)}`;
    });
    await reply(msg.chat.id, `📋 *Hàng đợi:*\n✅=sẵn sàng | ⏳=chờ caption\n\n` + lines.join("\n"));
  });

  // ─── /recent ─────────────────────────────────────────────────────────────
  bot.onText(/\/recent/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const recent = await db.videoLibrary.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 5,
    });
    if (recent.length === 0) { await reply(msg.chat.id, "Chưa có bài nào được đăng"); return; }
    const lines = recent.map(v =>
      `• ${(v.title || "Untitled").substring(0, 40)}\n` +
      `  🕐 ${v.publishedAt?.toLocaleString("vi-VN") || "?"}\n` +
      `  🔗 ${v.tweetId ? `https://x.com/i/status/${v.tweetId}` : "N/A"}`
    );
    await reply(msg.chat.id, `📤 *Tweet gần đây:*\n\n` + lines.join("\n\n"));
  });

  // ─── /pause & /resume ─────────────────────────────────────────────────────
  bot.onText(/\/pause/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    isPublishing = false;
    await reply(msg.chat.id, "⏸️ Đã tạm dừng auto-publish");
  });

  bot.onText(/\/resume/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    isPublishing = true;
    await reply(msg.chat.id, "▶️ Đã bật lại auto-publish");
  });

  // ─── /postnow ────────────────────────────────────────────────────────────
  bot.onText(/\/postnow/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const result = await triggerPublishNow();
    await reply(msg.chat.id, result);
  });

  // ─── /schedule ───────────────────────────────────────────────────────────
  bot.onText(/\/schedule/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const interval = config.publishIntervalMinutes;
    const s1h = config.publishSlot1Hour;
    const s1v = config.publishSlot1Videos;
    const s2h = config.publishSlot2Hour;
    const s2v = config.publishSlot2Videos;

    const slot1Times = Array.from({ length: s1v }, (_, i) => {
      const totalMin = s1h * 60 + i * interval;
      const h = Math.floor(totalMin / 60).toString().padStart(2, "0");
      const m = (totalMin % 60).toString().padStart(2, "0");
      return `${h}:${m}`;
    });

    const slot2Times = Array.from({ length: s2v }, (_, i) => {
      const totalMin = s2h * 60 + i * interval;
      const h = Math.floor(totalMin / 60).toString().padStart(2, "0");
      const m = (totalMin % 60).toString().padStart(2, "0");
      return `${h}:${m}`;
    });

    await reply(
      msg.chat.id,
      `⏰ *Lịch đăng bài hiện tại:*\n\n` +
      `☀️ *Khung sáng* (${s1v} video):\n` +
      slot1Times.map(t => `  📤 ${t}`).join("\n") + "\n\n" +
      `🌙 *Khung tối* (${s2v} video):\n` +
      slot2Times.map(t => `  📤 ${t}`).join("\n") + "\n\n" +
      `⏱️ Cách nhau: *${interval} phút*\n\n` +
      `_Chỉnh trong file .env rồi restart bot để thay đổi_`
    );
  });

  // ─── /addig <url> (video lẻ Instagram) ──────────────────────────────────
  bot.onText(/\/addig (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from?.id)) return;
    const url = match?.[1]?.trim();
    if (!url) {
      await reply(msg.chat.id, "❌ Cú pháp: `/addig <url_video>`\nVí dụ: `/addig https://www.instagram.com/reel/xxx`");
      return;
    }
    await reply(msg.chat.id, `⏳ Đang tải video Instagram...`);
    const ok = await downloadInstagramOne(url);
    await reply(
      msg.chat.id,
      ok
        ? `✅ Đã thêm vào kho! AI đang tạo caption...`
        : `❌ Tải thất bại!\n\n💡 Đảm bảo đã đăng nhập Instagram trên Chrome`
    );
  });

  // ─── /crawlig <profile> (full profile Instagram) ─────────────────────────
  bot.onText(/\/crawlig (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from?.id)) return;
    const input = match?.[1]?.trim();
    if (!input) {
      await reply(
        msg.chat.id,
        "❌ Cú pháp:\n" +
        "`/crawlig @username`\n" +
        "`/crawlig https://www.instagram.com/username/`"
      );
      return;
    }
    await reply(msg.chat.id, `⏳ Đang quét profile Instagram: ${input}\n_Có thể mất vài phút..._`);
    try {
      const count = await downloadInstagramProfile(input, 10);
      const stats = await getVideoStats();
      await reply(
        msg.chat.id,
        `✅ Tải xong!\n` +
        `📦 Đã tải: *${count}* video mới\n` +
        `📋 Chờ đăng: *${stats.ready + stats.pending}* video\n` +
        `💾 Dung lượng: ${getDiskUsage()}`
      );
    } catch (err: any) {
      await reply(msg.chat.id, `❌ Lỗi: ${err.message}\n\n💡 Đảm bảo đã đăng nhập Instagram trên Chrome`);
    }
  });

  // ─── /retry ───────────────────────────────────────────────────────────────
  bot.onText(/\/retry/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    const count = await db.videoLibrary.updateMany({
      where: { status: "failed", localPath: { not: "" } },
      data: { status: "pending_caption" },
    });
    await reply(msg.chat.id, `🔄 Đã đưa ${count.count} video vào hàng đợi lại`);
  });

  bot.on("polling_error", (err) => logger.error(`Polling error: ${err.message}`));

  return bot;
}

export function getPublishingStatus() { return isPublishing; }
