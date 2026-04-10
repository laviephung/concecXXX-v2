// src/utils/video-processor.ts
// Xử lý video: Che logo cũ, chèn overlay thương hiệu @0xFly_, chống copyright
<<<<<<< HEAD
// v3.9: Fix lỗi video output bị hỏng (corrupted) do FFmpeg filtergraph
=======
// v4.0: Port từ Windows local đã test OK → Ubuntu VPS
>>>>>>> d4d903cb8c2e42e7acdb7bb6aa3bcc5e721c95e2

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { createLogger } from "./logger";

const execAsync = promisify(exec);
const logger = createLogger("VideoProcessor");

// ─── Font path Ubuntu VPS ─────────────────────────────────────────────────────
const UBUNTU_FONT_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
];

function getAvailableFont(): string {
  for (const fontPath of UBUNTU_FONT_PATHS) {
    if (fs.existsSync(fontPath)) {
      logger.info(`Font: ${fontPath}`);
      return fontPath;
    }
  }
  logger.warn("Khong tim thay font! Chay: apt-get install -y fonts-dejavu-core && fc-cache -fv");
  return UBUNTU_FONT_PATHS[0]; // fallback, bot khong crash
}

// ─── Linux font path: KHÔNG có drive letter, chỉ cần giữ nguyên ──────────────
// (Windows cần strip "C:", Linux path /usr/share/... dùng thẳng được)
function escapeFontPath(p: string): string {
  return p; // Linux path không cần xử lý gì thêm
}

