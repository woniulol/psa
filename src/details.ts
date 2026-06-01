export type SaDetails = {
    mode: "single";
    items: {
        agent: string;
        task: string;
        exitCode: number | null;
        finalOutput: string;
        stderr: string;
        messageCount: number;
    };
};

export function makeDetails(input: SaDetails["items"]): SaDetails {
    return {
        mode: "single",
        items: input,
    };
}
