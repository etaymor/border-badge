/**
 * VideoFrameSampler - Extracts JPEG frames from a video at a fixed interval.
 *
 * Designed for share extension use: low memory overhead, predictable sizing,
 * and a simple API for generating frame data to upload.
 */

import AVFoundation
import UIKit

enum VideoFrameSamplerError: Error {
    case invalidDuration
}

struct VideoFrameSampler {
    static func extractFrames(
        from url: URL,
        intervalSeconds: Double = 2.0,
        maxSize: CGSize = CGSize(width: 640, height: 360),
        compressionQuality: CGFloat = 0.7
    ) async throws -> [Data] {
        let interval = max(0.1, intervalSeconds)

        return try await Task.detached(priority: .userInitiated) {
            let asset = AVAsset(url: url)
            let durationSeconds = CMTimeGetSeconds(asset.duration)
            guard durationSeconds.isFinite, durationSeconds > 0 else {
                return []
            }

            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.requestedTimeToleranceBefore = .zero
            generator.requestedTimeToleranceAfter = .zero
            generator.maximumSize = maxSize

            let endTime = max(0, durationSeconds - 0.05)
            let times = stride(from: 0.0, through: endTime, by: interval).map {
                CMTime(seconds: $0, preferredTimescale: 600)
            }

            var results: [Data] = []
            results.reserveCapacity(times.count)

            for time in times {
                if Task.isCancelled {
                    break
                }
                autoreleasepool {
                    do {
                        var actualTime = CMTime.zero
                        let cgImage = try generator.copyCGImage(at: time, actualTime: &actualTime)
                        let image = UIImage(cgImage: cgImage)
                        if let jpegData = image.jpegData(compressionQuality: compressionQuality) {
                            results.append(jpegData)
                        }
                    } catch {
                        // Skip frames that fail to decode.
                    }
                }
            }

            return results
        }.value
    }
}
