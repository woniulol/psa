import type { AgentConfig } from "./agent.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentEvent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { SubagentDetails } from "./details.js";
import { makeDetails } from "./details.js";

export type SubagentRunResult = {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    messages: Message[];
    finalOutput: string;
};

type SubagentUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

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
        const piInvocation = getPiInvocation(invoke.args);
        const child = spawn(piInvocation.command, piInvocation.args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

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
                handleLine(agent, task, line, messages, onMessageUpdate);
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
                handleLine(agent, task, stdoutBuffer, messages, onMessageUpdate);
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

function handleLine(
    agent: AgentConfig,
    task: string,
    line: string,
    messages: Message[],
    onUpdate?: SubagentUpdateCallback,
): void {
    const msg = processAgentEventLine(line, messages);
    if (msg?.role === "assistant") {
        handleOnUpdate(
            agent.name,
            task,
            messages.length,
            getMessageText(msg),
            onUpdate,
        );
    }
}

function processAgentEventLine(line: string, messages: Message[]): Message | undefined {
    if (!line.trim()) return undefined;

    const event = parseAgentEvent(line);
    if (!event) return undefined;

    if (event.type === "message_end") {
        const msg = event.message as Message;
        messages.push(msg);
        return msg;
    }

    return undefined;
}

function handleOnUpdate(
    agent: string,
    task: string,
    messageCount: number,
    text: string,
    onUpdate?: SubagentUpdateCallback,
): void {
    if (!text) return;
    onUpdate?.({
        content: [{ type: "text", text }],
        details: makeDetails({
            agent,
            task,
            exitCode: null,
            finalOutput: text,
            stderr: "",
            messageCount,
        }),
    });
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

function getPiInvocation(args: string[]): { command: string; args: string[] } {
    const currentScript = process.argv[1];
    const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
    if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
        return {
            command: process.execPath,
            args: [currentScript, ...args],
        };
    }

    const execName = path.basename(process.execPath).toLowerCase();
    const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
    if (!isGenericRuntime) {
        return {
            command: process.execPath,
            args,
        };
    }

    return {
        command: "pi",
        args,
    };
}
