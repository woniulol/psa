import type { AgentConfig } from "./agent.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export type SubagentRunResult = {
    exitCode: number | null;
    stdout: string;
    stderr: string;
};

export function buildChildPiArgs(agent: AgentConfig, task: string): string[] {
    const args = ["--mode", "json", "-p", "--no-session"];

    if (agent.model) args.push("--model", agent.model);
    if (agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
    args.push("--append-system-prompt", writeAgentPromptTempFile(agent));

    args.push(task);
    return args;
}

export function writeAgentPromptTempFile(agent: AgentConfig): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psa-agent-"));
    const filePath = path.join(dir, `${agent.name}.md`);
    fs.writeFileSync(filePath, agent.systemPrompt, "utf8");
    return filePath;
}

export function runSubagent(
    agent: AgentConfig,
    task: string,
): Promise<SubagentRunResult> {
    const args = buildChildPiArgs(agent, task);
    return new Promise((resolve, reject) => {
        const child = spawn("pi", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (exitCode) => {
            resolve({
                exitCode,
                stdout,
                stderr,
            });
        });
    });
}
