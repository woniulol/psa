import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverUserAgents, loadAgent } from "./agent.js";
import { runSubagent } from "./run-subagent.js";

const saParam = Type.Object({
    agent: Type.String({
        description: "Name of the subagent to delegate to.",
    }),
    task: Type.String({
        description: "Task to delegate to a subagent",
    }),
});

export default function registerPsa(pi: ExtensionAPI): void {
    pi.registerTool<typeof saParam, string>({
        name: "my-subagent",
        label: "my-Subagent",
        description: [
            "Delegate tasks to specialized subagents with isolated context.",
            'Default agent scope is "user" (from ~/.pi/agent/agents).',
        ].join(" "),
        parameters: saParam,
        async execute(
            _toolCallId,
            params,
            _signal,
            _onUpdate,
            _ctx,
        ): Promise<AgentToolResult<string>> {
            const agents = discoverUserAgents();
            const selectedAgent = agents.find((agent) => agent.name === params.agent);
            if (!selectedAgent) {
                throw new Error(`Agent not found: ${params.agent}`);
            }
            const agentConfig = loadAgent(selectedAgent);

            let result;
            try {
                result = await runSubagent(agentConfig, params.task);
            } catch (error) {
                throw new Error(
                    `Failed to start subagent ${agentConfig.name}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }

            if (result.exitCode !== 0) {
                throw new Error(
                    result.stderr ||
                        result.finalOutput ||
                        `Subagent failed with exit code ${result.exitCode}`,
                );
            }

            return {
                content: [
                    {
                        type: "text",
                        text:
                            result.finalOutput || "subagent completed without output.",
                    },
                ],
                details: result.finalOutput,
            };
        },
    });
}