// ─── Escape nội dung text cho ffmpeg drawtext ─────────────────────────────────
// Đây là fix đã test OK trên Windows — giữ nguyên logic
function escText(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

// ─── Lấy kích thước video ─────────────────────────────────────────────────────
async function getVideoDimensions(inputPath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`
    );
    const [width, height] = stdout.trim().split("x").map(Number);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

// ─── Kiểm tra font khi bot khởi động ─────────────────────────────────────────
export async function checkFontInstalled(): Promise<void> {
  const font = getAvailableFont();
  if (!fs.existsSync(font)) {
    logger.warn("Font chua cai! Chay tren VPS:");
    logger.warn("  apt-get install -y fonts-dejavu-core");
    logger.warn("  fc-cache -fv");
  } else {
    logger.success(`Font OK: ${font}`);
  }
}

// ─── Hàm chính ────────────────────────────────────────────────────────────────
// Filter pipeline (giữ nguyên thứ tự đã test OK trên Windows):
//   1. drawbox trên  → drawtext trên
//   2. drawbox dưới  → drawtext banner → drawtext @0xFly_
//   3. scale + crop (zoom 2%)
//   4. hue shift ngẫu nhiên
//   5. speed 1.03x (video + audio qua filter_complex)

export async function maskVideo(
  inputPath: string,
  outputPath: string,
  topText: string = "FOLLOW @0xFly_ FOR MORE!",
  bottomBannerText: string = "TAG A FRIEND WHO NEEDS TO SEE THIS"
): Promise<boolean> {
  try {
    logger.info(`Dang xu ly: ${path.basename(inputPath)}`);

    const dims = await getVideoDimensions(inputPath);
    const h = dims?.height || 1920;
    const w = dims?.width  || 1080;

    const rawFont = getAvailableFont();
    const font    = escapeFontPath(rawFont);

<<<<<<< HEAD
    // Tính toán kích thước
    const maskH = Math.floor(h * 0.15);           // Chiều cao dải đen (15%)
    const topFontSize = Math.floor(h * 0.038);    // Font size text trên
    const bannerFontSize = Math.floor(h * 0.032); // Font size text dưới (banner)
    const brandFontSize = Math.floor(h * 0.045);  // Font size @0xFly_ (to hơn, dễ thấy)
=======
    const maskH = Math.floor(h * 0.15);
>>>>>>> d4d903cb8c2e42e7acdb7bb6aa3bcc5e721c95e2

    // Random hue shift -5 đến +5
    const hueShift = (Math.random() * 10 - 5).toFixed(1);
    const speed    = 1.03;

<<<<<<< HEAD
    // ─── Escape text cho ffmpeg drawtext ─────────────────────────────────────
    // ffmpeg drawtext dùng ":" và "'" làm ký tự đặc biệt — phải escape
    // '@' và '_' thì KHÔNG cần escape nhưng cần bọc trong dấu ' để an toàn
    const escapeDrawtext = (text: string): string =>
      text
        .replace(/\\/g, "\\\\")
        .replace(/\'/g, "\\\'")
        .replace(/:/g, "\\:");

    const topTextEsc = escapeDrawtext(topText);
    const bannerTextEsc = escapeDrawtext(bottomBannerText);

    // @0xFly_ — escape cẩn thận, đây là nguyên nhân bug cũ
    const brandText = escapeDrawtext("@0xFly_");

    // ─── Build filtergraph ────────────────────────────────────────────────────
    // Mỗi filter cách nhau bằng dấu phẩy, không xuống dòng (tránh shell issue)
    // drawbox phải đến TRƯỚC drawtext để text hiện trên nền đen
    const videoFilters = [
      // 0. Tăng tốc độ video (setpts) - đặt đầu tiên để tránh xung đột
      `setpts=PTS/1.03`,
      // 1a. Dải đen trên
=======
    const top    = escText(topText);
    const banner = escText(bottomBannerText);
    const brand  = escText("@0xFly_");

    // Filter string — giữ nguyên syntax đã chạy OK trên Windows
    const filters = [
>>>>>>> d4d903cb8c2e42e7acdb7bb6aa3bcc5e721c95e2
      `drawbox=y=0:color=black@1:width=iw:height=${maskH}:t=fill`,
      `drawtext=fontfile='${font}':text='${top}':fontcolor=white:x=(w-text_w)/2:y=20`,
      `drawbox=y=ih-${maskH}:color=black@1:width=iw:height=${maskH}:t=fill`,
      `drawtext=fontfile='${font}':text='${banner}':fontcolor=yellow:x=(w-text_w)/2:y=h-${maskH}+20`,
      `drawtext=fontfile='${font}':text='${brand}':fontcolor=white:x=w-text_w-20:y=h-text_h-20`,
      `scale=${Math.floor(w * 1.02)}:${Math.floor(h * 1.02)}`,
      `crop=${w}:${h}`,
      `hue=h=${hueShift}`,
    ].join(",");

<<<<<<< HEAD
    // Audio filter: speed 1.03x để phá audio fingerprint
    const audioFilter = `atempo=1.03`;

    const ffmpegCmd = [
      `ffmpeg`,
      `-i "${inputPath}"`,
      `-vf "${videoFilters}"`,
      `-af "${audioFilter}"`,
=======
    // Dùng filter_complex để sync video + audio speed trong 1 pass
    const cmd = [
      `ffmpeg`,
      `-i "${inputPath}"`,
      `-filter_complex "[0:v]${filters},setpts=PTS/${speed}[v];[0:a]atempo=${speed}[a]"`,
      `-map "[v]"`,
      `-map "[a]"`,
>>>>>>> d4d903cb8c2e42e7acdb7bb6aa3bcc5e721c95e2
      `-c:v libx264`,
      `-preset fast`,
      `-crf 23`,
      `-c:a aac`,
      `-b:a 128k`,
      `-movflags +faststart`,
      `-y "${outputPath}"`,
    ].join(" ");

    logger.info(`Running ffmpeg (hue=${hueShift}deg)...`);
    await execAsync(cmd, { maxBuffer: 200 * 1024 * 1024 });

    if (!fs.existsSync(outputPath)) {
      logger.error("ffmpeg xong nhung khong co file output");
      return false;
    }

    const inMB  = (fs.statSync(inputPath).size  / 1024 / 1024).toFixed(1);
    const outMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
    logger.success(`Xong: ${path.basename(outputPath)} | ${inMB}MB -> ${outMB}MB | hue=${hueShift}deg`);
    return true;

  } catch (err: any) {
    logger.error(`Loi xu ly video: ${err.message}`);
    if (err.stderr) {
      logger.error(`ffmpeg stderr: ${err.stderr.substring(0, 600)}`);
    }
    return false;
  }
}
