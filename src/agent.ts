import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

    let rawAgentMeta = "";
    let systemPrompt = content;
    if (content.startsWith("---\n")) {
        const end = content.indexOf("\n---", 4);
        if (end !== -1) {
            rawAgentMeta = content.slice(4, end).trim();
            systemPrompt = content.slice(end + "\n---".length).trim();
        }
    }

    const agentMeta = parseRawAgentMeta(rawAgentMeta);

    return {
        ...agent,
        ...(agentMeta.description !== undefined
            ? { description: agentMeta.description }
            : {}),
        tools: agentMeta.tools ?? [],
        ...(agentMeta.model !== undefined ? { model: agentMeta.model } : {}),
        systemPrompt,
    };
}

function parseRawAgentMeta(agentMeta: string): {
    description?: string;
    tools?: string[];
    model?: string;
} {
    const res: {
        description?: string;
        tools?: string[];
        model?: string;
    } = {};
    for (const line of agentMeta.split("\n")) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();

        if (key === "description") res.description = value;
        if (key === "tools") res.tools = parseTools(value);
        if (key === "model") res.model = value;
    }
    return res;
}

function parseTools(value: string): string[] {
    return value
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean);
}
