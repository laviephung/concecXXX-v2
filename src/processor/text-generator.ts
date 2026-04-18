// src/processor/text-generator.ts
// Dùng OpenAI để tự động viết các bài đăng văn bản (text-only) hài hước, vô tri
// Đã cải tiến: Bỏ giới hạn chủ đề, phong cách viral trên X (Twitter) dựa vào nội dung video
// Cập nhật v3.3: Tạo text/caption hoàn toàn dựa trên video tải về

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";

const logger = createLogger("TextAI");

const ai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const TEXT_TOPICS = [
  "Funny shower thoughts",
  "Relatable struggles of daily life",
  "Short, punchy jokes or observations",
  "Questions to engage followers",
  "Meme-style observations about internet culture"
];

export async function generateFunnyText(videoTitle?: string): Promise<string | null> {
  try {
    let systemContent = `You are a viral content creator on X (Twitter) known for being funny, witty, and slightly "unhinged" (vô tri) in a relatable way.

Rules:
- Write a short, punchy post.
- Casual, native English tone.
- No Chinese characters.
- Max 180 characters.
- Use 1-2 emojis max (💀, 😭, 😂, 🔥).
- The goal is to get people to reply, like, or say "so true".
- Do NOT use hashtags for these text posts to make them look more like a real person's thought.`;

    let userContent = "Write a random funny thought or joke for my X followers.";

    if (videoTitle) {
      // Nếu có tiêu đề video, yêu cầu AI viết caption dựa trên đó
      systemContent += `\n\nYour task is to create a funny, engaging caption for a video with the original title: "${videoTitle}".\n- Do NOT mention the video ID or directly quote the original title.\n- Focus on the humor, absurdity, or interesting aspects related to the title.\n- Make it sound like a reaction or a funny observation about the video's content.\n- Avoid generic phrases like "This video is about..."`;
      userContent = `Create a funny, viral-style caption for a video titled: "${videoTitle}".`;
    } else {
      // Nếu không có tiêu đề video, tạo bài đăng văn bản ngẫu nhiên dựa theo chủ đề
      const topic = TEXT_TOPICS[Math.floor(Math.random() * TEXT_TOPICS.length)];
      systemContent += `\n- Topic: ${topic}`;
    }

    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: userContent,
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
