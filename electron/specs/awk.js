// awk 规范 — 模式扫描与文本处理语言
const completionSpec = {
  name: "awk",
  description: "模式扫描与文本处理语言",
  args: [
    { name: "程序", description: "AWK 程序文本（如 '{print $1}'）" },
    { name: "文件", description: "输入文件", isOptional: true, isVariadic: true, template: "filepaths" },
  ],
  options: [
    { name: "-F", description: "设置字段分隔符", args: { name: "分隔符", description: "如 ',' 或 '\\t'" } },
    { name: "-v", description: "赋值变量（var=value）", args: { name: "var=value" } },
    { name: "-f", description: "从文件读取 AWK 程序", args: { name: "程序文件", template: "filepaths" } },
    { name: "-o", description: "启用美化输出", args: { name: "文件", isOptional: true, template: "filepaths" } },
    { name: "-b", description: "将所有输入数据视为单字节字符（gawk）" },
    { name: "-c", description: "以 POSIX 兼容模式运行（gawk）" },
    { name: "-C", description: "打印版权信息" },
    { name: "-d", description: "将变量转储到文件（gawk）", args: { name: "文件", isOptional: true, template: "filepaths" } },
    { name: "-e", description: "指定 AWK 程序文本", args: { name: "程序" } },
    { name: "-E", description: "从文件读取 AWK 程序（类似 -f，但禁用命令行变量赋值）", args: { name: "文件", template: "filepaths" } },
    { name: "-i", description: "包含 AWK 源码库", args: { name: "源文件", template: "filepaths" } },
    { name: "-l", description: "加载动态扩展（gawk）", args: { name: "扩展" } },
    { name: "-n", description: "禁用自动按记录拆分输入（gawk）" },
    { name: "-N", description: "解析输入数据时使用区域设置的小数点（gawk）" },
    { name: "-p", description: "分析执行过程并写入文件（gawk）", args: { name: "文件", isOptional: true, template: "filepaths" } },
    { name: "-P", description: "POSIX 兼容模式（gawk）" },
    { name: "-S", description: "沙箱模式 — 禁用 system() 和 I/O 重定向（gawk）" },
    { name: "-t", description: "启用类型检查（gawk）" },
    { name: "--help", description: "显示帮助信息" },
    { name: "--version", description: "打印版本信息" },
  ],
};

export default completionSpec;
