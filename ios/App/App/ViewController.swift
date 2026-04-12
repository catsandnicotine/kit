import UIKit
import AVFoundation
import Capacitor

/// Custom bridge view controller that configures the audio session
/// after Capacitor has finished its own WebView setup. This ensures
/// card audio from <audio> elements mixes with background music
/// instead of pausing it.
class ViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        // Re-assert the audio session category after Capacitor's WebView
        // has initialised — WKWebView can override the app-level session
        // when it first loads.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: .mixWithOthers)
        try? session.setActive(true)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        // Belt-and-suspenders: re-assert after the view is fully on screen,
        // in case the WebView's first audio load resets the session.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
    }
}
