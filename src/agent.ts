import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentInfo = {
    name: string;
    path: string;
};

export type AgentConfig = AgentInfo & {
    description?: string;
    tools: string[];
    model?: string;
    systemPrompt: string;
};

export function getUserAgentsDir(): string {
    return path.join(os.homedir(), ".pi", "agent", "agents");
}

export function discoverUserAgents(): AgentInfo[] {
    const userAgentsDir = getUserAgentsDir();
    if (!fs.existsSync(userAgentsDir)) {
        return [];
    }
    return fs
        .readdirSync(userAgentsDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({
            name: path.basename(file, ".md"),
            path: path.join(userAgentsDir, file),
        }));
}

export function loadAgent(agent: AgentInfo): AgentConfig {
    const content = fs.readFileSync(agent.path, "utf8");

    const { frontmatter, body } = parseFrontmatter(content);

    return {
        ...agent,
        ...(typeof frontmatter.description === "string"
            ? { description: frontmatter.description }
            : {}),
        ...(typeof frontmatter.tools === "string"
            ? { tools: parseTools(frontmatter.tools) }
            : { tools: [] }),
        ...(typeof frontmatter.model === "string" ? { model: frontmatter.model } : {}),
        systemPrompt: body.trim(),
    };
}

function parseTools(value: string): string[] {
    return value
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean);
}

export function resolveAgent(agentName: string): AgentConfig {
    const agents = discoverUserAgents();
    const selectedAgent = agents.find((agent) => agent.name === agentName);
    if (!selectedAgent) {
        throw new Error(`Agent not found: ${agentName}`);
    }
    return loadAgent(selectedAgent);
}
