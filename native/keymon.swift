// keymon — Sotto's native helper.
// Watches modifier keys (incl. fn) via a CGEventTap, posts paste keystrokes,
// and answers environment queries. Speaks newline-delimited JSON on stdout;
// accepts single-line commands on stdin. All *decision* logic (what counts as
// the hotkey, push-to-talk vs toggle) lives in the Electron main process —
// this binary only reports raw transitions so it can stay small and reliable.
//
// stdout events:
//   {"e":"ready"}                     tap installed and listening
//   {"e":"ax","trusted":bool}         accessibility trust state
//   {"e":"mods","keys":[54],"fn":false}  currently-down modifier keycodes
//   {"e":"key","code":53,"down":true} Esc transitions only
//   {"e":"front","name":"...","bundle":"..."}   reply to front?
//   {"e":"pasted"}                    reply after paste!
//   {"e":"tap_reenabled"}             tap was disabled by timeout and revived
//
// stdin commands: ax? | prompt-ax! | front? | paste! | copy! | rec 0|1 | quit

import Cocoa
import ApplicationServices

var recording = false
var downModifierKeys = Set<Int64>()
var fnDown = false

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func emitMods() {
    emit(["e": "mods", "keys": Array(downModifierKeys).sorted(), "fn": fnDown])
}

let modifierKeyCodes: Set<Int64> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]
let kFnKeyCode: Int64 = 63
let kEscKeyCode: Int64 = 53

func tapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent,
                 refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let tap = tapRef {
            CGEvent.tapEnable(tap: tap, enable: true)
            emit(["e": "tap_reenabled"])
        }
        return Unmanaged.passUnretained(event)
    case .flagsChanged:
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags
        if code == kFnKeyCode {
            let now = flags.contains(.maskSecondaryFn)
            if now != fnDown { fnDown = now; emitMods() }
        } else if modifierKeyCodes.contains(code) {
            // A flagsChanged for a specific modifier keycode toggles that key.
            if downModifierKeys.contains(code) { downModifierKeys.remove(code) }
            else { downModifierKeys.insert(code) }
            // Guard against desync: if no modifier flags remain, clear the set.
            let anyModifierFlag: CGEventFlags = [.maskCommand, .maskShift, .maskControl, .maskAlternate]
            if flags.intersection(anyModifierFlag).isEmpty && !downModifierKeys.isEmpty {
                let capsOnly = downModifierKeys == [57]
                if !capsOnly { downModifierKeys.removeAll() }
            }
            emitMods()
        }
        return Unmanaged.passUnretained(event)
    case .keyDown, .keyUp:
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if code == kEscKeyCode {
            emit(["e": "key", "code": code, "down": type == .keyDown])
            if recording && type == .keyDown {
                return nil // swallow Esc so it only cancels dictation
            }
        }
        return Unmanaged.passUnretained(event)
    default:
        return Unmanaged.passUnretained(event)
    }
}

var tapRef: CFMachPort?

func installTap() -> Bool {
    let mask: CGEventMask =
        (1 << CGEventType.flagsChanged.rawValue) |
        (1 << CGEventType.keyDown.rawValue) |
        (1 << CGEventType.keyUp.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: mask,
        callback: tapCallback,
        userInfo: nil
    ) else { return false }
    tapRef = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
}

