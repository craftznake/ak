import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

const MAX_IMPORT_DEPTH = 8;
const MAX_IMPORT_BYTES = 512 * 1024;

// ak-context-file-imports: line-oriented import syntax for Pi context files:
//   @shared.md
//   @docs/workflow.md
//   @/absolute/path/to/file.md
// The directive must occupy the whole line. Paths resolve relative to the file
// containing the directive. Nested imports are supported and de-duplicated by
// realpath within one prompt build.
const IMPORT_RE = /^\s*@([^\s].*?)\s*$/;

type ContextFile = {
    path?: string;
    content?: string;
};

type ImportRecord = {
    importer: string;
    requested: string;
    path: string;
    content: string;
};

type ExpansionResult = {
    imports: ImportRecord[];
    warnings: string[];
};

function isMarkdownPath(path: string): boolean {
    return /\.(md|markdown)$/i.test(path);
}

function resolveImport(importerPath: string, requested: string): string {
    const cleaned = requested.trim().replace(/^<|>$/g, "");
    return normalize(isAbsolute(cleaned) ? cleaned : resolve(dirname(importerPath), cleaned));
}

async function expandImportsFromText(
    importerPath: string,
    text: string,
    seen: Set<string>,
    depth: number,
    warnings: string[],
    records: ImportRecord[],
): Promise<void> {
    if (depth > MAX_IMPORT_DEPTH) {
        warnings.push(`Max import depth ${MAX_IMPORT_DEPTH} reached at ${importerPath}`);
        return;
    }

    for (const line of text.split(/\r?\n/)) {
        const match = line.match(IMPORT_RE);
        if (!match) continue;

        const requested = match[1].trim();
        if (!isMarkdownPath(requested)) continue;

        const importPath = resolveImport(importerPath, requested);

        try {
            if (!existsSync(importPath)) {
                warnings.push(`Missing import ${requested} referenced from ${importerPath}`);
                continue;
            }

            const stat = statSync(importPath);
            if (!stat.isFile()) {
                warnings.push(`Import is not a file: ${importPath}`);
                continue;
            }
            if (stat.size > MAX_IMPORT_BYTES) {
                warnings.push(`Import too large (${stat.size} bytes): ${importPath}`);
                continue;
            }

            const realPath = realpathSync(importPath);
            if (seen.has(realPath)) continue;
            seen.add(realPath);

            const content = await readFile(realPath, "utf8");
            records.push({ importer: importerPath, requested, path: realPath, content });
            await expandImportsFromText(realPath, content, seen, depth + 1, warnings, records);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Failed import ${requested} referenced from ${importerPath}: ${message}`);
        }
    }
}

async function expandContextFileImports(contextFiles: ContextFile[] | undefined): Promise<ExpansionResult> {
    const seen = new Set<string>();
    const imports: ImportRecord[] = [];
    const warnings: string[] = [];

    for (const file of contextFiles ?? []) {
        if (!file?.path || typeof file.content !== "string") continue;
        await expandImportsFromText(file.path, file.content, seen, 0, warnings, imports);
    }

    return { imports, warnings };
}

function renderImports(result: ExpansionResult): string {
    const sections: string[] = [];

    if (result.imports.length > 0) {
        sections.push(
            [
                "## Imported context file contents",
                "",
                "The following files were imported from context-file `@path.md` directives by the ak-context-file-imports extension.",
                "",
                ...result.imports.map((record) =>
                    [
                        `### ${record.path}`,
                        `Imported by: ${record.importer}`,
                        "",
                        record.content.trimEnd(),
                    ].join("\n"),
                ),
            ].join("\n"),
        );
    }

    if (result.warnings.length > 0) {
        sections.push(
            [
                "## Context file import warnings",
                "",
                ...result.warnings.map((warning) => `- ${warning}`),
            ].join("\n"),
        );
    }

    return sections.join("\n\n");
}

export default function akContextFileImports(pi: ExtensionAPI) {
    pi.on("before_agent_start", async (event) => {
        const contextFiles = event.systemPromptOptions.contextFiles as ContextFile[] | undefined;
        const result = await expandContextFileImports(contextFiles);
        const rendered = renderImports(result);
        if (!rendered) return;

        return {
            systemPrompt: `${event.systemPrompt}\n\n${rendered}`,
        };
    });

    pi.registerCommand("ak-context-imports", {
        description: "Show AGENTS.md/@file.md imports expanded by the ak-context-file-imports extension",
        handler: async (_args, ctx) => {
            const options = ctx.getSystemPromptOptions();
            const contextFiles = options.contextFiles as ContextFile[] | undefined;
            const result = await expandContextFileImports(contextFiles);

            const importLines = result.imports.map((record) => `- ${record.path} (from ${record.importer})`);
            const warningLines = result.warnings.map((warning) => `- warning: ${warning}`);
            const lines = [...importLines, ...warningLines];
            ctx.ui.notify(
                lines.length ? lines.join("\n") : "No @*.md context imports found.",
                result.warnings.length ? "warning" : "info",
            );
        },
    });

    pi.on("session_start", (_event, ctx) => {
        if (!ctx.hasUI) return;
        ctx.ui.setStatus("ak-context-imports", "ak @imports on");
    });
}
