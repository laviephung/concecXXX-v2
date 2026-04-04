// src/processor/caption-generator.ts
// Dùng OpenAI để tự động viết caption tiếng Anh từ tiêu đề video
// Đã cải tiến: Đa dạng hóa phong cách, tối ưu cho thuật toán X (Twitter)

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("CaptionAI");

const ai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ─── Các phong cách Caption cho X ─────────────────────────────────────────────

const CAPTION_STYLES = [
  {
    name: "Witty/Meme",
    prompt: "Write a short, witty, meme-style caption. Use internet slang if appropriate. Max 150 chars."
  },
  {
    name: "Curiosity/Hook",
    prompt: "Write a caption that creates extreme curiosity or a 'wait for it' moment. Don't spoil the ending. Max 150 chars."
  },
  {
    name: "Relatable",
    prompt: "Write a caption that starts with 'POV:' or 'That feeling when...'. Make it relatable to a broad audience. Max 150 chars."
  },
  {
    name: "Short/Punchy",
    prompt: "Write a very short (under 60 chars), punchy caption that hits hard. One sentence only."
  },
  {
    name: "Engagement/Question",
    prompt: "Write a caption that ends with a simple question to encourage people to reply. Max 150 chars."
  }
];

// ─── Viết caption cho 1 video ─────────────────────────────────────────────────

async function generateCaption(title: string): Promise<string | null> {
  try {
    // Chọn ngẫu nhiên một phong cách để tránh lặp lại (Tránh bị X trừng phạt)
    const style = CAPTION_STYLES[Math.floor(Math.random() * CAPTION_STYLES.length)];
    
    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a viral content creator on X (Twitter). 
Rules:
- ${style.prompt}
- Casual, native English tone.
- No Chinese characters.
- Never mention the video source or platform.
- Add 1-2 relevant, niche hashtags (avoid generic ones like #viral #funny).
- Use 1-2 emojis max.`,
        },
        {
          role: "user",
          content: `Video title: "${title}"`,
        },
      ],
    });

    const caption = response.choices[0]?.message?.content?.trim();
    if (!caption) return null;

    // Loại bỏ dấu ngoặc kép nếu AI tự thêm vào
    return caption.replace(/^"|"$/g, '');
  } catch (err: any) {
    logger.error(`OpenAI error: ${err.message}`);
    return null;
  }
}

// ─── Xử lý tất cả video chờ caption ─────────────────────────────────────────

export async function processPendingCaptions(): Promise<void> {
  const videos = await db.videoLibrary.findMany({
    where: { status: "pending_caption" },
    take: 10,
  });

  if (videos.length === 0) return;

  logger.info(`Đang tạo caption cho ${videos.length} video với phong cách đa dạng...`);

  for (const video of videos) {
    const caption = await generateCaption(video.title || "Untitled Video");

    if (caption) {
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption, status: "ready" },
      });
      logger.success(`Caption OK: ${caption}`);
    } else {
      // Lỗi AI → dùng caption dự phòng (cũng nên đa dạng)
      const fallbacks = [
        "Wait for the end... 💀 #unbelievable",
        "POV: You weren't expecting this. #unexpected",
        "Can someone explain what just happened? 🧐",
        "This is actually wild. #trendingnow"
      ];
      const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      
      await db.videoLibrary.update({
        where: { id: video.id },
        data: {
          caption: fallback,
          status: "ready",
        },
      });
      logger.warn(`Dùng caption dự phòng cho: ${video.title}`);
    }

    // Chờ 1s giữa các request tránh rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }
}