// Read the focused text field through the Accessibility API: text before and
// after the cursor (for mid-sentence continuation) and the current selection
// (for Command Mode). Secure fields are never read.
func focusedContext() -> [String: Any] {
    var result: [String: Any] = ["e": "ctx", "ok": false,
                                 "before": "", "after": "", "selected": ""]
    let systemWide = AXUIElementCreateSystemWide()
    var focusedRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
          let focused = focusedRef else { return result }
    let el = focused as! AXUIElement

    var subroleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(el, kAXSubroleAttribute as CFString, &subroleRef)
    if let subrole = subroleRef as? String, subrole == "AXSecureTextField" {
        return result // never read password fields
    }

    var valueRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &valueRef) == .success,
          let value = valueRef as? String else { return result }

    var selTextRef: CFTypeRef?
    AXUIElementCopyAttributeValue(el, kAXSelectedTextAttribute as CFString, &selTextRef)
    let selected = (selTextRef as? String) ?? ""

    var caret = value.count
    var rangeRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
       let rr = rangeRef, CFGetTypeID(rr) == AXValueGetTypeID() {
        var range = CFRange(location: 0, length: 0)
        if AXValueGetValue(rr as! AXValue, .cfRange, &range) {
            caret = min(max(0, range.location), value.count)
        }
    }

    let chars = Array(value)
    let beforeStart = max(0, caret - 240)
    let afterEnd = min(chars.count, caret + 240)
    let safeCaret = min(caret, chars.count)
    result["ok"] = true
    result["before"] = String(chars[beforeStart..<safeCaret])
    result["after"] = String(chars[safeCaret..<afterEnd])
    result["selected"] = String(selected.prefix(4000))
    return result
}

func postKeyChord(virtualKey: CGKeyCode, flags: CGEventFlags) {
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: virtualKey, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: virtualKey, keyDown: false) else { return }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cgSessionEventTap)
    up.post(tap: .cgSessionEventTap)
}

func handle(command raw: String) {
    let cmd = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    switch cmd {
    case "ax?":
        emit(["e": "ax", "trusted": AXIsProcessTrusted()])
    case "prompt-ax!":
        let opts = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        emit(["e": "ax", "trusted": AXIsProcessTrustedWithOptions(opts)])
    case "front?":
        let app = NSWorkspace.shared.frontmostApplication
        emit(["e": "front",
              "name": app?.localizedName ?? "",
              "bundle": app?.bundleIdentifier ?? ""])
    case "ctx?":
        emit(focusedContext())
    case "paste!":
        postKeyChord(virtualKey: 9, flags: .maskCommand) // ⌘V
        emit(["e": "pasted"])
    case "copy!":
        postKeyChord(virtualKey: 8, flags: .maskCommand) // ⌘C
        emit(["e": "copied"])
    case "enter!":
        postKeyChord(virtualKey: 36, flags: []) // Return
        emit(["e": "entered"])
    case "rec 1":
        recording = true
    case "rec 0":
        recording = false
    case "test-fn 1":
        // Test hook: synthesize an fn press so automated tests can exercise
        // the whole pipeline without real keyboard input.
        fnDown = true
        emitMods()
    case "test-fn 0":
        fnDown = false
        emitMods()
    case "quit":
        exit(0)
    default:
        // "pb! <base64>" — set the pasteboard with the concealed-type marker
        // so clipboard managers (Maccy, Paste, Raycast) skip the transient
        // dictation text.
        if cmd.hasPrefix("pb! ") {
            let b64 = String(cmd.dropFirst(4))
            if let data = Data(base64Encoded: b64),
               let text = String(data: data, encoding: .utf8) {
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setString(text, forType: .string)
                // nspasteboard.org convention: transient + auto-generated +
                // source, so clipboard managers skip dictation text.
                pb.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
                pb.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType"))
                pb.setString("dev.haolin.sotto", forType: NSPasteboard.PasteboardType("org.nspasteboard.source"))
                emit(["e": "pbset"])
            }
        }
    }
}

// stdin reader
let stdinQueue = DispatchQueue(label: "stdin")
stdinQueue.async {
    while let line = readLine(strippingNewline: true) {
        DispatchQueue.main.async { handle(command: line) }
    }
    // Parent closed the pipe (Electron quit or crashed) — exit so we never
    // linger as an orphaned event tap.
    DispatchQueue.main.async { exit(0) }
}

let trusted = AXIsProcessTrusted()
emit(["e": "ax", "trusted": trusted])

func tryInstall() {
    if installTap() {
        emit(["e": "ready"])
    } else {
        // Not trusted yet (or tap refused) — poll until it works.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            emit(["e": "ax", "trusted": AXIsProcessTrusted()])
            tryInstall()
        }
    }
}
tryInstall()

CFRunLoopRun()
