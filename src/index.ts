import {
    getMarkdownTheme,
    type AgentToolResult,
    type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverUserAgents, loadAgent } from "./agent.js";
import { runSubagent } from "./run-subagent.js";
import type { SaDetails } from "./details.js";
import { makeDetails } from "./details.js";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown, Text, Container, Spacer } from "@earendil-works/pi-tui";

const saParam = Type.Object({
    agent: Type.String({
        description: "Name of the subagent to delegate to.",
    }),
    task: Type.String({
        description: "Task to delegate to a subagent",
    }),
});

export default function registerPsa(pi: ExtensionAPI): void {
    pi.registerTool<typeof saParam, SaDetails>({
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
            signal,
            onUpdate,
            _ctx,
        ): Promise<AgentToolResult<SaDetails>> {
            const agents = discoverUserAgents();
            const selectedAgent = agents.find((agent) => agent.name === params.agent);
            if (!selectedAgent) {
                throw new Error(`Agent not found: ${params.agent}`);
            }
            const agentConfig = loadAgent(selectedAgent);

            const result = await runSubagent(
                agentConfig,
                params.task,
                signal,
                onUpdate,
            );
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
                details: makeDetails({
                    agent: agentConfig.name,
                    task: params.task,
                    exitCode: result.exitCode,
                    finalOutput: result.finalOutput,
                    stderr: result.stderr,
                    messageCount: result.messages.length,
                }),
            };
        },
        renderResult(result, options, theme, _context): Component {
            const details = result.details;
            const items = details.items;
            const icon =
                items.exitCode === null
                    ? theme.fg("muted", "...")
                    : items.exitCode === 0
                      ? theme.fg("success", "✓")
                      : theme.fg("error", "✗");

            if (!options.expanded) {
                const preview = items.finalOutput
                    ? items.finalOutput.split("\n").slice(0, 3).join("\n")
                    : "(no output)";

                return new Text(
                    `${icon} ${theme.fg("toolTitle", theme.bold(items.agent))}\n${theme.fg("toolOutput", preview)}`,
                    0,
                    0,
                );
            }

            // expanded: full detailed rendering
            const container = new Container();

            container.addChild(
                new Text(
                    `${icon} ${theme.fg("toolTitle", theme.bold(items.agent))} ${theme.fg("muted", `(exit ${items.exitCode ?? "running"})`)}`,
                    0,
                    0,
                ),
            );

            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
            container.addChild(new Text(theme.fg("dim", items.task), 0, 0));

            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));

            if (items.finalOutput) {
                container.addChild(
                    new Markdown(items.finalOutput, 0, 0, getMarkdownTheme()),
                );
            } else {
                container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
            }

            if (items.stderr) {
                container.addChild(new Spacer(1));
                container.addChild(new Text(theme.fg("muted", "─── Stderr ───"), 0, 0));
                container.addChild(new Text(theme.fg("error", items.stderr), 0, 0));
            }

            container.addChild(new Spacer(1));
            container.addChild(
                new Text(theme.fg("dim", `${items.messageCount} message(s)`), 0, 0),
            );

            return container;
        },
    });
}
