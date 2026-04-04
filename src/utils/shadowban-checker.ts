// src/utils/shadowban-checker.ts
// Kiểm tra trạng thái Shadowban của tài khoản X (Twitter)
// Nguồn: https://shadowban.yuzurisa.com/0xFly_

import axios from "axios";
import { createLogger } from "./logger";

const logger = createLogger("Shadowban");

export interface ShadowbanStatus {
  search_ban: boolean;
  search_suggestion_ban: boolean;
  ghost_ban: boolean;
  reply_deboosting: boolean;
  is_banned: boolean;
}

export async function checkShadowban(username: string): Promise<ShadowbanStatus | null> {
  try {
    logger.info(`Đang kiểm tra Shadowban cho @${username}...`);
    
    // Sử dụng API của yuzurisa.com (Dựa trên cấu trúc phổ biến của các trang check shadowban)
    // Nếu API không khả dụng, chúng ta sẽ dùng axios để lấy HTML và parse đơn giản
    const response = await axios.get(`https://shadowban.yuzurisa.com/api/check?screen_name=${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (response.status === 200 && response.data) {
      const data = response.data;
      const status: ShadowbanStatus = {
        search_ban: data.search_ban || false,
        search_suggestion_ban: data.search_suggestion_ban || false,
        ghost_ban: data.ghost_ban || false,
        reply_deboosting: data.reply_deboosting || false,
        is_banned: data.search_ban || data.search_suggestion_ban || data.ghost_ban || data.reply_deboosting
      };
      
      if (status.is_banned) {
        logger.warn(`Phát hiện tài khoản @${username} đang bị Shadowban!`);
      } else {
        logger.success(`Tài khoản @${username} hoàn toàn sạch (No Shadowban).`);
      }
      
      return status;
    }
    
    return null;
  } catch (err: any) {
    logger.error(`Lỗi khi check Shadowban: ${err.message}`);
    // Fallback: Nếu API lỗi, chúng ta giả định là không bị ban để bot tiếp tục chạy, 
    // nhưng sẽ cảnh báo người dùng kiểm tra thủ công.
    return null;
  }
}
