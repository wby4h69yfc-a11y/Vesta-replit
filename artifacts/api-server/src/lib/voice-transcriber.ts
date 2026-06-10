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
 *
 * Error policy: download or transcription failures are logged then rethrown
 * so the caller can decide on fallback behaviour and the webhook's catch block
 * has visibility into the failure.  The null-return fallback lives in
 * media-analysis.ts, not here.
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
 * Throws on download or transcription failure (see module docstring).
 * The returned confidence is a 0–1 proxy computed from whisper-1 segment
 * avg_logprob values; the caller should gate on < 0.70 for user confirmation.
 */
export async function transcribeVoice(
  mediaUrl: string,
  contentTypeHeader: string,
): Promise<VoiceTranscriptionResult> {
  const adapter = getBspAdapter();

  try {
    const { buffer } = await adapter.downloadMedia(mediaUrl, contentTypeHeader);
    const { buffer: compatBuffer, format } = await ensureCompatibleFormat(buffer);

    const { text, segments } = await whisperVerboseTranscribe(compatBuffer, format);

    const transcription = text.trim();

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
    throw err;
  }
}
