// calmon — Sotto's calendar reader, for pre-meeting briefs.
//
// Reads upcoming events (title, time, attendees, notes, location) so the app
// can prepare a brief before a call. Read-only: it never writes to calendars.
//
// stdin commands:  auth?  |  request!  |  upcoming <hours>  |  quit
// stdout: one JSON object per line
//   {"e":"auth","status":"authorized|denied|notDetermined|restricted"}
//   {"e":"events","events":[{ id,title,start,end,location,notes,organizer,
//                             attendees:[{name,email}] }]}

import Foundation
import EventKit

let store = EKEventStore()

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func authStatusString() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    case .fullAccess: return "authorized"
    case .writeOnly: return "writeOnly"
    @unknown default: return "unknown"
    }
}

func requestAccess() {
    // The completion lands on an arbitrary queue, and this process spends the
    // rest of its life blocked on readLine, so wait here and pump the run loop
    // rather than hoping the callback finds somewhere to run.
    let sem = DispatchSemaphore(value: 0)
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, _ in sem.signal() }
    } else {
        store.requestAccess(to: .event) { _, _ in sem.signal() }
    }
    let deadline = Date().addingTimeInterval(120)
    while sem.wait(timeout: .now() + 0.05) == .timedOut {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        if Date() > deadline { break }   // prompt left unanswered
    }
    emit(["e": "auth", "status": authStatusString()])
}

func emailOf(_ p: EKParticipant) -> String {
    // EKParticipant exposes the address as a mailto: URL.
    let s = p.url.absoluteString
    return s.hasPrefix("mailto:") ? String(s.dropFirst("mailto:".count)) : s
}

// What this participant said. A meeting you declined is not your meeting.
func myStatus(_ ev: EKEvent) -> String {
    for p in ev.attendees ?? [] where p.isCurrentUser {
        switch p.participantStatus {
        case .accepted: return "accepted"
        case .declined: return "declined"
        case .tentative: return "tentative"
        default: return "pending"
        }
    }
    return ""
}

func upcoming(hours: Double) {
    let now = Date()
    let end = now.addingTimeInterval(hours * 3600)
    let predicate = store.predicateForEvents(withStart: now.addingTimeInterval(-900),
                                             end: end, calendars: nil)
    let iso = ISO8601DateFormatter()
    var out: [[String: Any]] = []
    for ev in store.events(matching: predicate) {
        if ev.isAllDay { continue }
        if ev.status == .canceled { continue }
        var attendees: [[String: String]] = []
        for p in ev.attendees ?? [] {
            if p.isCurrentUser { continue }
            attendees.append(["name": p.name ?? "", "email": emailOf(p)])
        }
        out.append([
            "id": ev.eventIdentifier ?? UUID().uuidString,
            "title": ev.title ?? "Untitled",
            "start": iso.string(from: ev.startDate),
            "end": iso.string(from: ev.endDate),
            "startMs": ev.startDate.timeIntervalSince1970 * 1000,
            "endMs": ev.endDate.timeIntervalSince1970 * 1000,
            "location": ev.location ?? "",
            "notes": String((ev.notes ?? "").prefix(2000)),
            "organizer": ev.organizer?.name ?? "",
            "attendees": attendees,
            "url": ev.url?.absoluteString ?? "",
            "myStatus": myStatus(ev),
            // Events marked free are usually blocks you put on your own day.
            "free": ev.availability == .free,
        ])
    }
    out.sort { (($0["startMs"] as? Double) ?? 0) < (($1["startMs"] as? Double) ?? 0) }
    emit(["e": "events", "events": out])
}

func handle(_ raw: String) {
    let cmd = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if cmd == "auth?" {
        emit(["e": "auth", "status": authStatusString()])
    } else if cmd == "request!" {
        requestAccess()
    } else if cmd.hasPrefix("upcoming") {
        let parts = cmd.split(separator: " ")
        let hours = parts.count > 1 ? (Double(parts[1]) ?? 12) : 12
        if authStatusString() == "authorized" {
            upcoming(hours: hours)
        } else {
            emit(["e": "events", "events": [], "reason": authStatusString()])
        }
    } else if cmd == "quit" {
        exit(0)
    }
}

DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        DispatchQueue.main.async { handle(line) }
    }
    DispatchQueue.main.async { exit(0) }
}

emit(["e": "ready", "status": authStatusString()])
RunLoop.main.run()
