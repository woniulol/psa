import type { AgentConfig } from "./agent.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentEvent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

export type SubagentRunResult = {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    messages: Message[];
    finalOutput: string;
};

type SubagentUpdateCallback = (partial: AgentToolResult<string>) => void;

type ChildPiInvocation = {
    args: string[];
    cleanup: () => void;
};

export function buildChildPiInvocation(
    agent: AgentConfig,
    task: string,
): ChildPiInvocation {
    const args = ["--mode", "json", "-p", "--no-session"];
    const promptFile = writeAgentPromptTempFile(agent);

    if (agent.model) args.push("--model", agent.model);
    if (agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
    args.push("--append-system-prompt", promptFile.filePath);

    args.push(task);
    return {
        args,
        cleanup: () => {
            try {
                fs.rmSync(promptFile.dir, { recursive: true, force: true });
            } catch {}
        },
    };
}

export function writeAgentPromptTempFile(agent: AgentConfig): {
    dir: string;
    filePath: string;
} {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psa-agent-"));
    const filePath = path.join(dir, `${agent.name}.md`);
    fs.writeFileSync(filePath, agent.systemPrompt, "utf8");
    return { dir, filePath };
}

export function runSubagent(
    agent: AgentConfig,
    task: string,
    signal?: AbortSignal,
    onMessageUpdate?: SubagentUpdateCallback,
): Promise<SubagentRunResult> {
    const invoke = buildChildPiInvocation(agent, task);
    return new Promise((resolve, reject) => {
        const child = spawn("pi", invoke.args, { stdio: ["ignore", "pipe", "pipe"] });

        let wasAborted = false;
        let killTimer: NodeJS.Timeout | undefined;
        const killChild = () => {
            wasAborted = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL");
            }, 5000);
        };

        if (signal?.aborted) {
            killChild();
        } else {
            signal?.addEventListener("abort", killChild, { once: true });
        }

        let stdout = "";
        let stderr = "";
        let stdoutBuffer = "";
        const messages: Message[] = [];

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            stdoutBuffer += chunk;
            const lines = stdoutBuffer.split("\n");
            stdoutBuffer = lines.pop() ?? "";
            for (const line of lines) {
                processAgentEventLine(line, messages, onMessageUpdate);
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (err) => {
            signal?.removeEventListener("abort", killChild);
            if (killTimer) clearTimeout(killTimer);
            invoke.cleanup();
            reject(err);
        });
        child.on("close", (exitCode) => {
            signal?.removeEventListener("abort", killChild);
            if (killTimer) clearTimeout(killTimer);
            invoke.cleanup();
            if (wasAborted) {
                reject(new Error("Subagent was aborted"));
                return;
            }
            if (stdoutBuffer.trim()) {
                processAgentEventLine(stdoutBuffer, messages, onMessageUpdate);
            }
            resolve({
                exitCode,
                stdout,
                stderr,
                messages,
                finalOutput: getFinalOutput(messages),
            });
        });
    });
}

function parseAgentEvent(line: string): AgentEvent | undefined {
    try {
        return JSON.parse(line) as AgentEvent;
    } catch {
        return undefined;
    }
}

function processAgentEventLine(
    line: string,
    messages: Message[],
    onMessageUpdate?: SubagentUpdateCallback,
): void {
    if (!line.trim()) return;

    const event = parseAgentEvent(line);
    if (!event) return;

    if (event.type === "message_end") {
        const msg = event.message as Message;
        messages.push(msg);

        if (msg.role === "assistant") {
            const text = getMessageText(msg);
            if (!text) return;

            onMessageUpdate?.({
                content: [{ type: "text", text }],
                details: text,
            });
        }
    }
}

/*
 * one message could have multiple content part.
 */
function getMessageText(message: Message): string {
    const texts: string[] = [];
    for (const part of message.content) {
        if (typeof part === "string") {
            texts.push(part);
            continue;
        }
        if (part.type === "text") {
            texts.push(part.text);
        }
    }
    return texts.join("\n\n");
}

function getFinalOutput(messages: Message[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg) continue;
        if (msg.role === "assistant") {
            const text = getMessageText(msg);
            if (text) return text;
        }
    }
    return "";
}
