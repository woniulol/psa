import {
    getMarkdownTheme,
    type AgentToolResult,
    type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverUserAgents, loadAgent } from "./agent.js";
import { runSubagent } from "./run-subagent.js";
import type { SubagentDetails } from "./details.js";
import { makeDetails } from "./details.js";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown, Text, Container, Spacer } from "@earendil-works/pi-tui";

const saParam = Type.Object({
    agent: Type.String({
        description:
            "Name of the subagent to delegate to. This is the markdown filename without .md from ~/.pi/agent/agents.",
    }),
    task: Type.String({
        description: "Task to delegate to a subagent",
    }),
});

export default function registerPsa(pi: ExtensionAPI): void {
    pi.registerTool<typeof saParam, SubagentDetails>({
        name: "my-subagent",
        label: "My Subagent",
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
            ctx,
        ): Promise<AgentToolResult<SubagentDetails>> {
            const agents = discoverUserAgents();
            const selectedAgent = agents.find((agent) => agent.name === params.agent);
            if (!selectedAgent) {
                throw new Error(`Agent not found: ${params.agent}`);
            }
            const agentConfig = loadAgent(selectedAgent);

            const result = await runSubagent(
                agentConfig,
                params.task,
                ctx.cwd,
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
        renderCall(args, theme, context): Component {
            const task = context.expanded
                ? args.task
                : args.task.length > 60
                  ? `${args.task.slice(0, 60)}...`
                  : args.task;

            return new Text(
                `${theme.fg("toolTitle", theme.bold("my-subagent "))}${theme.fg("accent", args.agent)}\n\n` +
                    `${theme.fg("dim", task)}`,
                0,
                0,
            );
        },
        renderResult(result, options, theme, _context): Component {
            const details = result.details;
            const run = details.result;
            const icon =
                run.exitCode === null
                    ? theme.fg("muted", "...")
                    : run.exitCode === 0
                      ? theme.fg("success", "✓")
                      : theme.fg("error", "✗");

            if (!options.expanded) {
                return new Text(
                    `\n` + `${icon} ${theme.fg("toolTitle", theme.bold(run.agent))}`,
                    0,
                    0,
                );
            }

            // expanded: full detailed rendering
            const container = new Container();

            container.addChild(
                new Text(
                    `\n` +
                        `${icon} ${theme.fg("toolTitle", theme.bold(run.agent))} ${theme.fg("muted", `(exit ${run.exitCode ?? "running"})`)}`,
                    0,
                    0,
                ),
            );

            // container.addChild(new Spacer(1));
            // container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
            // container.addChild(new Text(theme.fg("dim", run.task), 0, 0));

            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));

            if (run.finalOutput) {
                container.addChild(
                    new Markdown(run.finalOutput, 0, 0, getMarkdownTheme()),
                );
            } else {
                container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
            }

            if (run.stderr) {
                container.addChild(new Spacer(1));
                container.addChild(new Text(theme.fg("muted", "─── Stderr ───"), 0, 0));
                container.addChild(new Text(theme.fg("error", run.stderr), 0, 0));
            }

            container.addChild(new Spacer(1));
            container.addChild(
                new Text(theme.fg("dim", `${run.messageCount} message(s)`), 0, 0),
            );

            return container;
        },
    });
}
