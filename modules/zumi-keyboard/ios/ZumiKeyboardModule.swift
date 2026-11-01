import ExpoModulesCore
import UIKit

/** Hardware keyboard shortcuts: an invisible view that keeps keyboard focus and reports presses. */
public class ZumiKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZumiKeyboard")
    Events("onKey")

    View(ZumiKeyCaptureView.self) {
      Events("onKey")
    }
  }
}

final class ZumiKeyCaptureView: ExpoView {
  let onKey = EventDispatcher()
  private var timer: Timer?

  override var canBecomeFirstResponder: Bool { true }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    timer?.invalidate()
    timer = nil
    guard window != nil else { return }
    reclaimFocus()
    // Text fields take focus while typing; take it back once nothing else has it.
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      self?.reclaimFocus()
    }
  }

  private func reclaimFocus() {
    guard window != nil, !isFirstResponder, UIResponder.zumiCurrentFirstResponder() == nil else { return }
    becomeFirstResponder()
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var handled = false
    for press in presses {
      guard let key = press.key else { continue }
      onKey([
        "key": ZumiKeyCaptureView.name(for: key),
        "shift": key.modifierFlags.contains(.shift),
        "ctrl": key.modifierFlags.contains(.control),
        "meta": key.modifierFlags.contains(.command),
        "alt": key.modifierFlags.contains(.alternate),
      ])
      handled = true
    }
    if !handled {
      super.pressesBegan(presses, with: event)
    }
  }

  private static func name(for key: UIKey) -> String {
    switch key.keyCode {
    case .keyboardReturnOrEnter: return "Enter"
    case .keyboardEscape: return "Escape"
    case .keyboardDeleteOrBackspace: return "Backspace"
    case .keyboardDeleteForward: return "Delete"
    case .keyboardTab: return "Tab"
    case .keyboardUpArrow: return "ArrowUp"
    case .keyboardDownArrow: return "ArrowDown"
    case .keyboardLeftArrow: return "ArrowLeft"
    case .keyboardRightArrow: return "ArrowRight"
    default: return key.charactersIgnoringModifiers.lowercased()
    }
  }

  deinit {
    timer?.invalidate()
  }
}

extension UIResponder {
  private static weak var zumiFound: UIResponder?

  /** The current first responder, if any (found by sending an action to it). */
  static func zumiCurrentFirstResponder() -> UIResponder? {
    zumiFound = nil
    UIApplication.shared.sendAction(#selector(zumiCaptureFirstResponder), to: nil, from: nil, for: nil)
    return zumiFound
  }

  @objc private func zumiCaptureFirstResponder() {
    UIResponder.zumiFound = self
  }
}