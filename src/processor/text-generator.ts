// src/processor/text-generator.ts
// Dùng OpenAI để tự động viết các bài đăng văn bản (text-only) hài hước, vô tri
// Đã cải tiến: Chuyên sâu về Family Guy, phong cách viral trên X (Twitter)

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";

const logger = createLogger("TextAI");

const ai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const TEXT_TOPICS = [
  "Funny Family Guy shower thoughts (vô tri kiểu Peter)",
  "Unpopular opinions about Family Guy characters (Brian vs Stewie)",
  "Relatable struggles of daily life (hài hước kiểu Family Guy)",
  "Short, punchy jokes about Peter Griffin's logic",
  "Questions to engage Family Guy fans (Who's the worst character?)",
  "Meme-style observations about the show's unhinged moments"
];

export async function generateFunnyText(): Promise<string | null> {
  try {
    const topic = TEXT_TOPICS[Math.floor(Math.random() * TEXT_TOPICS.length)];
    
    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a viral content creator on X (Twitter) known for being funny, witty, and slightly "unhinged" (vô tri).
You are a huge fan of Family Guy and your humor reflects Peter Griffin's logic.

Rules:
- Write a short, punchy text-only post.
- Topic: ${topic}
- Casual, native English tone.
- No Chinese characters.
- Max 180 characters.
- Use 1-2 emojis max (💀, 😭, 😂, 🔥).
- The goal is to get people to reply, like, or say "so true".
- Do NOT use hashtags for these text posts to make them look more like a real person's thought.`,
        },
        {
          role: "user",
          content: "Write a random funny thought or joke for my X followers.",
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) return null;

    return text.replace(/^"|"$/g, '');
  } catch (err: any) {
    logger.error(`OpenAI error (Text): ${err.message}`);
    return null;
  }
}
