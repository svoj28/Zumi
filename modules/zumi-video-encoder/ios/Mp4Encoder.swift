import Accelerate
import AVFoundation
import CoreMedia
import CoreVideo

enum Mp4EncoderError: LocalizedError {
  case setup(String)
  case notReady
  case noPixelBuffer
  case appendFailed(Error?)

  var errorDescription: String? {
    switch self {
    case .setup(let message): return message
    case .notReady: return "The encoder is not accepting frames."
    case .noPixelBuffer: return "Out of memory for video frames."
    case .appendFailed(let error): return error?.localizedDescription ?? "The frame could not be added."
    }
  }
}

/**
 * H.264 MP4 writer built on AVAssetWriter. Frames arrive as RGBA bytes; vImage reorders them to
 * BGRA (the format the hardware encoder takes) directly into pooled pixel buffers.
 */
final class Mp4Encoder {
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private let url: URL
  private let width: Int
  private let height: Int
  private var lastPtsUs: Int64 = -1

  init(url: URL, width: Int, height: Int, bitRate: Int, frameRate: Int) throws {
    guard width > 0, height > 0, width % 2 == 0, height % 2 == 0 else {
      throw Mp4EncoderError.setup("Video size must be even.")
    }
    self.url = url
    self.width = width
    self.height = height
    try? FileManager.default.removeItem(at: url)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitRate,
        AVVideoExpectedSourceFrameRateKey: frameRate,
        AVVideoMaxKeyFrameIntervalKey: frameRate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ]
    input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
      ]
    )
    guard writer.canAdd(input) else { throw Mp4EncoderError.setup("The video settings are not supported.") }
    writer.add(input)
    guard writer.startWriting() else {
      throw Mp4EncoderError.setup(writer.error?.localizedDescription ?? "The video file could not be created.")
    }
    writer.startSession(atSourceTime: .zero)
  }

  func append(rgba: Data, ptsUs: Int64) throws {
    guard rgba.count >= width * height * 4 else { throw Mp4EncoderError.setup("Frame is smaller than the video.") }
    // Not real-time: wait (briefly) until the encoder can take another frame.
    let deadline = Date().addingTimeInterval(5)
    while !input.isReadyForMoreMediaData {
      if writer.status == .failed { throw Mp4EncoderError.appendFailed(writer.error) }
      if Date() > deadline { throw Mp4EncoderError.notReady }
      Thread.sleep(forTimeInterval: 0.005)
    }
    guard let pool = adaptor.pixelBufferPool else { throw Mp4EncoderError.appendFailed(writer.error) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    guard let pixelBuffer = buffer else { throw Mp4EncoderError.noPixelBuffer }

    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    let converted = rgba.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
      guard let src = raw.baseAddress, let dst = CVPixelBufferGetBaseAddress(pixelBuffer) else { return false }
      var srcBuffer = vImage_Buffer(
        data: UnsafeMutableRawPointer(mutating: src),
        height: vImagePixelCount(height),
        width: vImagePixelCount(width),
        rowBytes: width * 4
      )
      var dstBuffer = vImage_Buffer(
        data: dst,
        height: vImagePixelCount(height),
        width: vImagePixelCount(width),
        rowBytes: CVPixelBufferGetBytesPerRow(pixelBuffer)
      )
      // RGBA → BGRA
      let map: [UInt8] = [2, 1, 0, 3]
      return vImagePermuteChannels_ARGB8888(&srcBuffer, &dstBuffer, map, vImage_Flags(kvImageNoFlags)) == kvImageNoError
    }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
    guard converted else { throw Mp4EncoderError.appendFailed(nil) }

    // Timestamps must strictly increase.
    let pts = ptsUs <= lastPtsUs ? lastPtsUs + 1 : ptsUs
    guard adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: pts, timescale: 1_000_000)) else {
      throw Mp4EncoderError.appendFailed(writer.error)
    }
    lastPtsUs = pts
  }

  /** Closes the file; the last frame stays on screen until `endUs`. */
  func finish(endUs: Int64, completion: @escaping (Error?) -> Void) {
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTime(value: max(endUs, lastPtsUs + 1), timescale: 1_000_000))
    let writer = self.writer
    writer.finishWriting {
      completion(writer.status == .completed ? nil : (writer.error ?? Mp4EncoderError.appendFailed(nil)))
    }
  }

  func cancel() {
    if writer.status == .writing { writer.cancelWriting() }
    try? FileManager.default.removeItem(at: url)
  }
}
