export type SubagentResult = {
    agent: string;
    task: string;
    exitCode: number | null;
    finalOutput: string;
    stderr: string;
    messageCount: number;
};

export type SubagentDetails = {
    mode: "single" | "parallel";
    results: SubagentResult[];
};

export function makeDetails(
    mode: SubagentDetails["mode"],
    results: SubagentResult[],
): SubagentDetails {
    return { mode, results };
}
