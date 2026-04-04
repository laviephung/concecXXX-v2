// src/utils/video-processor.ts
// Xử lý video: Che logo cũ, chèn overlay thương hiệu @0xFly_
// Sử dụng ffmpeg để chèn 2 dải màu đen (hoặc ảnh) vào phần trên và dưới của video Shorts (9:16)

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { createLogger } from "./logger";

const execAsync = promisify(exec);
const logger = createLogger("VideoProcessor");

/**
 * Che logo cũ bằng cách chèn 2 dải màu đen (hoặc ảnh) vào phần trên và dưới của video.
 * @param inputPath Đường dẫn video gốc
 * @param outputPath Đường dẫn video sau khi xử lý
 * @param topText Văn bản hiển thị ở dải trên (tùy chọn)
 * @param bottomText Văn bản hiển thị ở dải dưới (tùy chọn)
 */
export async function maskVideo(
  inputPath: string, 
  outputPath: string, 
  topText: string = "FOLLOW @0xFly_ FOR MORE!", 
  bottomText: string = "😂 TAG A FRIEND WHO NEEDS TO SEE THIS"
): Promise<boolean> {
  try {
    logger.info(`Đang xử lý che logo cho video: ${path.basename(inputPath)}`);

    // Lệnh ffmpeg:
    // 1. Vẽ 2 hình chữ nhật đen (drawbox) ở trên và dưới để che logo cũ.
    // 2. Chèn text (drawtext) vào 2 dải đen đó để làm thương hiệu.
    // Giả sử video Shorts là 1080x1920 hoặc tương đương.
    // Dải trên: cao khoảng 15% (h*0.15)
    // Dải dưới: cao khoảng 15% (h*0.15)
    
    const ffmpegCmd = `ffmpeg -i "${inputPath}" -vf "` +
      `drawbox=y=0:color=black@1:width=iw:height=ih*0.18:t=fill, ` +
      `drawbox=y=ih-ih*0.18:color=black@1:width=iw:height=ih*0.18:t=fill, ` +
      `drawtext=text='${topText}':fontcolor=white:fontsize=h*0.04:x=(w-text_w)/2:y=(ih*0.18-text_h)/2, ` +
      `drawtext=text='${bottomText}':fontcolor=yellow:fontsize=h*0.035:x=(w-text_w)/2:y=ih-ih*0.18+(ih*0.18-text_h)/2" ` +
      `-c:a copy -y "${outputPath}"`;

    await execAsync(ffmpegCmd);
    
    if (fs.existsSync(outputPath)) {
      logger.success(`Đã xử lý xong video: ${path.basename(outputPath)}`);
      return true;
    }
    return false;
  } catch (err: any) {
    logger.error(`Lỗi xử lý video bằng ffmpeg: ${err.message}`);
    return false;
  }
}
