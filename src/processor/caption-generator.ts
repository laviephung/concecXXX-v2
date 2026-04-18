// src/processor/caption-generator.ts
// Dùng OpenAI để viết caption cho video dựa trên tiêu đề/metadata
// Cập nhật: Tạo caption liên quan đến tiêu đề gốc của video tải về một cách tự nhiên và viral

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
    logger.info(`Đang tạo caption trên thông tin của video tải về: ${title}`);

    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content: `You are a viral content creator on X (Twitter).
Your goal is to take the original video title and create an engaging, relatable, or funny caption based on it.

Rules:
- The caption MUST be directly related to the original video title provided.
- KEEP the core meaning or subject of the original title.
- Make it sound natural, slightly "unhinged" or witty.
- Use X slang where appropriate: "cooked", "unhinged", "literally me", "bruh", "💀", "😭", "😂", "fr", "nah".
- NO clickbait phrases like "You won't believe", "Wait for it", "Watch until the end".
- NO hashtags (makes it look like a bot).
- NO Chinese characters.
- Short and punchy (Max 120 characters).
- Make it sound like a real person's reaction, not a marketing ad.
- Do NOT directly quote the original title. Rephrase it creatively.
- Avoid generic comments like "This video is about..." or "This content is..."

Example:
Original Title: "Guy fails trying to do a backflip"
Output: "bro really thought he had it 😭 absolutely cooked 💀"

Original Title: "Cat gets scared by a cucumber"
Output: "the orange cat energy is too real 😂 why are they like this fr"

Original Title: "My reaction to the new update"
Output: "my brain cells trying to process this 📉 literally me"
`,
        },
        {
          role: "user",
          content: `Original Video Title: "${title}"\nGenerate a viral X caption based on this title.`,
        },
      ],
    });

    const caption = response.choices[0]?.message?.content?.trim();
    if (!caption) return null;

    return caption.replace(/^"|"$/g, "");
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

  logger.info(`Đang tạo caption tự động cho ${videos.length} video...`);

  for (const video of videos) {
    // Truyền video.title vào generateCaption
    const caption = await generateCaption(video.title || "Random Video");

    if (caption) {
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption, status: "ready" },
      });
      logger.success(`Caption OK: ${caption}`);
    } else {
      // Fallback đơn giản nếu AI lỗi
      const fallback = `${video.title || "This video"} is wild 💀😭`;
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption: fallback, status: "ready" },
      });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
