// src/utils/video-processor.ts
// Xử lý video: Che logo cũ, chèn overlay thương hiệu @0xFly_, chống copyright
// v3.9: Fix lỗi video output bị hỏng (corrupted) do FFmpeg filtergraph

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { createLogger } from "./logger";

const execAsync = promisify(exec);
const logger = createLogger("VideoProcessor");

// ─── Font path cho Ubuntu VPS ─────────────────────────────────────────────────
// Thử theo thứ tự ưu tiên — font nào tìm thấy đầu tiên thì dùng
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
      logger.info(`Dùng font: ${fontPath}`);
      return fontPath;
    }
  }
  // Fallback: để ffmpeg tự tìm — có thể không hiện text nhưng không crash
  logger.warn("Không tìm thấy font cụ thể, dùng fallback. Chạy: apt install fonts-dejavu-core");
  return "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}

// ─── Lấy kích thước video ─────────────────────────────────────────────────────

async function getVideoDimensions(inputPath: string): Promise<{ width: number; height: number } | null> {
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`;
    const { stdout } = await execAsync(cmd);
    const [width, height] = stdout.trim().split("x").map(Number);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

// ─── Kiểm tra font đã cài chưa (chạy 1 lần khi khởi động) ───────────────────

export async function checkFontInstalled(): Promise<void> {
  const font = getAvailableFont();
  if (!fs.existsSync(font)) {
    logger.warn("⚠️  Font chưa được cài! Chạy lệnh sau trên VPS:");
    logger.warn("    apt-get install -y fonts-dejavu-core");
    logger.warn("    fc-cache -fv");
  } else {
    logger.success(`Font OK: ${font}`);
  }
}

// ─── Hàm chính: xử lý video trong 1 lệnh ffmpeg duy nhất ─────────────────────
//
// Pipeline (theo thứ tự filter):
//   1. Dải đen trên/dưới (che logo kênh gốc)
//   2. Text overlay @0xFly_ (branded watermark góc phải dưới)
//   3. Zoom crop nhẹ 102% (phá pixel fingerprint)
//   4. Hue shift ±5° ngẫu nhiên (phá color hash)
//   5. Speed 1.03x (phá audio fingerprint — không dùng atempo để tránh artifact)
//
// Tất cả trong 1 pass — không re-encode nhiều lần, giữ chất lượng tốt nhất.

export async function maskVideo(
  inputPath: string,
  outputPath: string,
  topText: string = "FOLLOW @0xFly_ FOR MORE!",
  bottomBannerText: string = "😂 TAG A FRIEND WHO NEEDS TO SEE THIS"
): Promise<boolean> {
  try {
    logger.info(`Đang xử lý video: ${path.basename(inputPath)}`);

    const dims = await getVideoDimensions(inputPath);
    const h = dims?.height || 1920;
    const w = dims?.width || 1080;

    const fontPath = getAvailableFont();

    // Tính toán kích thước
    const maskH = Math.floor(h * 0.15);           // Chiều cao dải đen (15%)
    const topFontSize = Math.floor(h * 0.038);    // Font size text trên
    const bannerFontSize = Math.floor(h * 0.032); // Font size text dưới (banner)
    const brandFontSize = Math.floor(h * 0.045);  // Font size @0xFly_ (to hơn, dễ thấy)

    // Random hue shift: -5 đến +5 độ
    const hueShift = (Math.random() * 10 - 5).toFixed(1);

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
      `drawbox=y=0:color=black@1:width=iw:height=${maskH}:t=fill`,
      // 1b. Text trên (nằm giữa dải đen)
      `drawtext=fontfile='${fontPath}':text='${topTextEsc}':fontcolor=white:fontsize=${topFontSize}:x=(w-text_w)/2:y=(${maskH}-text_h)/2`,
      // 2a. Dải đen dưới
      `drawbox=y=ih-${maskH}:color=black@1:width=iw:height=${maskH}:t=fill`,
      // 2b. Text banner dưới (căn giữa trong dải đen)
      `drawtext=fontfile='${fontPath}':text='${bannerTextEsc}':fontcolor=yellow:fontsize=${bannerFontSize}:x=(w-text_w)/2:y=ih-${maskH}+(${maskH}-text_h)/2`,
      // 2c. @0xFly_ — góc phải dưới, trong dải đen, màu trắng nổi bật
      `drawtext=fontfile='${fontPath}':text='${brandText}':fontcolor=white:fontsize=${brandFontSize}:x=w-text_w-20:y=ih-${maskH}+(${maskH}-text_h)/2+2`,
      // 3. Zoom crop 102% — phá pixel fingerprint
      `scale=${Math.floor(w * 1.02)}:${Math.floor(h * 1.02)}`,
      `crop=${w}:${h}`,
      // 4. Hue shift ngẫu nhiên — phá color hash
      `hue=h=${hueShift}`,
    ].join(",");

    // Audio filter: speed 1.03x để phá audio fingerprint
    const audioFilter = `atempo=1.03`;

    const ffmpegCmd = [
      `ffmpeg`,
      `-i "${inputPath}"`,
      `-vf "${videoFilters}"`,
      `-af "${audioFilter}"`,
      `-c:v libx264`,
      `-preset fast`,
      `-crf 23`,
      `-c:a aac`,
      `-b:a 128k`,
      `-movflags +faststart`,          // Tối ưu cho streaming/upload
      `-y "${outputPath}"`,
    ].join(" ");

    logger.info(`ffmpeg command: ${ffmpegCmd.substring(0, 120)}...`);
    await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 });

    if (!fs.existsSync(outputPath)) {
      logger.error("ffmpeg chạy xong nhưng không tạo được file output");
      return false;
    }

    const inSize = (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1);
    const outSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
    logger.success(
      `Xử lý xong: ${path.basename(outputPath)} | ${inSize}MB → ${outSize}MB | hue=${hueShift}°`
    );
    return true;
  } catch (err: any) {
    logger.error(`Lỗi xử lý video: ${err.message}`);
    // Log full stderr nếu có để debug
    if (err.stderr) {
      logger.error(`ffmpeg stderr: ${err.stderr.substring(0, 500)}`);
    }
    return false;
  }
}
