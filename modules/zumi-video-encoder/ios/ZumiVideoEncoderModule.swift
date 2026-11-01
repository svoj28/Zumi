import ExpoModulesCore

final class VideoEncodingException: GenericException<String> {
  override var reason: String { param }
}

/**
 * Encodes RGBA frames from JS into an H.264 MP4 (see Mp4Encoder). One video at a time; JS awaits
 * every call, so calls never overlap.
 */
public class ZumiVideoEncoderModule: Module {
  private var encoder: Mp4Encoder?
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("ZumiVideoEncoder")

    AsyncFunction("start") { (fileUri: String, width: Int, height: Int, bitRate: Int, frameRate: Int) in
      self.lock.lock()
      defer { self.lock.unlock() }
      self.encoder?.cancel()
      self.encoder = nil
      guard let url = URL(string: fileUri), url.isFileURL else {
        throw VideoEncodingException("Invalid file location.")
      }
      do {
        self.encoder = try Mp4Encoder(url: url, width: width, height: height, bitRate: bitRate, frameRate: frameRate)
      } catch {
        throw VideoEncodingException("This device cannot encode a \(width) x \(height) video: \(error.localizedDescription)")
      }
    }

    AsyncFunction("appendFrame") { (rgba: Data, ptsUs: Double) in
      self.lock.lock()
      defer { self.lock.unlock() }
      guard let encoder = self.encoder else { throw VideoEncodingException("No video is being encoded.") }
      do {
        try encoder.append(rgba: rgba, ptsUs: Int64(ptsUs))
      } catch {
        encoder.cancel()
        self.encoder = nil
        throw VideoEncodingException("Encoding the video failed: \(error.localizedDescription)")
      }
    }

    AsyncFunction("finish") { (endUs: Double, promise: Promise) in
      self.lock.lock()
      let encoder = self.encoder
      self.encoder = nil
      self.lock.unlock()
      guard let encoder = encoder else {
        promise.reject(VideoEncodingException("No video is being encoded."))
        return
      }
      encoder.finish(endUs: Int64(endUs)) { error in
        if let error = error {
          promise.reject(VideoEncodingException("Finishing the video failed: \(error.localizedDescription)"))
        } else {
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("cancel") {
      self.lock.lock()
      defer { self.lock.unlock() }
      self.encoder?.cancel()
      self.encoder = nil
    }

    OnDestroy {
      self.lock.lock()
      defer { self.lock.unlock() }
      self.encoder?.cancel()
      self.encoder = nil
    }
  }
}
