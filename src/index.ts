import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverUserAgents, loadAgent } from "./agent.js";
import { buildChildPiArgs } from "./run-subagent.js";

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
                return {
                    content: [
                        {
                            type: "text",
                            text: `agent not found: ${params.agent}`,
                        },
                    ],
                    details: `${params.agent}: ${params.task}`,
                };
            }
            const agentConfig = loadAgent(selectedAgent);
            const args = buildChildPiArgs(agentConfig, params.task);
            return {
                content: [
                    {
                        type: "text",
                        text: `would delegate to ${params.agent}: ${params.task} w ${args}`,
                    },
                ],
                details: `${params.agent}: ${params.task}`,
            };
        },
    });
}
