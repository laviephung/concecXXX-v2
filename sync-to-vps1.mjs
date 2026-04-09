#!/usr/bin/env node
// sync-to-vps.mjs
// Chạy trên máy Windows: tải video từ YouTube → upload lên VPS qua SCP
// Đã cập nhật: Khớp với thư mục /root/concecXXX-v2 trên VPS, và đẩy kèm file .info.json

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const execAsync = promisify(exec);

// ══════════════════════════════════════════════════════════
//  ⚙️  CẤU HÌNH — chỉnh lại cho đúng với máy bạn
// ══════════════════════════════════════════════════════════

const CONFIG = {
  // Thư mục tạm lưu video trên máy Win trước khi upload
  localTempDir: "C:\\contentX-temp",

  // Thông tin SSH vào VPS
  vpsUser: "root",
  vpsHost: "84.247.175.137",          // ← đổi thành IP VPS của bạn
  vpsPort: 22,
  sshKeyPath: "C:\\Users\\phung\\.ssh\\id_ed25519",                   // ← để trống nếu dùng password, hoặc điền path key

  // Thư mục video trên VPS (Khớp với concecXXX-v2)
  vpsVideoDir: "/root/concecXXX-v2/data/videos",

  // File history trên VPS (để sync tránh tải lại)
  vpsHistoryFile: "/root/concecXXX-v2/data/downloaded-history.txt",

  // File channels.txt trên VPS (đọc danh sách kênh)
  vpsChannelsFile: "/root/concecXXX-v2/channels.txt",

  // Số video tải mỗi lần chạy
  batchSize: 10,

  // Giới hạn thời lượng video (giây)
  maxDurationSec: 140,
};

// ══════════════════════════════════════════════════════════

const log = {
  info:    (m) => console.log(`\x1b[36m[INFO]\x1b[0m  ${m}`),
  ok:      (m) => console.log(`\x1b[32m[OK]\x1b[0m    ✅ ${m}`),
  warn:    (m) => console.log(`\x1b[33m[WARN]\x1b[0m  ⚠️  ${m}`),
  error:   (m) => console.log(`\x1b[31m[ERR]\x1b[0m   ❌ ${m}`),
  section: (m) => console.log(`\n\x1b[1m═══ ${m} ═══\x1b[0m`),
};

// SSH helper
function ssh(cmd) {
  const keyFlag = CONFIG.sshKeyPath ? `-i "${CONFIG.sshKeyPath}"` : "";
  return execAsync(
    `ssh ${keyFlag} -p ${CONFIG.vpsPort} -o StrictHostKeyChecking=no ${CONFIG.vpsUser}@${CONFIG.vpsHost} "${cmd}"`,
    { timeout: 30000 }
  );
}

// SCP upload 1 file lên VPS
function scpUpload(localFile, remoteDir) {
  const keyFlag = CONFIG.sshKeyPath ? `-i "${CONFIG.sshKeyPath}"` : "";
  return execAsync(
    `scp ${keyFlag} -P ${CONFIG.vpsPort} -o StrictHostKeyChecking=no "${localFile}" ${CONFIG.vpsUser}@${CONFIG.vpsHost}:"${remoteDir}/"`,
    { timeout: 300000 } // 5 phút timeout cho file lớn
  );
}

// ── Đọc history từ VPS ────────────────────────────────────────────────────────
async function fetchHistory() {
  try {
    const { stdout } = await ssh(`cat ${CONFIG.vpsHistoryFile}`);
    const ids = stdout.trim().split("\n").filter(Boolean);
    log.info(`Đã tải ${ids.length} video ID từ history VPS`);
    return new Set(ids);
  } catch (err) {
    log.warn(`Không đọc được history VPS: ${err.message?.split("\n")[0]}`);
    return new Set();
  }
}

// ── Đọc danh sách kênh từ VPS ─────────────────────────────────────────────────
async function fetchChannels() {
  try {
    const { stdout, stderr } = await ssh(`cat ${CONFIG.vpsChannelsFile}`);
    const channels = stdout.trim().split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));
    log.info(`Tìm thấy ${channels.length} kênh trong channels.txt VPS`);
    return channels;
  } catch (err) {
    log.error(`Lỗi đọc channels.txt: ${err.message}`);
    return [];
  }
}
// ── Lấy danh sách video ID từ kênh ───────────────────────────────────────────
async function getChannelVideos(channelUrl) {
  log.info(`Đang quét kênh: ${channelUrl}`);
  try {
    const { stdout } = await execAsync(
      `yt-dlp --flat-playlist --dump-json --playlist-end 5000 --no-warnings "${channelUrl}"`,
      { maxBuffer: 50 * 1024 * 1024, timeout: 60000 }
    );
    return stdout.trim().split("\n").filter(Boolean).map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id,
          title: info.title || "Untitled",
          url: info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
        };
      } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    log.error(`Lỗi quét kênh: ${err.message?.split("\n")[0]}`);
    return [];
  }
}

