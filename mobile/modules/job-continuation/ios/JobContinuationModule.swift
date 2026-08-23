import ExpoModulesCore
import UIKit

/// JS surface over `ContinuedTaskHolder`.
///
/// OPTIONAL by construction: the JS side requires this module lazily and every
/// driver path is a no-op when it is absent, so the bundle stays safe to publish
/// over the air onto binaries built before this module existed.
public class JobContinuationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("JobContinuation")

    Events("stateChanged", "expired")

    OnCreate {
      let holder = ContinuedTaskHolder.shared
      holder.onStateChanged = { [weak self] leaseId, state in
        DispatchQueue.main.async {
          self?.sendEvent("stateChanged", ["leaseId": leaseId, "state": state])
        }
      }
      holder.onExpired = { [weak self] leaseId, tier in
        DispatchQueue.main.async {
          self?.sendEvent("expired", ["leaseId": leaseId, "tier": tier])
        }
      }
    }

    OnDestroy {
      // A dev reload must never leave an orphaned task in the system UI.
      let holder = ContinuedTaskHolder.shared
      holder.onStateChanged = nil
      holder.onExpired = nil
      holder.end(success: false)
    }

    Function("capabilities") { () -> [String: Any] in
      let info = ProcessInfo.processInfo
      return [
        "continuedProcessing": ContinuedTaskHolder.supportsContinuedProcessing(),
        "graceWindow": true,
        "osMajor": info.operatingSystemVersion.majorVersion,
        "lowPowerMode": info.isLowPowerModeEnabled,
        "identifierPermitted": ContinuedTaskHolder.isIdentifierPermitted(),
      ]
    }

    AsyncFunction("backgroundRefreshStatus") { () -> String in
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: return "available"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "unknown"
      }
    }.runOnQueue(.main)

    AsyncFunction("begin") { (options: [String: Any]) -> [String: Any] in
      let title = options["title"] as? String ?? ""
      let subtitle = options["subtitle"] as? String ?? ""
      return ContinuedTaskHolder.shared.begin(title: title, subtitle: subtitle)
    }

    Function("updateProgress") { (completed: Int, total: Int) in
      ContinuedTaskHolder.shared.updateProgress(completed: Int64(completed), total: Int64(total))
    }

    Function("updateTitle") { (title: String, subtitle: String) in
      ContinuedTaskHolder.shared.updateTitle(title: title, subtitle: subtitle)
    }

    AsyncFunction("end") { (success: Bool) in
      ContinuedTaskHolder.shared.end(success: success)
    }

    OnAppEntersBackground {
      ContinuedTaskHolder.shared.appEnteredBackground()
    }

    OnAppEntersForeground {
      ContinuedTaskHolder.shared.appEnteredForeground()
    }
  }
}
