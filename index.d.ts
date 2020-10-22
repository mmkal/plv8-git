export type GitRepo = Record<string, number[]>;

export const gitLog: (repo: GitRepo, depth?: number) => 1