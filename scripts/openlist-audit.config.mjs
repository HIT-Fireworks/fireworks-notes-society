export default {
  host: "https://olist-eo.jwyihao.top",
  base: "Fireworks",
  password: "",
  depth: 4,
  requestTimeoutMs: 10_000,
  concurrency: 1,
  retries: 2,
  maxDirectories: 600,
  warningExemptions: [
    {
      path: "/询问中",
      reason: "临时待确认目录，不默认按普通课程页迁移",
    },
  ],
  orphanPageAllowances: [
    {
      file: "数学学院/集合论图论/index.md",
      reason: "远端暂未找到对应目录，等待维护者确认删除、归档或重新映射",
    },
  ],
};
