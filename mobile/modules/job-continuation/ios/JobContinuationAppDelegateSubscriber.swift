import BackgroundTasks
import ExpoModulesCore

/// Registers the continued-processing launch handler at `didFinishLaunching`.
///
/// ONE static identifier, registered ONCE per process (a second registration
/// of the same identifier crashes), and registered at launch regardless of
/// whether Apple exempts continued-processing identifiers from the launch-time
/// rule — registering here is correct under both readings. The handler itself
/// does nothing but hand the task to `ContinuedTaskHolder`, which owns it.
public class JobContinuationAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if #available(iOS 26.0, *) {
      guard ContinuedTaskHolder.isIdentifierPermitted() else {
        return true
      }
      BGTaskScheduler.shared.register(
        forTaskWithIdentifier: ContinuedTaskHolder.identifier,
        using: nil
      ) { task in
        guard let continued = task as? BGContinuedProcessingTask else {
          task.setTaskCompleted(success: false)
          return
        }
        ContinuedTaskHolder.shared.handleLaunch(continued)
      }
    }
    return true
  }
}
