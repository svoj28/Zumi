package expo.modules.zumikeyboard

import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Hardware keyboard shortcuts: key presses the app's views do not use (see ZumiKeyboardPackage)
 * are sent to JS as "onKey" events.
 */
class ZumiKeyboardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZumiKeyboard")
    Events("onKey")

    OnCreate {
      current = WeakReference(this@ZumiKeyboardModule)
    }

    OnDestroy {
      if (current?.get() === this@ZumiKeyboardModule) current = null
    }
  }

  internal fun emit(keyCode: Int, event: KeyEvent) {
    sendEvent(
      "onKey",
      mapOf(
        "key" to keyName(keyCode, event),
        "shift" to event.isShiftPressed,
        "ctrl" to event.isCtrlPressed,
        "meta" to event.isMetaPressed,
        "alt" to event.isAltPressed,
      ),
    )
  }

  companion object {
    @Volatile
    internal var current: WeakReference<ZumiKeyboardModule>? = null

    private val NAMES = mapOf(
      KeyEvent.KEYCODE_ENTER to "Enter",
      KeyEvent.KEYCODE_ESCAPE to "Escape",
      KeyEvent.KEYCODE_DEL to "Backspace",
      KeyEvent.KEYCODE_FORWARD_DEL to "Delete",
      KeyEvent.KEYCODE_TAB to "Tab",
      KeyEvent.KEYCODE_SPACE to " ",
      KeyEvent.KEYCODE_DPAD_UP to "ArrowUp",
      KeyEvent.KEYCODE_DPAD_DOWN to "ArrowDown",
      KeyEvent.KEYCODE_DPAD_LEFT to "ArrowLeft",
      KeyEvent.KEYCODE_DPAD_RIGHT to "ArrowRight",
    )

    /** The character without modifiers, lower case, or a name for special keys. */
    fun keyName(keyCode: Int, event: KeyEvent): String {
      NAMES[keyCode]?.let { return it }
      val char = event.getUnicodeChar(0)
      return if (char > 0) char.toChar().lowercaseChar().toString() else KeyEvent.keyCodeToString(keyCode)
    }
  }
}