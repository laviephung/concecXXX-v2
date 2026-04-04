// src/downloader/channel-downloader.ts
// Tải full kênh YouTube / Douyin theo batch
// Sau khi video được đăng lên X → tự động xóa file, tiết kiệm dung lượng

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const execAsync = promisify(exec);
const logger = createLogger("ChannelDL");

const HISTORY_FILE = "data/downloaded-history.txt";
const BATCH_SIZE = 10;

// ─── Lấy cookie flag tự động ─────────────────────────────────────────────────
// Ưu tiên: file cookie (VPS) → không có cookie (local)

function getYoutubeCookieFlag(): string {
  if (config.youtubeCookieFile && fs.existsSync(config.youtubeCookieFile)) {
    logger.info(`Dùng cookie file: ${config.youtubeCookieFile}`);
    return `--cookies "${config.youtubeCookieFile}"`;
  }
  return "";
}

// ─── Đọc/ghi lịch sử ─────────────────────────────────────────────────────────

function loadHistory(): Set<string> {
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  return new Set(fs.readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean));
}

function saveToHistory(videoId: string) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, videoId + "\n");
}

// ─── Lấy danh sách video từ kênh ─────────────────────────────────────────────

async function getChannelVideoIds(channelUrl: string): Promise<Array<{ id: string; title: string; url: string }>> {
  try {
    logger.info(`Đang quét kênh: ${channelUrl}`);
    const cookie = getYoutubeCookieFlag();

    const { stdout } = await execAsync(
      `yt-dlp --flat-playlist --dump-json ${cookie} --no-warnings "${channelUrl}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    const videos = stdout.trim().split("\n").filter(Boolean).map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id as string,
          title: (info.title || "Untitled") as string,
          url: (info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`) as string,
        };
      } catch { return null; }
    }).filter(Boolean) as Array<{ id: string; title: string; url: string }>;

    logger.info(`Tìm thấy ${videos.length} video trên kênh`);
    return videos;
  } catch (err: any) {
    logger.error(`Lỗi quét kênh: ${err.message}`);
    return [];
  }
}

// ─── Tải 1 video ─────────────────────────────────────────────────────────────

async function downloadVideo(videoUrl: string, videoId: string): Promise<string | null> {
  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
  }

  const filePath = path.resolve(path.join(config.videoDir, `${videoId}.mp4`));
  const cookie = getYoutubeCookieFlag();

  try {
    await execAsync(
      `yt-dlp ` +
      `-f "best[height<=720][ext=mp4]/best[height<=720]/best" ` +
      `--merge-output-format mp4 ` +
      `--no-playlist ` +
      `--socket-timeout 60 ` +
      `--retries 3 ` +
      `${cookie} ` +
      `--no-warnings ` +
      `-o "${filePath}" ` +
      `"${videoUrl}"`
    );

    if (!fs.existsSync(filePath)) return null;

    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / 1024 / 1024;

    if (sizeMB > config.maxVideoSizeMB) {
      logger.warn(`File quá lớn (${sizeMB.toFixed(0)}MB), đang compress...`);
      await execAsync(
        `ffmpeg -i "${filePath}" -vcodec libx264 -crf 28 -preset fast ` +
        `-acodec aac -b:a 128k "${filePath}.tmp.mp4" -y`
      );
      fs.unlinkSync(filePath);
      fs.renameSync(`${filePath}.tmp.mp4`, filePath);
    }

    return filePath;
  } catch (err: any) {
    logger.error(`Lỗi tải ${videoId}: ${err.message}`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return null;
  }
}

// ─── Tải 1 batch từ kênh ─────────────────────────────────────────────────────

