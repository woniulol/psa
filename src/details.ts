export type SubagentDetails = {
    mode: "single";
    result: {
        agent: string;
        task: string;
        exitCode: number | null;
        finalOutput: string;
        stderr: string;
        messageCount: number;
    };
};

export function makeDetails(input: SubagentDetails["result"]): SubagentDetails {
    return {
        mode: "single",
        result: input,
    };
}
