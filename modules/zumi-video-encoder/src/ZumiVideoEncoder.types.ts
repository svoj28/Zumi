/**
 * Native H.264/MP4 encoder: Android MediaCodec + MediaMuxer, iOS AVAssetWriter. One video is
 * encoded at a time; calls must be awaited in order (start → appendFrame… → finish/cancel).
 */
export interface ZumiVideoEncoderNative {
  /** Starts a new MP4 at `fileUri` (overwritten). Width and height must be even. */
  start(fileUri: string, width: number, height: number, bitRate: number, frameRate: number): Promise<void>;
  /** Adds an RGBA frame (width × height × 4 bytes) shown from `ptsUs` (microseconds). */
  appendFrame(rgba: Uint8Array, ptsUs: number): Promise<void>;
  /** Closes the file; the last frame stays on screen until `endUs`. */
  finish(endUs: number): Promise<void>;
  /** Abandons the video in progress (the partial file is deleted). */
  cancel(): Promise<void>;
}
