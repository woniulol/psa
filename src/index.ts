import {
    getMarkdownTheme,
    type AgentToolResult,
    type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverUserAgents, loadAgent, resolveAgent } from "./agent.js";
import { runSubagent } from "./run-subagent.js";
import { runParallelSubagents } from "./run-parallel-subagent.js";
import type { SubagentDetails } from "./details.js";
import { makeDetails } from "./details.js";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown, Text, Container, Spacer } from "@earendil-works/pi-tui";

const subagentTaskParam = Type.Object({
    agent: Type.String({
        description: "Name of the subagent to delegate to.",
    }),
    task: Type.String({
        description: "Task to delegate to the subagent.",
    }),
});

const saParam = Type.Object({
    agent: Type.Optional(
        Type.String({
            description: "Name of the subagent to delegate to.",
        }),
    ),
    task: Type.Optional(
        Type.String({
            description: "Task to delegate to a subagent",
        }),
    ),
    tasks: Type.Optional(
        Type.Array(subagentTaskParam, { description: "Parallel subagent tasks" }),
    ),
});

type SubagentInput = {
    agent?: string;
    task?: string;
    tasks?: Array<{ agent: string; task: string }>;
};

type SubagentRequest =
    | { mode: "single"; agent: string; task: string }
    | { mode: "parallel"; tasks: Array<{ agent: string; task: string }> };

function parseSubagentRequest(input: SubagentInput): SubagentRequest {
    const hasSingle = Boolean(input.agent || input.task);
    const hasParallel = Boolean(input.tasks);

    if (hasSingle && hasParallel) {
        throw new Error("Use either agent/task or tasks, not both");
    }
    if (!hasSingle && !hasParallel) {
        throw new Error("Provide either agent/task or tasks");
    }
    if (hasSingle && (!input.agent || !input.task)) {
        throw new Error("Single mode requires both agent and task");
    }
    if (input.tasks) {
        return { mode: "parallel", tasks: input.tasks };
    }
    if (!input.agent || !input.task) {
        throw new Error("Single mode requires both agent and task");
    }
    return { mode: "single", agent: input.agent, task: input.task };
}

export default function registerPsa(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "list-subagents",
        label: "List Subagents",
        description:
            "Use when need to find out avaliable subagents from ~/.pi/agent/agents.",
        parameters: Type.Object({}),
        async execute(): Promise<AgentToolResult<string>> {
            const agents = discoverUserAgents().map(loadAgent);
            const text = agents.length
                ? agents
                      .map(
                          (agent) =>
                              `- ${agent.name}${agent.description ? `: ${agent.description}` : ""}`,
                      )
                      .join("\n")
                : "No user subagents found in ~/.pi/agent/agents.";

            return {
                content: [{ type: "text", text }],
                details: text,
            };
        },
    });

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
            const request = parseSubagentRequest(params);

            if (request.mode === "parallel") {
                return runParallelSubagents(request.tasks, ctx.cwd, signal, onUpdate);
            }

            const result = await runSubagent(
                resolveAgent(request.agent),
                request.task,
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
                details: makeDetails("single", [
                    {
                        agent: request.agent,
                        task: request.task,
                        exitCode: result.exitCode,
                        finalOutput: result.finalOutput,
                        stderr: result.stderr,
                        messageCount: result.messages.length,
                    },
                ]),
            };
        },
        renderCall(args, theme, context): Component {
            let agentName: string;
            let taskText: string;

            if (args.agent && args.task) {
                agentName = args.agent;
                taskText = args.task;
            } else {
                agentName = "parallel";
                taskText = `${args.tasks ? args.tasks.length : 0} parallel task(s)`;
            }

            const task = context.expanded
                ? taskText
                : taskText.length > 60
                  ? `${taskText.slice(0, 60)}...`
                  : taskText;

            return new Text(
                `${theme.fg("toolTitle", theme.bold("my-subagent "))}${theme.fg("accent", agentName)}\n\n` +
                    `${theme.fg("dim", task)}`,
                0,
                0,
            );
        },
        renderResult(result, options, theme, _context): Component {
            const details = result.details;

            if (details.mode === "parallel") {
                const done = details.results.filter(
                    (run) => run.exitCode !== null,
                ).length;
                const total = details.results.length;

                if (options.expanded) {
                    const container = new Container();
                    container.addChild(
                        new Text(
                            `\n${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", `${done}/${total} done`)}`,
                            0,
                            0,
                        ),
                    );

                    for (const run of details.results) {
                        const icon =
                            run.exitCode === null
                                ? theme.fg("muted", "...")
                                : run.exitCode === 0
                                  ? theme.fg("success", "✓")
                                  : theme.fg("error", "✗");

                        container.addChild(new Spacer(1));
                        container.addChild(
                            new Text(
                                `${icon} ${theme.fg("toolTitle", theme.bold(run.agent))} ${theme.fg("muted", `(exit ${run.exitCode === null ? "running" : run.exitCode})`)}`,
                                0,
                                0,
                            ),
                        );

                        if (run.finalOutput) {
                            container.addChild(
                                new Markdown(run.finalOutput, 0, 0, getMarkdownTheme()),
                            );
                        } else {
                            container.addChild(
                                new Text(theme.fg("muted", "(no output yet)"), 0, 0),
                            );
                        }

                        if (run.stderr) {
                            container.addChild(
                                new Text(theme.fg("error", run.stderr), 0, 0),
                            );
                        }
                    }

                    return container;
                }

                let text =
                    `\n` +
                    `${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", `${done}/${total} done`)}`;

                for (const run of details.results) {
                    const icon =
                        run.exitCode === null
                            ? theme.fg("muted", "...")
                            : run.exitCode === 0
                              ? theme.fg("success", "✓")
                              : theme.fg("error", "✗");

                    text += `\n${icon} ${theme.fg("accent", run.agent)}`;

                    if (run.finalOutput) {
                        const preview =
                            run.finalOutput.length > 80
                                ? `${run.finalOutput.slice(0, 80)}...`
                                : run.finalOutput;
                        text += ` ${theme.fg("dim", preview)}`;
                    }
                }

                return new Text(text, 0, 0);
            }

            const run = details.results[0];
            if (!run) {
                return new Text(theme.fg("muted", "(no subagent result)"), 0, 0);
            }
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