export async function downloadChannelBatch(
  channelUrl: string,
  batchSize: number = BATCH_SIZE
): Promise<number> {
  const history = loadHistory();
  const allVideos = await getChannelVideoIds(channelUrl);
  if (allVideos.length === 0) return 0;

  const newVideos = allVideos.filter(v => !history.has(v.id));
  logger.info(`${newVideos.length} video chưa tải (${history.size} đã có trong lịch sử)`);

  if (newVideos.length === 0) {
    logger.info("Kênh này đã tải hết rồi!");
    return 0;
  }

  const batch = newVideos.slice(0, batchSize);
  logger.info(`Bắt đầu tải batch ${batch.length} video...`);

  let downloaded = 0;
  const cookie = getYoutubeCookieFlag();

  for (const video of batch) {
    logger.info(`[${downloaded + 1}/${batch.length}] ${video.title.substring(0, 60)}`);

    // Kiểm tra duration trước
    try {
      const { stdout } = await execAsync(
        `yt-dlp --dump-json --no-download ${cookie} --no-warnings "${video.url}"`
      );
      const info = JSON.parse(stdout.trim());
      if (info.duration > config.maxVideoDurationSec) {
        logger.warn(`Bỏ qua (${info.duration}s): ${video.title}`);
        saveToHistory(video.id);
        continue;
      }
    } catch { }

    const filePath = await downloadVideo(video.url, video.id);

    if (filePath) {
      const stats = fs.statSync(filePath);
      await db.videoLibrary.upsert({
        where: { originalUrl: video.url },
        update: { status: "pending_caption", localPath: filePath, title: video.title, fileSize: stats.size },
        create: {
          source: channelUrl.includes("douyin") ? "douyin" : "youtube",
          originalUrl: video.url,
          localPath: filePath,
          title: video.title,
          fileSize: stats.size,
          status: "pending_caption",
        },
      });
      saveToHistory(video.id);
      downloaded++;
      logger.success(`✅ ${video.title.substring(0, 50)}`);
    } else {
      saveToHistory(video.id);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  logger.success(`Batch xong: ${downloaded}/${batch.length} video thành công`);
  return downloaded;
}

// ─── Tải từ nhiều kênh ───────────────────────────────────────────────────────

export async function downloadAllChannels(batchSize: number = BATCH_SIZE): Promise<void> {
  const channelsFile = "channels.txt";
  if (!fs.existsSync(channelsFile)) {
    logger.error(`Không tìm thấy ${channelsFile}!`);
    return;
  }

  const channels = fs.readFileSync(channelsFile, "utf-8")
    .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));

  logger.info(`Tìm thấy ${channels.length} kênh cần tải`);

  for (const channelUrl of channels) {
    logger.info(`\n=== Đang xử lý kênh: ${channelUrl} ===`);
    await downloadChannelBatch(channelUrl, batchSize);
    await new Promise(r => setTimeout(r, 5000));
  }
}

// ─── Xóa file video sau khi đã đăng ──────────────────────────────────────────

export async function cleanupPublishedVideos(): Promise<number> {
  const published = await db.videoLibrary.findMany({
    where: { status: "published", localPath: { not: "" } },
  });

  let deleted = 0;
  for (const video of published) {
    if (video.localPath && fs.existsSync(video.localPath)) {
      try {
        fs.unlinkSync(video.localPath);
        await db.videoLibrary.update({
          where: { id: video.id },
          data: { localPath: "" },
        });
        deleted++;
      } catch {
        logger.error(`Không xóa được: ${video.localPath}`);
      }
    }
  }

  if (deleted > 0) logger.success(`Đã xóa ${deleted} file video đã đăng`);
  return deleted;
}

// ─── Thống kê dung lượng ─────────────────────────────────────────────────────

export function getDiskUsage(): string {
  if (!fs.existsSync(config.videoDir)) return "0 MB";
  const files = fs.readdirSync(config.videoDir);
  const totalBytes = files.reduce((sum, file) => {
    try { return sum + fs.statSync(path.join(config.videoDir, file)).size; }
    catch { return sum; }
  }, 0);
  const mb = totalBytes / 1024 / 1024;
  return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}
