import ExpoModulesCore
import Photos
import UIKit
import Vision

/// On-device photo tagging for Guess Where candidate ranking.
///
/// DESIGN RULE: this module returns RAW signals only. Every threshold and every
/// interpretation lives in TypeScript (`src/services/quiz/tagSignals.ts`), so
/// tuning ships over-the-air and is unit-testable. Adding interpretation here
/// would mean an App Store build for every threshold change.
///
/// Pixels come from local Photos thumbnails with network access DISABLED, so an
/// iCloud-offloaded original costs nothing and is reported as `no-local-image`
/// rather than failing. A batch always resolves; per-asset problems land in the
/// per-asset `status` field.
public class PhotoTaggerModule: Module {
  /// 512px is enough for scene classification and body/face geometry while
  /// keeping decode cost low. Vision runs on the Neural Engine either way.
  private static let targetSize = CGSize(width: 512, height: 512)
  private static let maxLabels = 10
  private static let minLabelConfidence: Float = 0.05
  /// Vision already saturates the ANE; more parallelism buys nothing and risks
  /// thermal throttling on a background pass the user did not ask for.
  private static let concurrency = 2

  private let workQueue = DispatchQueue(
    label: "com.atlasi.phototagger",
    qos: .utility,
    attributes: .concurrent
  )

  public func definition() -> ModuleDefinition {
    Name("PhotoTagger")

    Function("capabilities") { () -> [String: Any] in
      let info = ProcessInfo.processInfo
      var aesthetics = false
      if #available(iOS 18.0, *) {
        aesthetics = true
      }
      return [
        "aesthetics": aesthetics,
        "osMajor": info.operatingSystemVersion.majorVersion,
        "lowPower": info.isLowPowerModeEnabled,
        "thermalState": Self.thermalStateName(info.thermalState)
      ]
    }

    AsyncFunction("tagPhotos") { (assetIds: [String]) -> [[String: Any]] in
      self.tagPhotos(assetIds: assetIds)
    }

