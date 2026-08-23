import BackgroundTasks
import Foundation
import UIKit

/// Owns the one continued-processing task this app ever holds, plus the
/// `UIBackgroundTask` grace assertion beneath it.
///
/// Three native states for the continued task — `idle`, `pending` (request
/// submitted, launch handler not yet fired), `running` (task held) — and a
/// grace-assertion flag orthogonal to them. A LEASE (`leaseId`) is the JS-side
/// unit: it begins when JS asks and ends when JS says so; the continued task
/// and the grace assertion are the two tiers that try to honor it.
///
/// Every event carries the `leaseId` it belongs to, because events can arrive
/// after a thaw, after JS has begun a new lease, or twice (continued expiry
/// followed by grace expiry), and JS cannot tell those apart from state alone.
final class ContinuedTaskHolder {
  static let shared = ContinuedTaskHolder()

  /// The ONE static identifier. Wildcards do not match a single registered
  /// handler and registering twice crashes, so this never varies per job.
  static let identifier = "com.atlasi.app.continued-processing"

  enum TaskState: String {
    case idle
    case pending
    case running
  }

  /// At most this many `Progress` pushes per second reach the task (Apple DTS: 2-10/s).
  private static let minProgressInterval: TimeInterval = 0.25

  private let lock = NSLock()
  private let timerQueue = DispatchQueue(label: "com.atlasi.jobcontinuation.progress")

  private(set) var taskState: TaskState = .idle
  private(set) var leaseId: String?
  /// `BGContinuedProcessingTask` on iOS 26+. Typed as `Any` so the class compiles on older SDK paths.
  private var task: Any?
  private var graceTask: UIBackgroundTaskIdentifier = .invalid

  private var pendingTitle: (title: String, subtitle: String)?
  private var completedUnits: Int64 = 0
  private var totalUnits: Int64 = 0
  private var lastProgressPush: TimeInterval = 0
  private var progressFlush: DispatchWorkItem?

  /// Wired by the module. `(leaseId, state)` and `(leaseId, tier)`.
  var onStateChanged: ((String, String) -> Void)?
  var onExpired: ((String, String) -> Void)?

  private init() {}

  // MARK: - Capabilities

