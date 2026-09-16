# 命令规范目录

本目录存放终端补全用的 **本地 Fig 规格**（`*.js`）。主进程加载命令规格时 **优先读这里**，再回退 `@withfig/autocomplete`。本地文件会 **整份覆盖** 同名英文规格，因此必须自洽、常用项齐全、说明为中文。

Agent 新增或改写本目录规格时，必须遵守以下准则。

## 何时编写

- 用户要求为某命令补充中文提示。
- `@withfig/autocomplete` 缺少该命令，或英文说明不适合本产品。
- 现有本地规格缺常用子命令、选项，或说明仍是英文。

不要把 withfig 的完整规格原样拷贝进来。覆盖面以日常终端用法为准，宁可精简，不要堆上百个冷门旗标。

## 文件与导出

- 文件名 = 命令名：`docker` → `docker.js`，`sbatch` → `sbatch.js`。
- 只写 ESM：`const completionSpec = { ... }; export default completionSpec;`
- 文件头一行中文注释：`// <命令> 规范 — <一句话用途>`
- 顶层必须有 `name`、`description`；按需有 `subcommands`、`options`、`args`。
- 规格必须能被 `JSON.parse(JSON.stringify(spec))` 序列化。**禁止** `generators`、函数、`loadSpec`、符号等不可序列化字段。
- 不要在本目录放无关脚本；不要改加载逻辑（`electron/main/registerBridges.cjs`）除非任务明确要求。

## 提示准则

1. **说明用中文。** `description`、参数 `name`、参数 `description` 一律中文。命令名、子命令名、选项名（`-f`、`--force`）保持原文。固定枚举值（`json`、`always`、`RESUME`）保持原文，可在中文说明里解释含义。
2. **危险操作必须提醒。** 下列情况在 `description` 末尾用「危险：」点明后果，不要只写中性动词：
   - 强制执行、跳过确认：`--force`、`-f`（若表示 force）、`-y`、`--yes`、`--no-verify`
   - 提权或放开隔离：`--privileged`、`--cap-add`、`--security-opt`、`--disable-content-trust`、`--nogpgcheck`
   - 破坏性删除/覆盖：`rm`、`rmi`、`prune`、`kill`、`shutdown`、`reboot`、覆盖写
   - 集群/守护进程级变更：`scontrol reboot`、`reconfigure`、`abort` 等
3. **先写常用路径。** 覆盖高频子命令和它们的常用选项；管理类命令（如 `docker container`、`scontrol show`）补一层常用实体即可。冷门旗标、完整 withfig 选项表不要搬过来。
4. **说明短、准、能扫读。** 一条 `description` 控制在一句话。说明「做什么」，必要时补关键格式或默认值（如 `name:tag`、`默认 10 秒`）。不要贴 man 页、不要中英混排长句。
5. **参数名说人话。** 用 `软件包`、`容器`、`作业ID`、`文件`，不要用 `package`、`CONTAINER`、`JOBID`。可选用 `isOptional`，可重复用 `isVariadic`。路径类参数加 `template: "filepaths"` 或 `"folders"`。取值有限时用 `suggestions`。
6. **别名写清楚。** 短长选项写成 `name: ["-f", "--force"]`。子命令别名单独列出，说明里写清「xxx 的别名」。
7. **结构对齐现有文件。** 简单命令学 `journalctl.js` / `awk.js`（选项为主）；带子命令的学 `dnf.js` / `yum.js`；树深的学 `docker.js` / `scontrol.js`。选项挂在真正生效的那一层，不要把子命令专用旗标堆到顶层。

## 危险说明写法

在原有中文说明后追加 `（危险：<后果>）`，例如：

```js
{ name: ["-f", "--force"], description: "强制删除运行中的容器（危险：使用 SIGKILL，数据可能丢失）" }
{ name: "--privileged", description: "赋予容器扩展权限（危险：接近宿主机 root，隔离失效）" }
{ name: "-y", description: "全部回答“是”以自动进行操作（危险：跳过确认，可能误装/误删）" }
{ name: "--nogpgcheck", description: "关闭 GPG 签名检查（危险：可能安装被篡改的软件包）" }
```

只提醒真实风险。普通 `--help`、`--version`、列表/查询类命令不要加「危险」。

## 推荐骨架

```js
// foo 规范 — 一句话用途
const completionSpec = {
  name: "foo",
  description: "中文一句话用途",
  subcommands: [
    {
      name: "bar",
      description: "做什么",
      args: { name: "对象", isVariadic: true },
      options: [
        { name: ["-f", "--force"], description: "强制执行（危险：跳过确认）" },
      ],
    },
  ],
  options: [
    { name: ["-h", "--help"], description: "显示帮助信息" },
  ],
};

export default completionSpec;
```

## 自检

写完后确认：

- 文件能 `import`，`export default` 的对象含正确 `name`。
- 所有 `description` 与参数 `name` 为中文；命令/选项字面量未被翻译。
- 强制、提权、破坏性项带「危险：」提醒。
- 无 `generators` / 函数；无从 withfig 整文件粘贴。
- 常用子命令与选项能覆盖用户最可能输入的补全路径。
