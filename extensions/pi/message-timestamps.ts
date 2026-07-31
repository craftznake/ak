import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// message-timestamps: appends a small, dim "sent at" line after every user
// and assistant message so it's visible in the transcript at what time each
// message was sent. Implemented as a TUI-only custom entry (pi.appendEntry)
// so it never becomes part of the LLM context.
//
// Toggle with /timestamps [on|off]. Entries already written to a session
// persist and keep rendering on resume; toggling off only stops new ones
// from being added.

type MessageRole = "user" | "assistant";

interface TimestampEntryData {
    role: MessageRole;
    timestamp: number;
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTimestamp(ts: number): string {
    const date = new Date(ts);
    const time = date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    if (isSameDay(date, new Date())) return time;
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export default function messageTimestamps(pi: ExtensionAPI) {
    let enabled = true;

    pi.registerEntryRenderer<TimestampEntryData>("message-timestamp", (entry, _options, theme) => {
        const data = entry.data;
        if (!data) return new Text("", 0, 0);
        const label = data.role === "user" ? "you" : "assistant";
        return new Text(theme.fg("dim", `  ${formatTimestamp(data.timestamp)} \u00b7 ${label}`), 0, 0);
    });

    pi.on("message_end", (event) => {
        if (!enabled) return;
        if (event.message.role !== "user" && event.message.role !== "assistant") return;

        const role = event.message.role;
        // Note: event.message.timestamp is stamped by the provider stream at the
        // *start* of the LLM request (see pi-ai's provider stream() implementations),
        // not when the reply finishes. For assistant messages that makes it land right
        // next to the user message's timestamp regardless of actual response latency.
        // Use Date.now() here instead so the assistant entry reflects when the reply
        // was actually finalized/received.
        const timestamp = role === "user" ? event.message.timestamp : Date.now();

        // Core persists the finalized message (sessionManager.appendMessage) only
        // *after* awaiting our message_end handler, so appending our caption entry
        // synchronously here would insert it into the tree before the message it's
        // captioning. Defer to the next macrotask so the message is already
        // persisted and rendered, putting the timestamp caption below it.
        setImmediate(() => {
            pi.appendEntry<TimestampEntryData>("message-timestamp", { role, timestamp });
        });
    });

    pi.registerCommand("timestamps", {
        description: "Toggle a sent-at timestamp line after each user/assistant message (usage: /timestamps [on|off])",
        handler: async (args, ctx) => {
            const arg = args.trim().toLowerCase();
            if (arg === "on") enabled = true;
            else if (arg === "off") enabled = false;
            else enabled = !enabled;

            ctx.ui.setStatus("message-timestamps", enabled ? undefined : "timestamps: off");
            ctx.ui.notify(`Message timestamps ${enabled ? "enabled" : "disabled"}`, "info");
        },
    });
}
