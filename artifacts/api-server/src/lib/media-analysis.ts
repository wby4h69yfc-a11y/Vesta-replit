import { getLLMClient } from "@workspace/llm-client";
import {
  speechToText,
  ensureCompatibleFormat,
} from "@workspace/integrations-openai-ai-server/audio";
import { logger } from "./logger";
import { getBspAdapter } from "./wa-bsp";

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
 * Transcribe a WhatsApp voice message using OpenAI's transcription model.
 * Supports OGG (WhatsApp's native format), MP3, WAV, MP4, M4A.
 *
 * Converts to a compatible format first, then sends to gpt-4o-mini-transcribe.
 * Returns the transcript text, or null if transcription fails.
 */
async function transcribeAudio(buffer: Buffer): Promise<string | null> {
  try {
    const { buffer: compatBuffer, format } = await ensureCompatibleFormat(buffer);
    const text = await speechToText(compatBuffer, format);
    return text.trim() || null;
  } catch (err) {
    logger.error({ err }, "Audio transcription failed");
    return null;
  }
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
};

/**
 * Process an incoming WhatsApp media attachment.
 *
 * Downloads the media via the active BSP adapter (Twilio URL with Basic Auth,
 * or 360Dialog media ID via their /v1/media/{id} endpoint), then:
 * - Audio (voice memos): transcribed with Whisper. rawContent = transcript; source = "voice".
 * - Images: described by GPT vision. rawContent = description; source = "photo".
 * - Video / other: stored with a placeholder so the item is still reviewable.
 *
 * If processing fails for any reason the function returns a safe placeholder
 * so the inbox item is still created and can be reviewed manually.
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
      const { buffer } = await adapter.downloadMedia(mediaUrl, contentTypeHeader);
      const transcript = await transcribeAudio(buffer);
      if (transcript) {
        logger.info({ chars: transcript.length }, "Voice memo transcribed successfully");
        return { rawContent: transcript, source: "voice", mediaCategory: "audio" };
      }
    } catch (err) {
      logger.error({ err }, "Voice memo download/transcription failed");
    }
    return {
      rawContent: textBody?.trim() || "(áudio recebido — transcrição indisponível)",
      source: "voice",
      mediaCategory: "audio",
    };
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
