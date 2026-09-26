// agent-kit-bootstrap: injects a short agent-kit bootstrap message at session
// start and after compaction, with a dedup guard. Modeled on the superpowers.ts
// pattern (context-event message injection with lifecycle flags).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXTREMELY_IMPORTANT_MARKER = "<EXTREMELY_IMPORTANT>";
const BOOTSTRAP_MARKER = "agent-kit:bootstrap injection for pi";

let injectBootstrap = true;

export default function agentKitBootstrap(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		injectBootstrap = true;
	});

	pi.on("session_compact", async () => {
		injectBootstrap = true;
	});

	pi.on("agent_end", async () => {
		injectBootstrap = false;
	});

	pi.on("context", async (event) => {
		if (!injectBootstrap) return;
		if (event.messages.some(messageContainsBootstrap)) return;

		const bootstrapMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: bootstrapContent() }],
			timestamp: Date.now(),
		};

		const insertAt = firstNonCompactionSummaryIndex(event.messages);
		return {
			messages: [
				...event.messages.slice(0, insertAt),
				bootstrapMessage,
				...event.messages.slice(insertAt),
			],
		};
	});
}

function bootstrapContent(): string {
	return `${EXTREMELY_IMPORTANT_MARKER}
${BOOTSTRAP_MARKER}

You are running with agent-kit.

Before any non-trivial tool use, classify the task as DIRECT or DELEGATE. DELEGATE is required
for investigative, research, comparison, architecture, scaffolding, risky, multi-step, cross-file,
long-running, review/audit, or otherwise separable work. DIRECT is allowed only for truly tiny
direct answers, immediate clarification, purely conversational replies, or trivial low-risk edits.
If a task looks non-trivial but remains DIRECT, you MUST state the whitelist reason.

The crew-delegation and lavish skills exist and should be checked before non-trivial action.

</EXTREMELY_IMPORTANT>`;
}

function messageContainsBootstrap(message: unknown): boolean {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content.includes(BOOTSTRAP_MARKER);
	if (!Array.isArray(content)) return false;
	return content.some((part) => {
		return (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string" &&
			(part as { text: string }).text.includes(BOOTSTRAP_MARKER)
		);
	});
}

function firstNonCompactionSummaryIndex(messages: unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") {
		index += 1;
	}
	return index;
}
