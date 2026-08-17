/**
 * ImageFrameSampler - Normalizes image data for ingest frames.
 *
 * Resizes images to a consistent maximum size and compresses to JPEG
 * for upload efficiency.
 */

import UIKit

struct ImageFrameSampler {
    static func prepareFrames(
        from images: [Data],
        maxFrames: Int = 12,
        maxSize: CGSize = CGSize(width: 640, height: 360),
        compressionQuality: CGFloat = 0.7
    ) async throws -> [Data] {
        return try await Task.detached(priority: .userInitiated) {
            var results: [Data] = []
            results.reserveCapacity(min(images.count, maxFrames))

            for data in images.prefix(maxFrames) {
                if Task.isCancelled {
                    break
                }
                autoreleasepool {
                    guard let image = UIImage(data: data) else { return }
                    let resized = resize(image, toFit: maxSize)
                    if let jpegData = resized.jpegData(compressionQuality: compressionQuality) {
                        results.append(jpegData)
                    }
                }
            }

            return results
        }.value
    }

    private static func resize(_ image: UIImage, toFit maxSize: CGSize) -> UIImage {
        let widthRatio = maxSize.width / image.size.width
        let heightRatio = maxSize.height / image.size.height
        let scale = min(widthRatio, heightRatio, 1.0)
        let newSize = CGSize(
            width: image.size.width * scale,
            height: image.size.height * scale
        )

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