// ── Tải 1 video về máy local ──────────────────────────────────────────────────
async function downloadVideo(video) {
  const videoFileName = `${video.id}.mp4`;
  const infoJsonFileName = `${video.id}.info.json`;
  const videoPath = path.join(CONFIG.localTempDir, videoFileName);
  const infoJsonPath = path.join(CONFIG.localTempDir, infoJsonFileName);

  // Kiểm tra duration trước
  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-download --no-warnings "${video.url}"`, // Lấy info mà không tải
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout.trim());
    if (info.duration > CONFIG.maxDurationSec) {
      log.warn(`Bỏ qua (${info.duration}s > ${CONFIG.maxDurationSec}s): ${video.title}`);
      return null;
    }
  } catch { /* cứ thử tải */ }

  try {
    // Thêm --write-info-json để tải cả metadata
    await execAsync(
      `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" ` +
      `--merge-output-format mp4 --no-playlist --socket-timeout 60 --retries 3 --no-warnings ` +
      `--write-info-json ` + // <-- Thêm dòng này để xuất info.json
      `-o "${videoPath}" "${video.url}"`, // Output video file
      { timeout: 300000 }
    );

    if (!fs.existsSync(videoPath) || !fs.existsSync(infoJsonPath)) { // Kiểm tra cả 2 file
        log.error(`Không tìm thấy file video hoặc info.json sau khi tải ${video.id}.`);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (fs.existsSync(infoJsonPath)) fs.unlinkSync(infoJsonPath);
        return null;
    }

    const videoSizeMB = fs.statSync(videoPath).size / 1024 / 1024;
    const infoSizeKB = fs.statSync(infoJsonPath).size / 1024;
    log.ok(`Tải xong: ${video.title.substring(0, 50)} (${videoSizeMB.toFixed(1)} MB video, ${infoSizeKB.toFixed(1)} KB info)`);
    return { videoPath, infoJsonPath };
  } catch (err) {
    log.error(`Tải thất bại ${video.id}: ${err.message?.split("\n")[0]}`);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(infoJsonPath)) fs.unlinkSync(infoJsonPath);
    return null;
  }
}

// ── Upload video và metadata lên VPS ──────────────────────────────────────────
async function uploadToVps(localVideoPath, localInfoJsonPath, video) {
  log.info(`Đang upload ${path.basename(localVideoPath)} và ${path.basename(localInfoJsonPath)} lên VPS...`);
  try {
    // 1. SCP file video lên VPS
    await scpUpload(localVideoPath, CONFIG.vpsVideoDir);
    // 2. SCP file info.json lên VPS
    await scpUpload(localInfoJsonPath, CONFIG.vpsVideoDir);

    // 3. Thêm vào history VPS (tránh tải lại)
    await ssh(`echo "${video.id}" >> ${CONFIG.vpsHistoryFile}`);

    // 4. Xóa file local
    fs.unlinkSync(localVideoPath);
    fs.unlinkSync(localInfoJsonPath);
    log.ok(`Upload xong: ${video.title.substring(0, 50)}`);
    return true;
  } catch (err) {
    log.error(`Upload thất bại: ${err.message?.split("\n")[0]}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║   📥 contentX Local Sync → VPS          ║
║   Tải video Win → Upload VPS tự động    ║
║   (Kèm metadata .info.json)              ║
╚══════════════════════════════════════════╝
`);

  // Tạo thư mục temp local
  if (!fs.existsSync(CONFIG.localTempDir)) {
    fs.mkdirSync(CONFIG.localTempDir, { recursive: true });
  }

  // Test kết nối VPS
  log.section("Kiểm tra kết nối VPS");
  try {
    await ssh("echo OK");
    log.ok(`Kết nối VPS ${CONFIG.vpsHost} thành công`);
  } catch {
    log.error(`Không kết nối được VPS ${CONFIG.vpsHost}! Kiểm tra lại IP/SSH key/password`);
    process.exit(1);
  }

  // Đảm bảo thư mục video tồn tại trên VPS
  await ssh(`mkdir -p ${CONFIG.vpsVideoDir}`);

  // Lấy history & channels từ VPS
  log.section("Đồng bộ dữ liệu từ VPS");
  const history = await fetchHistory();
  const channels = await fetchChannels();

  if (channels.length === 0) {
    log.error("Không có kênh nào để tải!");
    process.exit(0);
  }

  // Tải từng kênh
  let totalDownloaded = 0;

  for (const channelUrl of channels) {
    log.section(`Kênh: ${channelUrl}`);

    const allVideos = await getChannelVideos(channelUrl);
    const newVideos = allVideos.filter(v => !history.has(v.id));
    log.info(`${newVideos.length} video mới (${allVideos.length - newVideos.length} đã có)`);

    const batch = newVideos.slice(0, CONFIG.batchSize);

    for (let i = 0; i < batch.length; i++) {
      const video = batch[i];
      log.info(`[${i + 1}/${batch.length}] ${video.title.substring(0, 60)}`);

      const downloadResult = await downloadVideo(video);

      if (downloadResult) {
        const { videoPath, infoJsonPath } = downloadResult;
        const ok = await uploadToVps(videoPath, infoJsonPath, video);
        if (ok) {
          history.add(video.id);
          totalDownloaded++;
        }
      } else {
        // Đánh dấu history để không thử lại video bị lỗi hoặc bị bỏ qua
        await ssh(`echo "${video.id}" >> ${CONFIG.vpsHistoryFile}`);
        history.add(video.id);
      }

      // Nghỉ 2s giữa các video
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  log.section("Hoàn tất");
  log.ok(`Đã upload ${totalDownloaded} video và metadata lên VPS thành công!`);
  log.info(`Video đã vào hàng đợi pending_caption trên VPS, bot sẽ tự xử lý tiếp.`);
}

main().catch(err => {
  log.error(`Lỗi: ${err.message}`);
  process.exit(1);
});
