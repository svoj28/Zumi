package expo.modules.zumivideoencoder

import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File

/**
 * H.264 encoder writing an MP4 with MediaCodec + MediaMuxer (both part of Android).
 *
 * Frames arrive as RGBA bytes and are converted to YUV 4:2:0 (BT.601, limited range) straight
 * into the codec's input Image. `getInputImage` describes each plane's row and pixel stride, so
 * this works whether the device's encoder wants planar (I420) or semi-planar (NV12) input.
 */
internal class Mp4Encoder(
  private val file: File,
  private val width: Int,
  private val height: Int,
  bitRate: Int,
  frameRate: Int,
) {
  private val codec: MediaCodec = MediaCodec.createEncoderByType(MIME)
  private lateinit var muxer: MediaMuxer
  private val info = MediaCodec.BufferInfo()
  private var track = -1
  private var muxerStarted = false
  private var lastPtsUs = -1L
  private var released = false

  init {
    try {
      require(width > 0 && height > 0 && width % 2 == 0 && height % 2 == 0) { "Size must be even" }
      file.parentFile?.mkdirs()
      if (file.exists()) file.delete()
      val format = MediaFormat.createVideoFormat(MIME, width, height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
        setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
        setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      }
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    } catch (e: Exception) {
      codec.release()
      released = true
      throw e
    }
  }

  fun append(rgba: ByteArray, ptsUs: Long) {
    require(rgba.size >= width * height * 4) { "Frame is smaller than the video" }
    // Timestamps must strictly increase.
    val pts = if (ptsUs <= lastPtsUs) lastPtsUs + 1 else ptsUs
    val index = dequeueInput()
    val image = codec.getInputImage(index) ?: throw IllegalStateException("Encoder has no input image")
    writeYuv(rgba, image)
    codec.queueInputBuffer(index, 0, width * height * 3 / 2, pts, 0)
    lastPtsUs = pts
    drain(endOfStream = false)
  }

  /** Ends the stream at `endUs`. */
  fun finish(endUs: Long) {
    val index = dequeueInput()
    codec.queueInputBuffer(index, 0, 0, maxOf(endUs, lastPtsUs + 1), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    drain(endOfStream = true)
    release(deleteFile = false)
  }

  fun cancel() {
    release(deleteFile = true)
  }

  private fun dequeueInput(): Int {
    val deadline = System.nanoTime() + TIMEOUT_NS
    while (System.nanoTime() < deadline) {
      val index = codec.dequeueInputBuffer(10_000)
      if (index >= 0) return index
      drain(endOfStream = false)
    }
    throw IllegalStateException("Encoder is not accepting frames")
  }

  private fun drain(endOfStream: Boolean) {
    val deadline = System.nanoTime() + TIMEOUT_NS
    while (true) {
      val index = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
      when {
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream) return
          if (System.nanoTime() > deadline) throw IllegalStateException("Encoder did not finish")
        }
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          check(!muxerStarted) { "Output format changed twice" }
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxerStarted = true
        }
        index >= 0 -> {
          val buffer = codec.getOutputBuffer(index) ?: throw IllegalStateException("Missing output buffer")
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (info.size > 0 && muxerStarted) {
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            muxer.writeSampleData(track, buffer, info)
          }
          codec.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  private fun writeYuv(rgba: ByteArray, image: Image) {
    val planes = image.planes
    val y = planes[0]
    val u = planes[1]
    val v = planes[2]
    val yBuf = y.buffer
    val uBuf = u.buffer
    val vBuf = v.buffer
    for (row in 0 until height) {
      var src = row * width * 4
      var dst = row * y.rowStride
      for (col in 0 until width) {
        val r = rgba[src].toInt() and 0xff
        val g = rgba[src + 1].toInt() and 0xff
        val b = rgba[src + 2].toInt() and 0xff
        yBuf.put(dst, (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte())
        src += 4
        dst += y.pixelStride
      }
    }
    // Chroma: one sample per 2x2 block, averaged.
    for (row in 0 until height / 2) {
      for (col in 0 until width / 2) {
        var r = 0
        var g = 0
        var b = 0
        for (dy in 0..1) {
          for (dx in 0..1) {
            val i = ((row * 2 + dy) * width + col * 2 + dx) * 4
            r += rgba[i].toInt() and 0xff
            g += rgba[i + 1].toInt() and 0xff
            b += rgba[i + 2].toInt() and 0xff
          }
        }
        r = r shr 2
        g = g shr 2
        b = b shr 2
        uBuf.put(row * u.rowStride + col * u.pixelStride, (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte())
        vBuf.put(row * v.rowStride + col * v.pixelStride, (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte())
      }
    }
  }

  private fun release(deleteFile: Boolean) {
    if (released) return
    released = true
    try {
      codec.stop()
    } catch (_: Exception) {
    }
    codec.release()
    try {
      if (muxerStarted) muxer.stop()
    } catch (_: Exception) {
    }
    muxer.release()
    if (deleteFile || !muxerStarted) file.delete()
  }

  private companion object {
    const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
    const val TIMEOUT_NS = 5_000_000_000L
  }
}
