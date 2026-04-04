// src/processor/caption-generator.ts
// Dùng OpenAI để tự động viết caption tiếng Anh từ tiêu đề video
// Đã cải tiến: Chuyên sâu về Family Guy, phong cách viral trên X (Twitter)

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("CaptionAI");

const ai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ─── Các phong cách Caption cho X chuyên về Family Guy ─────────────────────────

const CAPTION_STYLES = [
  {
    name: "POV/Relatable",
    prompt: "Write a caption starting with 'POV:' or 'Me when...'. Make it relatable to daily life using the Family Guy scene. Max 150 chars."
  },
  {
    name: "Menace/Unhinged",
    prompt: "Focus on how 'unhinged' or a 'menace' Peter Griffin or the characters are. Use slang like 'cooked', 'no way', 'bruh'. Max 150 chars."
  },
  {
    name: "Out of Context",
    prompt: "Write a caption that highlights how 'out of context' or 'wild' this Family Guy moment is. Max 150 chars."
  },
  {
    name: "Engagement/Question",
    prompt: "Ask a controversial or funny question about Family Guy characters (Peter, Stewie, Brian) to get people to reply. Max 150 chars."
  },
  {
    name: "Short/Punchy",
    prompt: "Write a very short, punchy caption (under 60 chars) that hits hard. One sentence only."
  }
];

// ─── Viết caption cho 1 video ─────────────────────────────────────────────────

async function generateCaption(title: string): Promise<string | null> {
  try {
    const style = CAPTION_STYLES[Math.floor(Math.random() * CAPTION_STYLES.length)];
    
    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a viral content creator on X (Twitter) specializing in Family Guy clips.
Rules:
- ${style.prompt}
- Casual, native English tone.
- Characters: Peter (idiot), Stewie (evil baby), Brian (dog), Quagmire, Joe.
- No Chinese characters.
- Do NOT use hashtags (makes it look like a bot).
- Use 1-2 emojis max (💀, 😭, 😂, 🔥).
- Make it sound like a real person's thought, not an ad.`,
        },
        {
          role: "user",
          content: `Write a viral X caption for this Family Guy clip: "${title}"`,
        },
      ],
    });

    const caption = response.choices[0]?.message?.content?.trim();
    if (!caption) return null;

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

  logger.info(`Đang tạo caption chuyên sâu Family Guy cho ${videos.length} video...`);

  for (const video of videos) {
    const caption = await generateCaption(video.title || "Family Guy Funny Moment");

    if (caption) {
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption, status: "ready" },
      });
      logger.success(`Caption OK: ${caption}`);
    } else {
      const fallbacks = [
        "Peter Griffin is actually a menace 💀",
        "Family Guy out of context is wild 😭",
        "How is this show still allowed? 😂",
        "POV: You're watching Family Guy at 3 AM 💀"
      ];
      const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption: fallback, status: "ready" },
      });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
