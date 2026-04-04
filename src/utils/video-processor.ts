// src/utils/video-processor.ts
// Xử lý video: Che logo cũ, chèn overlay thương hiệu @0xFly_
// Đã cải tiến v2.6: Tự động nhận diện kích thước video để căn chỉnh dải đen chuẩn xác hơn

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { createLogger } from "./logger";

const execAsync = promisify(exec);
const logger = createLogger("VideoProcessor");

/**
 * Lấy kích thước video (width, height) bằng ffprobe
 */
async function getVideoDimensions(inputPath: string): Promise<{ width: number, height: number } | null> {
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`;
    const { stdout } = await execAsync(cmd);
    const [width, height] = stdout.trim().split('x').map(Number);
    return { width, height };
  } catch (err) {
    return null;
  }
}

/**
 * Che logo cũ bằng cách chèn 2 dải màu đen (hoặc ảnh) vào phần trên và dưới của video.
 */
export async function maskVideo(
  inputPath: string, 
  outputPath: string, 
  topText: string = "FOLLOW @0xFly_ FOR MORE!", 
  bottomText: string = "😂 TAG A FRIEND WHO NEEDS TO SEE THIS"
): Promise<boolean> {
  try {
    logger.info(`Đang xử lý che logo cho video: ${path.basename(inputPath)}`);

    // 1. Lấy kích thước thực tế của video
    const dims = await getVideoDimensions(inputPath);
    const h = dims?.height || 1920; // Fallback nếu lỗi
    
    // 2. Tính toán độ dày dải đen (15% chiều cao mỗi dải là an toàn nhất)
    const maskHeight = Math.floor(h * 0.15);
    
    // 3. Lệnh ffmpeg cải tiến:
    // - Dùng drawbox để tạo dải đen
    // - Dùng drawtext với font size linh hoạt theo chiều cao video
    const fontSizeTop = Math.floor(h * 0.035);
    const fontSizeBottom = Math.floor(h * 0.03);

    const ffmpegCmd = `ffmpeg -i "${inputPath}" -vf "` +
      `drawbox=y=0:color=black@1:width=iw:height=${maskHeight}:t=fill, ` +
      `drawbox=y=ih-${maskHeight}:color=black@1:width=iw:height=${maskHeight}:t=fill, ` +
      `drawtext=text='${topText}':fontcolor=white:fontsize=${fontSizeTop}:x=(w-text_w)/2:y=(${maskHeight}-text_h)/2, ` +
      `drawtext=text='${bottomText}':fontcolor=yellow:fontsize=${fontSizeBottom}:x=(w-text_w)/2:y=ih-${maskHeight}+(${maskHeight}-text_h)/2" ` +
      `-c:a copy -y "${outputPath}"`;

    await execAsync(ffmpegCmd);
    
    if (fs.existsSync(outputPath)) {
      logger.success(`Đã xử lý xong video (Mask: ${maskHeight}px): ${path.basename(outputPath)}`);
      return true;
    }
    return false;
  } catch (err: any) {
    logger.error(`Lỗi xử lý video bằng ffmpeg: ${err.message}`);
    return false;
  }
}
