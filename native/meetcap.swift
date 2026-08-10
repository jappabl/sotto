// meetcap — Sotto's meeting-capture helper.
// Captures SYSTEM audio (what you hear: the other meeting participants) via a
// CoreAudio process tap (macOS 14.2+), and the MICROPHONE (you) via
// AVAudioEngine, simultaneously. Each source is downmixed/resampled to
// 16 kHz mono Int16 and flushed to alternating WAV chunk files, announced as
// JSON lines on stdout so the Electron side can transcribe incrementally.
//
//   meetcap --dir /path/to/chunks [--chunk 30]
//
// stdout events (one JSON per line):
//   {"e":"ready"}                        both captures running
//   {"e":"chunk","kind":"sys"|"mic","file":"sys-0001.wav","t0":12.0,"t1":42.0}
//   {"e":"level","mic":0.01,"sys":0.03}  ~4 Hz, for UI meters
//   {"e":"error","message":"..."}
// stdin commands: "flush" (cut chunks now) | "stop" (final flush + exit)

import Foundation
import CoreAudio
import AVFoundation

let args = CommandLine.arguments
func argValue(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}
guard let outDirPath = argValue("--dir") else {
    FileHandle.standardError.write("usage: meetcap --dir <outdir> [--chunk seconds]\n".data(using: .utf8)!)
    exit(2)
}
let chunkSeconds = Double(argValue("--chunk") ?? "30") ?? 30
let outDir = URL(fileURLWithPath: outDirPath)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let stdoutLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    stdoutLock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    stdoutLock.unlock()
}

// ---------------------------------------------------------------------------
// 16 kHz mono Int16 accumulator that flushes WAV chunks.
// ---------------------------------------------------------------------------

final class ChunkWriter {
    let kind: String
    private var samples: [Int16] = []
    private var chunkIndex = 0
    private var chunkStartTime: Double
    private let startTime: Double
    private let lock = NSLock()
    var lastRms: Double = 0

    init(kind: String) {
        self.kind = kind
        self.startTime = Date().timeIntervalSince1970
        self.chunkStartTime = 0
    }

    func append(_ newSamples: [Int16]) {
        lock.lock()
        samples.append(contentsOf: newSamples)
        var sum = 0.0
        let tail = newSamples.suffix(1600)
        for s in tail { let v = Double(s) / 32768.0; sum += v * v }
        if !tail.isEmpty { lastRms = (sum / Double(tail.count)).squareRoot() }
        let shouldFlush = Double(samples.count) / 16000.0 >= chunkSeconds
        lock.unlock()
        if shouldFlush { flush() }
    }

    func flush() {
        lock.lock()
        guard samples.count > 1600 else { lock.unlock(); return } // ≥0.1 s
        let toWrite = samples
        samples = []
        chunkIndex += 1
        let idx = chunkIndex
        let t0 = chunkStartTime
        let t1 = t0 + Double(toWrite.count) / 16000.0
        chunkStartTime = t1
        lock.unlock()

        let name = String(format: "%@-%04d.wav", kind, idx)
        let url = outDir.appendingPathComponent(name)
        var data = Data()
        let dataLen = toWrite.count * 2
        func le32(_ v: Int) { var x = UInt32(v).littleEndian; data.append(Data(bytes: &x, count: 4)) }
        func le16(_ v: Int) { var x = UInt16(v).littleEndian; data.append(Data(bytes: &x, count: 2)) }
        data.append("RIFF".data(using: .ascii)!); le32(36 + dataLen)
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!); le32(16); le16(1); le16(1)
        le32(16000); le32(32000); le16(2); le16(16)
        data.append("data".data(using: .ascii)!); le32(dataLen)
        toWrite.withUnsafeBufferPointer { data.append(Data(buffer: $0)) }
        try? data.write(to: url)
        emit(["e": "chunk", "kind": kind, "file": name, "t0": t0, "t1": t1])
    }
}

// Downmix any float32 buffer to 16 kHz mono Int16 by averaging channels and
// linear-resampling.
func convertToInt16Mono16k(_ buffers: UnsafeMutableAudioBufferListPointer,
                           frames: Int, channels: Int, sampleRate: Double,
                           interleaved: Bool) -> [Int16] {
    guard frames > 0 else { return [] }
    var mono = [Float](repeating: 0, count: frames)
    if interleaved, let base = buffers[0].mData?.assumingMemoryBound(to: Float.self) {
        for f in 0..<frames {
            var acc: Float = 0
            for c in 0..<channels { acc += base[f * channels + c] }
            mono[f] = acc / Float(channels)
        }
    } else {
        let bufCount = buffers.count
        for b in 0..<bufCount {
            guard let base = buffers[b].mData?.assumingMemoryBound(to: Float.self) else { continue }
            let n = min(frames, Int(buffers[b].mDataByteSize) / 4)
            for f in 0..<n { mono[f] += base[f] }
        }
        if bufCount > 1 { for f in 0..<frames { mono[f] /= Float(bufCount) } }
    }
    let ratio = sampleRate / 16000.0
    let outCount = Int(Double(frames) / ratio)
    var out = [Int16](repeating: 0, count: outCount)
    for i in 0..<outCount {
        let pos = Double(i) * ratio
        let i0 = Int(pos)
        let i1 = min(i0 + 1, frames - 1)
        let frac = Float(pos - Double(i0))
        let v = mono[i0] * (1 - frac) + mono[i1] * frac
        out[i] = Int16(max(-1, min(1, v)) * 32767)
    }
    return out
}

let sysWriter = ChunkWriter(kind: "sys")
let micWriter = ChunkWriter(kind: "mic")

