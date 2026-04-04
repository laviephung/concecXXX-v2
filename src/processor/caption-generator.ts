// src/processor/caption-generator.ts
// Dùng OpenAI để viết caption cho video dựa trên tiêu đề/metadata
// Đã cải tiến: Giữ nguyên ý chính tiêu đề gốc + "nêm nếm" phong cách Family Guy & X (Twitter)

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("CaptionAI");

const ai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ─── Viết caption cho 1 video ─────────────────────────────────────────────────

async function generateCaption(title: string): Promise<string | null> {
  try {
    logger.info(`Đang tạo caption "mặn" cho: ${title}`);

    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content: `You are a viral content creator on X (Twitter) who is a huge fan of Family Guy.
Your goal is to take the original video title and "spice it up" with Family Guy humor and X slang.

Rules:
- KEEP the core meaning of the original title (e.g., if it's about Peter fighting a chicken, mention the fight).
- SPICE it up with "unhinged" or "vô tri" humor.
- Use X slang: "menace", "cooked", "unhinged", "literally me", "bruh", "💀", "😭", "😂".
- NO clickbait phrases like "You won't believe", "Wait for it", "Watch until the end".
- NO hashtags (makes it look like a bot).
- NO Chinese characters.
- Short and punchy (Max 120 characters).
- Make it sound like a real person's thought, not a marketing ad.

Example:
Input: "Peter Griffin vs Giant Chicken"
Output: "This beef will never end 💀 Peter is a menace for this 😂"

Input: "Stewie roasts Brian"
Output: "Stewie chose violence today 😭 Brian is absolutely cooked bruh 💀"`,
        },
        {
          role: "user",
          content: `Original Title: "${title}"\nWrite a viral X caption based on this.`,
        },
      ],
    });

    const caption = response.choices[0]?.message?.content?.trim();
    if (!caption) return null;

    return caption.replace(/^"|"$/g, '');
  } catch (err: any) {
    logger.error(`OpenAI error (Caption): ${err.message}`);
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

  logger.info(`Đang tạo caption "nêm nếm" cho ${videos.length} video...`);

  for (const video of videos) {
    const caption = await generateCaption(video.title || "Family Guy Funny Moment");

    if (caption) {
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption, status: "ready" },
      });
      logger.success(`Caption OK: ${caption}`);
    } else {
      // Fallback đơn giản nếu AI lỗi
      const fallback = `${video.title || "Family Guy"} is wild 💀😭`;
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption: fallback, status: "ready" },
      });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
