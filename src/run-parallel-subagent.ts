import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { makeDetails, type SubagentDetails, type SubagentResult } from "./details.js";
import { resolveAgent } from "./agent.js";
import { runSubagent } from "./run-subagent.js";
import { type SubagentUpdateCallback } from "./run-subagent.js";

export async function runParallelSubagents(
    tasks: Array<{ agent: string; task: string }>,
    cwd: string,
    signal?: AbortSignal,
    onUpdate?: SubagentUpdateCallback,
): Promise<AgentToolResult<SubagentDetails>> {
    const partialResults: SubagentResult[] = tasks.map((task) => ({
        agent: task.agent,
        task: task.task,
        exitCode: null,
        finalOutput: "",
        stderr: "",
        messageCount: 0,
    }));

    const emitUpdate = () => {
        onUpdate?.({
            content: [
                {
                    type: "text",
                    text: `Parallel: ${partialResults.filter((r) => r.exitCode !== null).length}/${tasks.length} done`,
                },
            ],
            details: makeDetails("parallel", partialResults),
        });
    };

    const results = await Promise.all(
        tasks.map(async (item, index) => {
            const agentConfig = resolveAgent(item.agent);
            const result = await runSubagent(
                agentConfig,
                item.task,
                cwd,
                signal,
                (partial) => {
                    const childResult = partial.details.results[0];
                    if (!childResult) return;
                    partialResults[index] = childResult;
                    emitUpdate();
                },
            );

            partialResults[index] = {
                agent: agentConfig.name,
                task: item.task,
                exitCode: result.exitCode,
                finalOutput: result.finalOutput,
                stderr: result.stderr,
                messageCount: result.messages.length,
            };
            emitUpdate();

            return {
                agent: agentConfig.name,
                task: item.task,
                result,
            };
        }),
    );

    const failed = results.find((item) => item.result.exitCode !== 0);
    if (failed) {
        throw new Error(
            failed.result.stderr ||
                failed.result.finalOutput ||
                `Subagent ${failed.agent} failed with exit code ${failed.result.exitCode}`,
        );
    }

    const text = results
        .map((item) => {
            const output =
                item.result.finalOutput || "subagent completed without output.";
            return `## ${item.agent}\n\n${output}`;
        })
        .join("\n\n");

    return {
        content: [{ type: "text", text }],
        details: makeDetails(
            "parallel",
            results.map((task) => ({
                agent: task.agent,
                task: task.task,
                exitCode: task.result.exitCode,
                finalOutput: task.result.finalOutput,
                stderr: task.result.stderr,
                messageCount: task.result.messages.length,
            })),
        ),
    };
}
