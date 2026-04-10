// src/downloader/channel-downloader.ts
// Tải full kênh YouTube / Douyin theo batch
// v2.1: Thêm maskVideo() sau khi tải xong — đồng bộ với watcher.ts

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import { maskVideo } from "../utils/video-processor";
import db from "../db";

const execAsync = promisify(exec);
const logger = createLogger("ChannelDL");

const HISTORY_FILE = "data/downloaded-history.txt";
const BATCH_SIZE = 10;

function getYoutubeCookieFlag(): string {
  if (config.youtubeCookieFile && fs.existsSync(config.youtubeCookieFile)) {
    logger.info(`Dung cookie file: ${config.youtubeCookieFile}`);
    return `--cookies "${config.youtubeCookieFile}"`;
  }
  return "";
}

function loadHistory(): Set<string> {
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  return new Set(fs.readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean));
}

function saveToHistory(videoId: string) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, videoId + "\n");
}

async function getChannelVideoIds(channelUrl: string): Promise<Array<{ id: string; title: string; url: string }>> {
  try {
    logger.info(`Dang quet kenh: ${channelUrl}`);
    const cookie = getYoutubeCookieFlag();
    const { stdout } = await execAsync(
      `yt-dlp --flat-playlist --dump-json ${cookie} --no-warnings "${channelUrl}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    return stdout.trim().split("\n").filter(Boolean).map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id as string,
          title: (info.title || "Untitled") as string,
          url: (info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`) as string,
        };
      } catch { return null; }
    }).filter(Boolean) as Array<{ id: string; title: string; url: string }>;
  } catch (err: any) {
    logger.error(`Loi quet kenh: ${err.message}`);
    return [];
  }
}

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
      `--merge-output-format mp4 --no-playlist --socket-timeout 60 --retries 3 ` +
      `${cookie} --no-warnings -o "${filePath}" "${videoUrl}"`
    );
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / 1024 / 1024;
    if (sizeMB > config.maxVideoSizeMB) {
      logger.warn(`File qua lon (${sizeMB.toFixed(0)}MB), dang compress...`);
      await execAsync(
        `ffmpeg -i "${filePath}" -vcodec libx264 -crf 28 -preset fast ` +
        `-acodec aac -b:a 128k "${filePath}.tmp.mp4" -y`
      );
      fs.unlinkSync(filePath);
      fs.renameSync(`${filePath}.tmp.mp4`, filePath);
    }
    return filePath;
  } catch (err: any) {
    logger.error(`Loi tai ${videoId}: ${err.message}`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return null;
  }
}

// ─── Helper: mask video sau khi tải, trả về path cuối cùng ───────────────────
async function maskAndRegister(
  rawPath: string,
  videoId: string,
  title: string,
  originalUrl: string,
  source: string
): Promise<void> {
  const maskedPath = rawPath.replace(".mp4", "_masked.mp4");

  logger.info(`Dang mask video: ${videoId}`);
  const ok = await maskVideo(rawPath, maskedPath);

  const finalPath = ok ? maskedPath : rawPath;

  // Xóa file gốc nếu mask thành công để tiết kiệm dung lượng
  if (ok && fs.existsSync(rawPath)) {
    try { fs.unlinkSync(rawPath); } catch {}
  }

  const stats = fs.statSync(finalPath);

  await db.videoLibrary.upsert({
    where: { originalUrl },
    update: {
      status: "pending_caption",
      localPath: finalPath,
      title,
      fileSize: stats.size,
    },
    create: {
      source,
      originalUrl,
      localPath: finalPath,
      title,
      fileSize: stats.size,
      status: "pending_caption",
    },
  });

  logger.success(`Registered (masked=${ok}): ${title.substring(0, 50)}`);
}

export async function downloadChannelBatch(
  channelUrl: string,
  batchSize: number = BATCH_SIZE
): Promise<number> {
  const history = loadHistory();
  const allVideos = await getChannelVideoIds(channelUrl);
  if (allVideos.length === 0) return 0;

  const newVideos = allVideos.filter(v => !history.has(v.id));
  logger.info(`${newVideos.length} video chua tai (${history.size} da co)`);
  if (newVideos.length === 0) { logger.info("Kenh nay da tai het!"); return 0; }

  const batch = newVideos.slice(0, batchSize);
  logger.info(`Bat dau tai batch ${batch.length} video...`);

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
        logger.warn(`Bo qua (${info.duration}s): ${video.title}`);
        saveToHistory(video.id);
        continue;
      }
    } catch {}

    const rawPath = await downloadVideo(video.url, video.id);
    if (rawPath) {
      // ✅ Gọi maskVideo ngay sau khi tải xong
      await maskAndRegister(
        rawPath,
        video.id,
        video.title,
        video.url,
        channelUrl.includes("douyin") ? "douyin" : "youtube"
      );
      saveToHistory(video.id);
      downloaded++;
    } else {
      saveToHistory(video.id);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  logger.success(`Batch xong: ${downloaded}/${batch.length} video`);
  return downloaded;
}

export async function downloadAllChannels(batchSize: number = BATCH_SIZE): Promise<void> {
  const channelsFile = "channels.txt";
  if (!fs.existsSync(channelsFile)) { logger.error(`Khong tim thay ${channelsFile}!`); return; }

  const channels = fs.readFileSync(channelsFile, "utf-8")
    .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));

  logger.info(`Tim thay ${channels.length} kenh can tai`);
  for (const channelUrl of channels) {
    logger.info(`\n=== Dang xu ly kenh: ${channelUrl} ===`);
    await downloadChannelBatch(channelUrl, batchSize);
    await new Promise(r => setTimeout(r, 5000));
  }
}

export async function cleanupPublishedVideos(): Promise<number> {
  const published = await db.videoLibrary.findMany({
    where: { status: "published", localPath: { not: "" } },
  });
  let deleted = 0;
  for (const video of published) {
    if (video.localPath && fs.existsSync(video.localPath)) {
      try {
        fs.unlinkSync(video.localPath);
        await db.videoLibrary.update({ where: { id: video.id }, data: { localPath: "" } });
        deleted++;
      } catch { logger.error(`Khong xoa duoc: ${video.localPath}`); }
    }
  }
  if (deleted > 0) logger.success(`Da xoa ${deleted} file video da dang`);
  return deleted;
}

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
