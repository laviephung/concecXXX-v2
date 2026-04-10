// src/downloader/instagram-downloader.ts
// Tải video từ Instagram (Reels + Posts)
// v2.1: Thêm maskVideo() sau khi tải xong — đồng bộ với channel-downloader

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import { maskVideo } from "../utils/video-processor";
import db from "../db";

const execAsync = promisify(exec);
const logger = createLogger("InstagramDL");

function getInstagramCookieFlag(): string {
  if (config.instagramCookieFile && fs.existsSync(config.instagramCookieFile)) {
    logger.info(`Dung cookie file: ${config.instagramCookieFile}`);
    return `--cookies "${config.instagramCookieFile}"`;
  }
  return `--cookies-from-browser chrome`;
}

async function getVideoInfo(url: string) {
  const cookie = getInstagramCookieFlag();
  try {
    const { stdout } = await execAsync(
      `yt-dlp ${cookie} --dump-json --no-download --no-warnings "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout.trim());
    return {
      id: info.id as string,
      title: (info.title || info.description || "Instagram video") as string,
      duration: (info.duration || 0) as number,
    };
  } catch { return null; }
}

// ─── Helper: mask video sau khi tải, trả về path cuối cùng ───────────────────
async function maskAndSave(
  rawPath: string,
  videoId: string,
  title: string,
  originalUrl: string,
  duration: number
): Promise<void> {
  const maskedPath = rawPath.replace(".mp4", "_masked.mp4");

  logger.info(`Dang mask video: ${videoId}`);
  const ok = await maskVideo(rawPath, maskedPath);

  const finalPath = ok ? maskedPath : rawPath;

  if (ok && fs.existsSync(rawPath)) {
    try { fs.unlinkSync(rawPath); } catch {}
  }

  const stats = fs.statSync(finalPath);

  await db.videoLibrary.upsert({
    where: { originalUrl },
    update: { status: "pending_caption", localPath: finalPath, title, duration, fileSize: stats.size },
    create: {
      source: "instagram",
      originalUrl,
      localPath: finalPath,
      title,
      duration,
      fileSize: stats.size,
      status: "pending_caption",
    },
  });

  logger.success(`Registered (masked=${ok}): ${title.substring(0, 50)}`);
}

export async function downloadInstagramOne(url: string): Promise<boolean> {
  url = url.trim();
  if (!url) return false;

  const existing = await db.videoLibrary.findUnique({ where: { originalUrl: url } });
  if (existing && existing.status !== "failed") {
    logger.info(`Da co san, bo qua: ${url}`);
    return true;
  }

  logger.info(`Dang lay thong tin: ${url}`);
  const info = await getVideoInfo(url);
  if (!info) {
    logger.error(`Khong lay duoc thong tin: ${url}`);
    return false;
  }
  if (info.duration > config.maxVideoDurationSec) {
    logger.warn(`Video qua dai (${info.duration}s), bo qua`);
    return false;
  }

  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
  }

  const rawPath = path.resolve(path.join(config.videoDir, `ig_${info.id}.mp4`));
  const cookie = getInstagramCookieFlag();

  try {
    logger.info(`Dang tai: ${info.title.substring(0, 60)}`);
    await execAsync(
      `yt-dlp ${cookie} ` +
      `-f "best[height<=720][ext=mp4]/best[height<=720]/best" ` +
      `--merge-output-format mp4 --no-playlist --socket-timeout 60 --retries 3 ` +
      `--no-warnings -o "${rawPath}" "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (!fs.existsSync(rawPath)) throw new Error("File khong ton tai sau tai");

    // ✅ Gọi maskVideo ngay sau khi tải xong
    await maskAndSave(rawPath, info.id, info.title, url, info.duration);
    return true;

  } catch (err: any) {
    logger.error(`Loi tai ${url}: ${err.message}`);
    await db.videoLibrary.upsert({
      where: { originalUrl: url },
      update: { status: "failed" },
      create: { source: "instagram", originalUrl: url, localPath: "", status: "failed" },
    });
    return false;
  }
}

export async function downloadInstagramProfile(
  profileUrl: string,
  batchSize: number = 10
): Promise<number> {
  if (profileUrl.startsWith("@")) {
    profileUrl = `https://www.instagram.com/${profileUrl.slice(1)}/`;
  }

  logger.info(`Dang quet profile: ${profileUrl}`);

  const historyFile = "data/downloaded-history.txt";
  const history = fs.existsSync(historyFile)
    ? new Set(fs.readFileSync(historyFile, "utf-8").split("\n").filter(Boolean))
    : new Set<string>();

  const cookie = getInstagramCookieFlag();

  try {
    const { stdout } = await execAsync(
      `yt-dlp ${cookie} --flat-playlist --dump-json --playlist-end 50 --no-warnings "${profileUrl}"`,
      { maxBuffer: 20 * 1024 * 1024 }
    );

    const videos = stdout.trim().split("\n").filter(Boolean).map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id as string,
          url: (info.webpage_url || info.url) as string,
          title: (info.title || info.description || "Instagram video") as string,
        };
      } catch { return null; }
    }).filter(Boolean) as Array<{ id: string; url: string; title: string }>;

    logger.info(`Tim thay ${videos.length} video tren profile`);

    const newVideos = videos.filter(v => !history.has(`ig_${v.id}`));
    logger.info(`${newVideos.length} video chua tai`);
    if (newVideos.length === 0) { logger.info("Profile nay da tai het!"); return 0; }

    const batch = newVideos.slice(0, batchSize);
    let downloaded = 0;

    for (const video of batch) {
      const ok = await downloadInstagramOne(video.url);
      if (ok) {
        fs.appendFileSync(historyFile, `ig_${video.id}\n`);
        downloaded++;
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    logger.success(`Batch xong: ${downloaded}/${batch.length} video`);
    return downloaded;

  } catch (err: any) {
    logger.error(`Loi quet profile: ${err.message}`);
    if (err.message.includes("login") || err.message.includes("cookie") || err.message.includes("401")) {
      logger.error(`Cookie Instagram khong hop le hoac het han!`);
    }
    return 0;
  }
}
