import type { AgentConfig } from "./agent.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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
