package expo.modules.zumikeyboard

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

/**
 * Receives the activity's key presses (those no focused view consumed, so typing in text fields
 * is unaffected) and forwards them to JS. Never consumes them: system keys keep working.
 */
class ZumiKeyboardPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context): List<ReactActivityHandler> =
    listOf(
      object : ReactActivityHandler {
        override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
          if (event == null || keyCode == KeyEvent.KEYCODE_BACK) return false
          ZumiKeyboardModule.current?.get()?.emit(keyCode, event)
          return false
        }
      },
    )
}