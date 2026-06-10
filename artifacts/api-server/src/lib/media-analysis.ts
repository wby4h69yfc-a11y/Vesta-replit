import { getLLMClient } from "@workspace/llm-client";
import { getBspAdapter } from "./wa-bsp";
import { transcribeVoice } from "./voice-transcriber";
import { logger } from "./logger";

/**
 * Detect the broad media category from a MIME type.
 */
function mediaCategoryFromMime(
  contentType: string,
): "audio" | "image" | "video" | "other" {
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "other";
}

/**
 * Describe a WhatsApp image using GPT-5-mini vision.
 * Returns a Portuguese description suitable for the classifier,
 * or null if analysis fails.
 */
async function analyzeImage(
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const base64 = buffer.toString("base64");

  try {
    const text = await getLLMClient().visionCompletion(
      "Você é um assistente de família que analisa imagens recebidas via WhatsApp. " +
        "Descreva o conteúdo da imagem de forma concisa em português (máximo 3 frases), " +
        "focando em informações relevantes para a gestão doméstica: eventos, datas, " +
        "horários, locais, nomes, tarefas ou compromissos visíveis. " +
        "Se não houver texto ou informação relevante, diga brevemente o que a imagem mostra.",
      base64,
      contentType,
      { maxTokens: 400 },
    );
    return text.trim() || null;
  } catch (err) {
    logger.error({ err, contentType }, "Image analysis failed");
    return null;
  }
}

export type MediaProcessingResult = {
  rawContent: string;
  source: "voice" | "photo" | "whatsapp";
  mediaCategory: "audio" | "image" | "video" | "other" | "none";
  /**
   * 0–1 confidence proxy for voice messages (from whisper-1 avg_logprob).
   * Present only when source === "voice" and transcription succeeded.
   * Absent on the error fallback path so the low-confidence gate is bypassed.
   */
  transcriptionConfidence?: number;
};

/**
 * Process an incoming WhatsApp media attachment.
 *
 * Downloads the media via the active BSP adapter (Twilio URL with Basic Auth,
 * or 360Dialog media ID via their /v1/media/{id} endpoint), then:
 * - Audio (voice memos): transcribed with whisper-1. rawContent = transcript;
 *   source = "voice"; transcriptionConfidence = 0–1 proxy score.
 *   On transcription failure, falls back to a placeholder with no confidence
 *   score so the low-confidence gate is transparently skipped.
 * - Images: described by GPT vision. rawContent = description; source = "photo".
 * - Video / other: stored with a placeholder so the item is still reviewable.
 */
export async function processWhatsAppMedia(
  mediaUrl: string,
  contentTypeHeader: string,
  textBody: string | undefined,
): Promise<MediaProcessingResult> {
  const category = mediaCategoryFromMime(contentTypeHeader);
  const adapter = getBspAdapter();

  if (category === "audio") {
    try {
      const result = await transcribeVoice(mediaUrl, contentTypeHeader);
      return {
        rawContent: result.transcription,
        source: "voice",
        mediaCategory: "audio",
        transcriptionConfidence: result.confidence,
      };
    } catch (err) {
      // transcribeVoice already logged + rethrew; we catch here to provide a
      // placeholder inbox item so the user's audio is never silently lost.
      // transcriptionConfidence is omitted so the low-confidence Sim/Não gate
      // is skipped — we must not prompt the user to confirm placeholder text.
      logger.warn({ err }, "media-analysis: voice transcription failed — using placeholder");
      return {
        rawContent: textBody?.trim() || "(áudio recebido — transcrição indisponível)",
        source: "voice",
        mediaCategory: "audio",
      };
    }
  }

  if (category === "image") {
    try {
      const { buffer, contentType } = await adapter.downloadMedia(mediaUrl, contentTypeHeader);
      const description = await analyzeImage(buffer, contentType);
      if (description) {
        const prefix = textBody?.trim() ? `${textBody.trim()}\n\n` : "";
        logger.info({ chars: description.length }, "Image analyzed by vision model");
        return {
          rawContent: `${prefix}${description}`,
          source: "photo",
          mediaCategory: "image",
        };
      }
    } catch (err) {
      logger.error({ err }, "Image download/analysis failed");
    }
    return {
      rawContent: textBody?.trim() || "(imagem recebida — análise indisponível)",
      source: "photo",
      mediaCategory: "image",
    };
  }

  return {
    rawContent: textBody?.trim() || "(mídia recebida)",
    source: "photo",
    mediaCategory: category,
  };
}