// ---------------------------------------------------------------------------
// System audio: CoreAudio process tap → private aggregate device → IOProc.
// ---------------------------------------------------------------------------

var tapID = AudioObjectID(kAudioObjectUnknown)
var aggID = AudioObjectID(kAudioObjectUnknown)
var ioProcID: AudioDeviceIOProcID?

func startSystemCapture() -> Bool {
    let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    tapDesc.uuid = UUID()
    tapDesc.muteBehavior = .unmuted
    tapDesc.name = "Sotto Meeting Tap"
    tapDesc.isPrivate = true
    var status = AudioHardwareCreateProcessTap(tapDesc, &tapID)
    guard status == noErr, tapID != kAudioObjectUnknown else {
        emit(["e": "error", "message": "process tap failed (status \(status)) — is System Audio Recording permission granted?"])
        return false
    }

    // Read the tap's stream format so we know rate/channels.
    var tapFormat = AudioStreamBasicDescription()
    var propSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    status = AudioObjectGetPropertyData(tapID, &addr, 0, nil, &propSize, &tapFormat)
    guard status == noErr else {
        emit(["e": "error", "message": "tap format read failed (\(status))"])
        return false
    }

    let aggDesc: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: "Sotto Meeting Capture",
        kAudioAggregateDeviceUIDKey as String: "dev.haolin.sotto.meetcap." + UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey as String: true,
        kAudioAggregateDeviceIsStackedKey as String: false,
        kAudioAggregateDeviceTapAutoStartKey as String: true,
        kAudioAggregateDeviceSubDeviceListKey as String: [] as [[String: Any]],
        kAudioAggregateDeviceTapListKey as String: [
            [kAudioSubTapUIDKey as String: tapDesc.uuid.uuidString,
             kAudioSubTapDriftCompensationKey as String: true],
        ],
    ]
    status = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
    guard status == noErr, aggID != kAudioObjectUnknown else {
        emit(["e": "error", "message": "aggregate device failed (\(status))"])
        return false
    }

    let sampleRate = tapFormat.mSampleRate > 0 ? tapFormat.mSampleRate : 48000
    let channels = Int(tapFormat.mChannelsPerFrame > 0 ? tapFormat.mChannelsPerFrame : 2)
    let interleaved = (tapFormat.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0

    status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggID, nil) { _, inInputData, _, _, _ in
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
        guard buffers.count > 0 else { return }
        let frames: Int
        if interleaved {
            frames = Int(buffers[0].mDataByteSize) / (4 * channels)
        } else {
            frames = Int(buffers[0].mDataByteSize) / 4
        }
        let samples = convertToInt16Mono16k(buffers, frames: frames, channels: channels,
                                            sampleRate: sampleRate, interleaved: interleaved)
        sysWriter.append(samples)
    }
    guard status == noErr, let procID = ioProcID else {
        emit(["e": "error", "message": "ioproc failed (\(status))"])
        return false
    }
    status = AudioDeviceStart(aggID, procID)
    guard status == noErr else {
        emit(["e": "error", "message": "device start failed (\(status))"])
        return false
    }
    return true
}

func stopSystemCapture() {
    if let procID = ioProcID, aggID != kAudioObjectUnknown {
        AudioDeviceStop(aggID, procID)
        AudioDeviceDestroyIOProcID(aggID, procID)
    }
    if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID) }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
}

// ---------------------------------------------------------------------------
// Microphone via AVAudioEngine.
// ---------------------------------------------------------------------------

let engine = AVAudioEngine()

func startMicCapture() -> Bool {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0 else {
        emit(["e": "error", "message": "no microphone input available"])
        return false
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
        guard let channelData = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        var mono = [Float](repeating: 0, count: frames)
        for c in 0..<channels {
            let ptr = channelData[c]
            for f in 0..<frames { mono[f] += ptr[f] }
        }
        if channels > 1 { for f in 0..<frames { mono[f] /= Float(channels) } }
        let ratio = buffer.format.sampleRate / 16000.0
        let outCount = Int(Double(frames) / ratio)
        var out = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let pos = Double(i) * ratio
            let i0 = Int(pos)
            let i1 = min(i0 + 1, frames - 1)
            let frac = Float(pos - Double(i0))
            let v = mono[i0] * (1 - frac) + mono[i1] * frac
            out[i] = Int16(max(-1, min(1, v)) * 32767)
        }
        micWriter.append(out)
    }
    do {
        try engine.start()
        return true
    } catch {
        emit(["e": "error", "message": "mic engine failed: \(error.localizedDescription)"])
        return false
    }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

let sysOK = startSystemCapture()
let micOK = startMicCapture()
guard sysOK || micOK else {
    emit(["e": "fatal", "message": "no capture source available"])
    exit(1)
}
emit(["e": "ready", "sys": sysOK, "mic": micOK])

// Level meter for UI (~4 Hz).
let levelTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
levelTimer.schedule(deadline: .now() + 0.25, repeating: 0.25)
levelTimer.setEventHandler {
    emit(["e": "level", "mic": micWriter.lastRms, "sys": sysWriter.lastRms])
}
levelTimer.resume()

DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        switch line {
        case "flush":
            sysWriter.flush()
            micWriter.flush()
        case "stop":
            engine.stop()
            stopSystemCapture()
            sysWriter.flush()
            micWriter.flush()
            emit(["e": "stopped"])
            exit(0)
        default:
            break
        }
    }
    // Parent went away: clean shutdown, flush what we have.
    engine.stop()
    stopSystemCapture()
    sysWriter.flush()
    micWriter.flush()
    exit(0)
}

RunLoop.main.run()
