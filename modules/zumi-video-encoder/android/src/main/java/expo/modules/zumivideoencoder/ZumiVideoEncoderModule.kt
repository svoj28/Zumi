package expo.modules.zumivideoencoder

import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class VideoEncodingException(message: String, cause: Throwable? = null) :
  CodedException("ERR_VIDEO_ENCODING", message, cause)

/**
 * Encodes RGBA frames from JS into an H.264 MP4 (see Mp4Encoder). One video at a time; JS awaits
 * every call, so calls never overlap.
 */
class ZumiVideoEncoderModule : Module() {
  private var encoder: Mp4Encoder? = null
  private val lock = Any()

  override fun definition() = ModuleDefinition {
    Name("ZumiVideoEncoder")

    AsyncFunction("start") { fileUri: String, width: Int, height: Int, bitRate: Int, frameRate: Int ->
      synchronized(lock) {
        encoder?.cancel()
        encoder = null
        val path = Uri.parse(fileUri).path ?: throw VideoEncodingException("Invalid file location.")
        encoder = try {
          Mp4Encoder(File(path), width, height, bitRate, frameRate)
        } catch (e: Exception) {
          throw VideoEncodingException("This device cannot encode a $width x $height video.", e)
        }
      }
    }

    AsyncFunction("appendFrame") { rgba: ByteArray, ptsUs: Double ->
      synchronized(lock) {
        val current = encoder ?: throw VideoEncodingException("No video is being encoded.")
        try {
          current.append(rgba, ptsUs.toLong())
        } catch (e: Exception) {
          current.cancel()
          encoder = null
          throw VideoEncodingException("Encoding the video failed.", e)
        }
      }
    }

    AsyncFunction("finish") { endUs: Double ->
      synchronized(lock) {
        val current = encoder ?: throw VideoEncodingException("No video is being encoded.")
        encoder = null
        try {
          current.finish(endUs.toLong())
        } catch (e: Exception) {
          current.cancel()
          throw VideoEncodingException("Finishing the video failed.", e)
        }
      }
    }

    AsyncFunction("cancel") {
      synchronized(lock) {
        encoder?.cancel()
        encoder = null
      }
    }

    OnDestroy {
      synchronized(lock) {
        encoder?.cancel()
        encoder = null
      }
    }
  }
}