  static func isIdentifierPermitted() -> Bool {
    guard let ids = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] else {
      return false
    }
    return ids.contains(identifier)
  }

  static func supportsContinuedProcessing() -> Bool {
    if #available(iOS 26.0, *) {
      return isIdentifierPermitted()
    }
    return false
  }

  // MARK: - Lease lifecycle (called from JS)

  /// Begin a lease. Generates the `leaseId` BEFORE submitting so a
  /// `stateChanged` event can never race the resolved promise.
  func begin(title: String, subtitle: String) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }

    if let current = leaseId {
      // One lease at a time; the driver serializes end-before-begin.
      return ["leaseId": current, "state": "already-running"]
    }

    let id = UUID().uuidString
    leaseId = id
    completedUnits = 0
    totalUnits = 0
    lastProgressPush = 0
    pendingTitle = (title, subtitle)

    var result: [String: Any] = ["leaseId": id, "state": "grace-only"]
    if #available(iOS 26.0, *), Self.isIdentifierPermitted() {
      let request = BGContinuedProcessingTaskRequest(
        identifier: Self.identifier,
        title: title,
        subtitle: subtitle
      )
      request.strategy = .queue
      request.requiredResources = []
      do {
        try BGTaskScheduler.shared.submit(request)
        taskState = .pending
        result["state"] = "pending"
      } catch {
        taskState = .idle
        result["reason"] = "submit-failed: \(error.localizedDescription)"
      }
    } else {
      result["reason"] = Self.isIdentifierPermitted() ? "os-too-old" : "identifier-not-permitted"
    }

    // If the app is ALREADY in the background (a start that landed during the
    // transition), the grace assertion has to begin now — there will be no
    // `OnAppEntersBackground` to start it.
    DispatchQueue.main.async { [weak self] in
      if UIApplication.shared.applicationState == .background {
        self?.appEnteredBackground()
      }
    }
    return result
  }

  /// The launch handler fired. Called on the scheduler's queue.
  @available(iOS 26.0, *)
  func handleLaunch(_ continued: BGContinuedProcessingTask) {
    lock.lock()
    guard let id = leaseId, taskState == .pending else {
      // No active lease: JS reloaded, or `end()` raced the handler. Nothing
      // will ever feed this task, so complete it now rather than letting the
      // system UI show a ghost.
      lock.unlock()
      continued.setTaskCompleted(success: false)
      return
    }
    task = continued
    taskState = .running
    continued.expirationHandler = { [weak self] in
      self?.expireContinued(leaseId: id)
    }
    if let title = pendingTitle {
      continued.updateTitle(title.title, subtitle: title.subtitle)
      pendingTitle = nil
    }
    if totalUnits > 0 {
      continued.progress.totalUnitCount = totalUnits
      continued.progress.completedUnitCount = completedUnits
      lastProgressPush = Date().timeIntervalSince1970
    }
    let callback = onStateChanged
    lock.unlock()
    callback?(id, "running")
  }

  func updateProgress(completed: Int64, total: Int64) {
    lock.lock()
    // Only ever increasing within a lease, whatever the caller sends.
    totalUnits = max(totalUnits, total)
    completedUnits = min(max(completedUnits, completed), max(totalUnits, 1))
    let now = Date().timeIntervalSince1970
    let sinceLast = now - lastProgressPush
    if sinceLast >= Self.minProgressInterval {
      progressFlush?.cancel()
      progressFlush = nil
      applyProgressLocked(at: now)
      lock.unlock()
      return
    }
    // Coalesce: one flush at the next allowed slot carries the latest value.
    if progressFlush == nil {
      let item = DispatchWorkItem { [weak self] in
        guard let self else { return }
        self.lock.lock()
        self.progressFlush = nil
        self.applyProgressLocked(at: Date().timeIntervalSince1970)
        self.lock.unlock()
      }
      progressFlush = item
      timerQueue.asyncAfter(deadline: .now() + (Self.minProgressInterval - sinceLast), execute: item)
    }
    lock.unlock()
  }

  private func applyProgressLocked(at now: TimeInterval) {
    lastProgressPush = now
    if #available(iOS 26.0, *), let continued = task as? BGContinuedProcessingTask, totalUnits > 0 {
      continued.progress.totalUnitCount = totalUnits
      continued.progress.completedUnitCount = completedUnits
    }
  }

  func updateTitle(title: String, subtitle: String) {
    lock.lock()
    defer { lock.unlock() }
    if #available(iOS 26.0, *), let continued = task as? BGContinuedProcessingTask {
      continued.updateTitle(title, subtitle: subtitle)
    } else {
      pendingTitle = (title, subtitle)
    }
  }

  /// End the lease: cancel a pending request, complete a running task, drop
  /// the grace assertion. Idempotent.
  func end(success: Bool) {
    lock.lock()
    leaseId = nil
    pendingTitle = nil
    progressFlush?.cancel()
    progressFlush = nil
    let state = taskState
    let held = task
    task = nil
    taskState = .idle
    lock.unlock()

    if #available(iOS 26.0, *) {
      switch state {
      case .pending:
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
      case .running:
        (held as? BGContinuedProcessingTask)?.setTaskCompleted(success: success)
      case .idle:
        break
      }
    }
    endGrace()
  }

  // MARK: - Expiration

  private func expireContinued(leaseId expiredId: String) {
    lock.lock()
    guard leaseId == expiredId, taskState == .running, let held = task else {
      lock.unlock()
      return
    }
    task = nil
    taskState = .idle
    let callback = onExpired
    lock.unlock()
    // Tell JS first, then complete: all expirations — system reclaim and a
    // cancel from the system UI are indistinguishable — are treated the same.
    callback?(expiredId, "continued")
    if #available(iOS 26.0, *) {
      (held as? BGContinuedProcessingTask)?.setTaskCompleted(success: false)
    }
  }

  // MARK: - Grace window (UIBackgroundTask)

  func appEnteredBackground() {
    lock.lock()
    guard let id = leaseId, graceTask == .invalid else {
      lock.unlock()
      return
    }
    graceTask = UIApplication.shared.beginBackgroundTask(withName: "atlasi.library-job-grace") { [weak self] in
      self?.expireGrace(leaseId: id)
    }
    lock.unlock()
  }

  func appEnteredForeground() {
    endGrace()
  }

  private func expireGrace(leaseId expiredId: String) {
    lock.lock()
    let stillOurs = leaseId == expiredId
    let continuedRunning = taskState == .running
    let callback = onExpired
    lock.unlock()
    endGrace()
    // Only the grace tier is ending. If a continued task is running the lease
    // is still honored and JS must not hear an expiry.
    if stillOurs && !continuedRunning {
      callback?(expiredId, "grace")
    }
  }

  private func endGrace() {
    lock.lock()
    let handle = graceTask
    graceTask = .invalid
    lock.unlock()
    if handle != .invalid {
      UIApplication.shared.endBackgroundTask(handle)
    }
  }
}
