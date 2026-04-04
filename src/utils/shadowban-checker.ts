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
    
    // Sử dụng API chính xác từ yuzurisa.com mà người dùng cung cấp
    const response = await axios.get(`https://shadowban-api.yuzurisa.com:444/${username}`, {
      headers: {
        'accept': '*/*',
        'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
        'origin': 'https://shadowban.yuzurisa.com',
        'referer': 'https://shadowban.yuzurisa.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
      },
      timeout: 20000
    });

    if (response.status === 200 && response.data) {
      const data = response.data;
      const tests = data.tests || {};
      
      // Phân tích cấu trúc dữ liệu từ API:
      // search: "_implied_good" hoặc "banned"
      // typeahead: true (tốt) hoặc false (banned)
      // ghost.ban: true hoặc false
      // more_replies.ban: true hoặc false
      
      const status: ShadowbanStatus = {
        search_ban: tests.search === "banned",
        search_suggestion_ban: tests.typeahead === false,
        ghost_ban: tests.ghost?.ban === true,
        reply_deboosting: tests.more_replies?.ban === true,
        is_banned: false
      };

      // Tổng hợp trạng thái ban
      status.is_banned = status.search_ban || status.search_suggestion_ban || status.ghost_ban || status.reply_deboosting;
      
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
    return null;
  }
}
