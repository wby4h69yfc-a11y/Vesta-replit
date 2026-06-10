/**
 * VoiceTranscriber
 *
 * Downloads a WhatsApp audio attachment via the active BSP adapter and
 * transcribes it using OpenAI whisper-1 with verbose_json response format.
 * The verbose_json format exposes per-segment avg_logprob values which are
 * averaged to produce a proxy confidence score (0–1).
 *
 * Confidence mapping: avgLogProb is typically in the range [−0.7, 0].
 *   confidence = clamp((avgLogProb + 0.7) / 0.7, 0, 1)
 * At the 0.70 gate: avgLogProb ≈ −0.21.
 */

import {
  ensureCompatibleFormat,
  whisperVerboseTranscribe,
} from "@workspace/integrations-openai-ai-server/audio";
import { getBspAdapter } from "./wa-bsp";
import { logger } from "./logger";

export interface VoiceTranscriptionResult {
  transcription: string;
  /** 0–1 confidence proxy derived from whisper-1 segment avg_logprob. */
  confidence: number;
}

/**
 * Map a Whisper segment avg_logprob (≤ 0) to a 0–1 confidence score.
 * Threshold 0.70 corresponds to avgLogProb ≈ −0.21.
 */
function avgLogProbToConfidence(avgLogProb: number): number {
  return Math.max(0, Math.min(1, (avgLogProb + 0.7) / 0.7));
}

/**
 * Download and transcribe a WhatsApp voice message using whisper-1.
 *
 * Returns a { transcription, confidence } result on success, or null if
 * download or transcription fails (so the caller can fall back gracefully).
 */
export async function transcribeVoice(
  mediaUrl: string,
  contentTypeHeader: string,
): Promise<VoiceTranscriptionResult | null> {
  const adapter = getBspAdapter();

  try {
    const { buffer } = await adapter.downloadMedia(mediaUrl, contentTypeHeader);
    const { buffer: compatBuffer, format } = await ensureCompatibleFormat(buffer);

    const { text, segments } = await whisperVerboseTranscribe(compatBuffer, format);

    const transcription = text.trim();
    if (!transcription) return null;

    const logProbs = segments
      .map((s) => s.avg_logprob)
      .filter((v): v is number => typeof v === "number");

    const avgLogProb =
      logProbs.length > 0
        ? logProbs.reduce((sum, v) => sum + v, 0) / logProbs.length
        : -0.15; // Short utterance with no segments — assume OK quality.

    const confidence = avgLogProbToConfidence(avgLogProb);

    logger.info(
      { chars: transcription.length, confidence, avgLogProb },
      "Voice memo transcribed (whisper-1)",
    );

    return { transcription, confidence };
  } catch (err) {
    logger.error({ err }, "voice-transcriber: download or transcription failed");
    return null;
  }
}