    AsyncFunction("readPhotoMeta") { (assetIds: [String]) -> [[String: Any]] in
      Self.readPhotoMeta(assetIds: assetIds)
    }
  }

  // MARK: - Batch

  private func tagPhotos(assetIds: [String]) -> [[String: Any]] {
    guard !assetIds.isEmpty else { return [] }

    var assetsById: [String: PHAsset] = [:]
    PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
      .enumerateObjects { asset, _, _ in
        assetsById[asset.localIdentifier] = asset
      }

    // Pre-fill so an id that never gets scheduled still returns a row: the
    // caller relies on being able to record SOMETHING for every id, otherwise
    // the same photo is retried on every pass forever.
    var results = assetIds.map { Self.emptyTag(id: $0, status: "not-found") }

    let lock = NSLock()
    let group = DispatchGroup()
    let semaphore = DispatchSemaphore(value: Self.concurrency)

    for (index, id) in assetIds.enumerated() {
      guard let asset = assetsById[id] else { continue }

      semaphore.wait()
      group.enter()
      workQueue.async {
        // Vision holds sizeable intermediates; without a per-asset pool a
        // 32-photo chunk accumulates all of them before the queue drains.
        autoreleasepool {
          let tag = Self.tagAsset(id: id, asset: asset)
          lock.lock()
          results[index] = tag
          lock.unlock()
        }
        semaphore.signal()
        group.leave()
      }
    }

    group.wait()
    return results
  }

  // MARK: - Metadata pass

  /// Intent/context metadata for a batch of assets. Zero pixels by design: no
  /// PHImageManager, no decode, so a call covers the whole library in seconds
  /// where the pixel pass is budgeted. Same DESIGN RULE as tagPhotos: raw
  /// values only, every threshold and interpretation lives in TypeScript.
  ///
  /// Same contract as tagPhotos too: one row per requested id, ALWAYS. An id
  /// that no longer resolves gets an all-false/null row, because the caller
  /// relies on being able to record something for every id - otherwise the same
  /// missing photo is retried on every pass forever.
  private static func readPhotoMeta(assetIds: [String]) -> [[String: Any]] {
    guard !assetIds.isEmpty else { return [] }

    var assetsById: [String: PHAsset] = [:]
    PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
      .enumerateObjects { asset, _, _ in
        assetsById[asset.localIdentifier] = asset
      }

    let albumAssetIds = userAlbumAssetIds()

    return assetIds.map { id in
      guard let asset = assetsById[id] else { return emptyMeta(id: id) }
      return metaForAsset(id: id, asset: asset, albumAssetIds: albumAssetIds)
    }
  }

  /// Ids of every asset in a user-created album, built ONCE per readPhotoMeta
  /// call. PhotoKit has no per-id membership query (`fetchAssets(in:)` options
  /// cannot filter by localIdentifier), so the pragmatic option is enumerating
  /// every regular album's contents into a Set. That is linear in total album
  /// size - acceptable because fetch results fault assets lazily, we touch
  /// nothing but the identifier, and the metadata pass runs at most daily.
  private static func userAlbumAssetIds() -> Set<String> {
    var ids = Set<String>()
    let collections = PHAssetCollection.fetchAssetCollections(
      with: .album,
      subtype: .albumRegular,
      options: nil
    )
    collections.enumerateObjects { collection, _, _ in
      PHAsset.fetchAssets(in: collection, options: nil).enumerateObjects { asset, _, _ in
        ids.insert(asset.localIdentifier)
      }
    }
    return ids
  }

  private static func metaForAsset(
    id: String,
    asset: PHAsset,
    albumAssetIds: Set<String>
  ) -> [String: Any] {
    // Adjustment data is exposed as a resource, not a PHAsset property. The
    // enumeration is still metadata-only, but its per-asset cost at library
    // scale is a declared watch item for this pass, not an assumption.
    let hasAdjustments = PHAssetResource.assetResources(for: asset)
      .contains { $0.type == .adjustmentData }

    var subtypes: [String] = []
    let mediaSubtypes = asset.mediaSubtypes
    if mediaSubtypes.contains(.photoPanorama) { subtypes.append("pano") }
    if mediaSubtypes.contains(.photoHDR) { subtypes.append("hdr") }
    if mediaSubtypes.contains(.photoLive) { subtypes.append("live") }
    if mediaSubtypes.contains(.photoDepthEffect) { subtypes.append("depthEffect") }
    if mediaSubtypes.contains(.photoScreenshot) { subtypes.append("screenshot") }

    var burstId: Any = NSNull()
    if let identifier = asset.burstIdentifier { burstId = identifier }

    // Core Location signals invalidity in-band: verticalAccuracy < 0 means the
    // fix carried no altitude, speed < 0 means unknown. Mapping those to null
    // here is normalization of the API's own sentinel, not interpretation.
    var altitude: Any = NSNull()
    var gpsSpeed: Any = NSNull()
    if let location = asset.location {
      if location.verticalAccuracy >= 0 { altitude = location.altitude }
      if location.speed >= 0 { gpsSpeed = location.speed }
    }

    return [
      "id": id,
      "isFavorite": asset.isFavorite,
      "hasAdjustments": hasAdjustments,
      "subtypes": subtypes,
      "burstId": burstId,
      "burstIsRepresentative": asset.representsBurst
        || asset.burstSelectionTypes.contains(.userPick),
      "sourceUserLibrary": asset.sourceType == .typeUserLibrary,
      "altitude": altitude,
      "gpsSpeed": gpsSpeed,
      "inUserAlbum": albumAssetIds.contains(id)
    ]
  }

  /// Row for an id that no longer resolves: booleans false, nullables NSNull.
  /// As with emptyTag, null means "not measured", never a measured value.
  /// `sourceUserLibrary` is the one deliberate exception: false MEANS
  /// "saved from another app" downstream, so an unresolved id must read true
  /// (neutral) rather than being demoted for failing to resolve.
  private static func emptyMeta(id: String) -> [String: Any] {
    return [
      "id": id,
      "isFavorite": false,
      "hasAdjustments": false,
      "subtypes": [String](),
      "burstId": NSNull(),
      "burstIsRepresentative": false,
      "sourceUserLibrary": true,
      "altitude": NSNull(),
      "gpsSpeed": NSNull(),
      "inUserAlbum": false
    ]
  }

  // MARK: - Single asset

  private static func tagAsset(id: String, asset: PHAsset) -> [String: Any] {
    // Free signal: no pixels needed, and works on every iOS version.
    let isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)

    let (image, isInCloud) = requestLocalImage(asset: asset)

    guard let image = image, let cgImage = image.cgImage else {
      // Nothing stored locally is a "try again later", not a failure: iOS
      // re-materializes thumbnails on its own schedule.
      let status = isInCloud || image == nil ? "no-local-image" : "error"
      return emptyTag(id: id, status: status, isScreenshot: isScreenshot)
    }

    let faceRequest = VNDetectFaceRectanglesRequest()

    let humanRequest = VNDetectHumanRectanglesRequest()
    // Revision 2 is what makes full-body detection available at all; leaving the
    // default revision with upperBodyOnly = false silently keeps measuring
    // torsos, which would understate how much of the frame a person occupies --
    // and that fraction is exactly what the people-prominence drop keys on.
    humanRequest.revision = VNDetectHumanRectanglesRequestRevision2
    humanRequest.upperBodyOnly = false

    let classifyRequest = VNClassifyImageRequest()

    var requests: [VNRequest] = [faceRequest, humanRequest, classifyRequest]

    var aestheticsRequest: VNRequest?
    if #available(iOS 18.0, *) {
      let request = VNCalculateImageAestheticsScoresRequest()
      aestheticsRequest = request
      requests.append(request)
    }

    let handler = VNImageRequestHandler(
      cgImage: cgImage,
      orientation: cgOrientation(image.imageOrientation),
      options: [:]
    )

    do {
      // One handler performing every request shares a single decode.
      try handler.perform(requests)
    } catch {
      return emptyTag(id: id, status: "error", isScreenshot: isScreenshot)
    }

    let faces = (faceRequest.results ?? []).map { $0.boundingBox }
    let humans = (humanRequest.results ?? []).map { $0.boundingBox }

    var tag = emptyTag(id: id, status: "ok", isScreenshot: isScreenshot)
    tag["faceCount"] = faces.count
    tag["maxFaceArea"] = maxArea(faces)
    tag["totalFaceArea"] = totalArea(faces)
    tag["humanCount"] = humans.count
    tag["maxHumanArea"] = maxArea(humans)
    tag["totalHumanArea"] = totalArea(humans)
    tag["labels"] = topLabels(classifyRequest.results)

    if #available(iOS 18.0, *) {
      if let observation = aestheticsRequest?.results?.first
        as? VNImageAestheticsScoresObservation {
        tag["aestheticScore"] = Double(observation.overallScore)
        tag["isUtility"] = observation.isUtility
      }
    }

    return tag
  }

  // MARK: - Pixels

  /// Fetch a local-only thumbnail. Returns the image plus whether Photos told us
  /// the asset lives in iCloud, so the caller can tell "offloaded" from "broken".
  private static func requestLocalImage(asset: PHAsset) -> (UIImage?, Bool) {
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.isNetworkAccessAllowed = false
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast

    var image: UIImage?
    var isInCloud = false

    PHImageManager.default().requestImage(
      for: asset,
      targetSize: targetSize,
      contentMode: .aspectFit,
      options: options
    ) { result, info in
      image = result
      if let info = info, (info[PHImageResultIsInCloudKey] as? NSNumber)?.boolValue == true {
        isInCloud = true
      }
    }

    return (image, isInCloud)
  }

  // MARK: - Helpers

  private static func maxArea(_ boxes: [CGRect]) -> Double {
    boxes.map { Double($0.width * $0.height) }.max() ?? 0
  }

  private static func totalArea(_ boxes: [CGRect]) -> Double {
    // Deliberately a plain sum, not a union: overlapping detections of the same
    // person inflate it, which is why TS ranks on maxArea and treats the total
    // as a weak "how crowded" hint only.
    boxes.reduce(0) { $0 + Double($1.width * $1.height) }
  }

  private static func topLabels(_ results: [VNClassificationObservation]?) -> [[String: Any]] {
    guard let results = results else { return [] }
    return
      results
      .filter { $0.confidence >= minLabelConfidence }
      .sorted { $0.confidence > $1.confidence }
      .prefix(maxLabels)
      .map { ["identifier": $0.identifier, "confidence": Double($0.confidence)] }
  }

  /// A row with every numeric signal zeroed and every iOS-18-only signal null.
  /// `NSNull` matters: null means "not measured on this OS", which TypeScript
  /// must not confuse with a measured false.
  private static func emptyTag(
    id: String,
    status: String,
    isScreenshot: Bool = false
  ) -> [String: Any] {
    return [
      "id": id,
      "status": status,
      "isScreenshot": isScreenshot,
      "faceCount": 0,
      "maxFaceArea": 0,
      "totalFaceArea": 0,
      "humanCount": 0,
      "maxHumanArea": 0,
      "totalHumanArea": 0,
      "labels": [[String: Any]](),
      "aestheticScore": NSNull(),
      "isUtility": NSNull()
    ]
  }

  private static func thermalStateName(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }

  private static func cgOrientation(_ orientation: UIImage.Orientation)
    -> CGImagePropertyOrientation {
    switch orientation {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
