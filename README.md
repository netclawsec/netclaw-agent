<!--
  NetClaw Agent — 网钳科技 productized AI agent.
  For fork structure, upstream remotes, and dual-upstream pull workflow, see NETCLAW.md.
  中文文档见 README_zh.md。
-->

<p align="center">
  <img src="assets/banner.png" alt="NetClaw Agent" width="100%">
</p>

<h1 align="center">NetClaw Agent</h1>

<p align="center">
  <b>网钳科技自研 · 通用 AI 智能体</b><br/>
  <i>A self-improving general-purpose AI agent, built and maintained by NetClawSec (网钳科技).</i>
</p>

<p align="center">
  <a href="README_zh.md"><img src="https://img.shields.io/badge/docs-\u4e2d\u6587-7D5BA6?style=for-the-badge" alt="中文文档"></a>
  <a href="https://github.com/netclawsec/netclaw-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-6E4A99?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://github.com/netclawsec/netclaw-agent/issues"><img src="https://img.shields.io/badge/Issues-GitHub-3E2866?style=for-the-badge" alt="Issues"></a>
  <a href="https://netclawsec.com"><img src="https://img.shields.io/badge/Built%20by-\u7f51\u94b3\u79d1\u6280-B9A1D3?style=for-the-badge" alt="Built by NetClawSec"></a>
</p>

---

**NetClaw Agent** 是 [网钳科技 (NetClawSec)](https://netclawsec.com) 推出的通用型 AI 智能体平台。它内置持续学习闭环：从对话中自动提炼技能、在使用中自我改进、跨会话回忆历史、构建对用户的长期画像。可运行在 5 美金的 VPS、GPU 集群，或闲置几乎零成本的 Serverless 环境 — 不再绑定笔记本电脑，也可以从 Telegram 远程驱动云端 VM。

支持任意主流模型：OpenRouter 的 200+ 模型、智谱 GLM、月之暗面 Kimi、MiniMax、小米 MiMo、Hugging Face、OpenAI，或接入私有化端点。一条 `netclaw model` 随意切换，零代码改动、零绑定。

<table>
<tr><td><b>完整终端界面</b></td><td>多行编辑、斜杠命令自动补全、对话历史、打断重定向、工具输出流式渲染。</td></tr>
<tr><td><b>随处可达</b></td><td>单一网关进程同时对接 Telegram / Discord / Slack / WhatsApp / Signal 与 CLI，支持语音消息转写和跨平台会话延续。</td></tr>
<tr><td><b>闭环学习</b></td><td>智能体自动管理记忆并定期整理；复杂任务后自主沉淀新技能；技能在使用中自我优化；FTS5 全文检索 + LLM 摘要实现跨会话回忆；<a href="https://github.com/plastic-labs/honcho">Honcho</a> 辩证式用户建模；兼容 <a href="https://agentskills.io">agentskills.io</a> 开放标准。</td></tr>
<tr><td><b>定时自动化</b></td><td>内置 cron 调度器，用自然语言配置日报、夜间备份、每周巡检 — 无人值守运行并推送到任意平台。</td></tr>
<tr><td><b>并行子代理</b></td><td>派发隔离的子 Agent 并行处理多路工作流；通过 RPC 调用 Python 脚本，将多步流水线折叠为零上下文成本的一轮交互。</td></tr>
<tr><td><b>多后端运行时</b></td><td>六种终端后端：本地、Docker、SSH、Daytona、Singularity、Modal。Daytona / Modal 提供 Serverless 持久化 — 空闲时环境休眠，几乎零成本；请求到来时按需唤醒。</td></tr>
<tr><td><b>研究友好</b></td><td>批量轨迹生成、Atropos RL 环境、轨迹压缩 — 为下一代工具调用模型提供训练数据。</td></tr>
</table>

---

## 快速安装 · Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/netclawsec/netclaw-agent/main/scripts/install.sh | bash
```

支持 Linux、macOS、WSL2 以及 Android (Termux)。安装脚本会自动处理平台差异。

> **Android / Termux:** 参见 [Termux 指南](docs/)。Termux 环境会安装精简的 `.[termux]` extra，避免拉取 Android 不兼容的语音依赖。
>
> **Windows:** 不支持原生 Windows，请先安装 [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)。

安装完成后：

```bash
source ~/.bashrc    # 或 source ~/.zshrc
netclaw              # 开始对话
```

> 命令行统一使用 `netclaw`。

---

## 核心命令 · Getting Started

```bash
netclaw              # 交互式 CLI — 开启对话
netclaw model        # 选择 LLM 提供商和模型
netclaw tools        # 配置启用的工具
netclaw config set   # 设置单个配置项
netclaw gateway      # 启动消息网关 (Telegram / Discord / …)
netclaw setup        # 运行完整安装向导
netclaw claw migrate # 从 OpenClaw 迁移配置
netclaw update       # 升级到最新版本
netclaw doctor       # 诊断环境问题
```

## CLI vs 消息端 · Quick Reference

NetClaw Agent 提供两种入口：终端 `netclaw` 启动 TUI，或运行网关从 Telegram / Discord / Slack / WhatsApp / Signal / Email 对话。对话中的斜杠命令两端通用。

| 操作 | CLI | 消息端 |
|---------|-----|---------------------|
| 开始对话 | `netclaw` | `netclaw gateway setup` + `netclaw gateway start`，然后给机器人发消息 |
| 重置会话 | `/new` 或 `/reset` | `/new` 或 `/reset` |
| 切换模型 | `/model [provider:model]` | `/model [provider:model]` |
| 设置人格 | `/personality [name]` | `/personality [name]` |
| 重试 / 撤销 | `/retry`, `/undo` | `/retry`, `/undo` |
| 压缩上下文 / 用量 | `/compress`, `/usage`, `/insights [--days N]` | `/compress`, `/usage`, `/insights [days]` |
| 浏览技能 | `/skills` 或 `/<skill-name>` | `/skills` 或 `/<skill-name>` |
| 打断当前任务 | `Ctrl+C` 或直接发新消息 | `/stop` 或发新消息 |
| 平台状态 | `/platforms` | `/status`, `/sethome` |

---

## 功能文档 · Documentation

产品文档入口即将迁移到 **docs.netclawsec.com**。当前完整英文参考请查看 [`docs/`](docs/) 目录，关键章节：

| 章节 | 内容 |
|---------|---------------|
| Quickstart | 安装 → 配置 → 首次对话 |
| CLI Usage | 命令、快捷键、人格、会话 |
| Configuration | 配置文件、Provider、模型、全部选项 |
| Messaging Gateway | Telegram / Discord / Slack / WhatsApp / Signal / Home Assistant |
| Security | 命令审批、DM 配对、容器隔离 |
| Tools & Toolsets | 40+ 工具、Toolset 体系、终端后端 |
| Skills System | 程序性记忆、Skills Hub、创建技能 |
| Memory | 持久记忆、用户画像、最佳实践 |
| MCP Integration | 接入任意 MCP Server 扩展能力 |
| Cron Scheduling | 定时任务与跨平台投递 |
| Context Files | 项目级上下文配置 |
| Architecture | 项目结构、Agent 循环、核心类 |
| Contributing | 开发环境、PR 流程、代码规范 |

---

## 从 OpenClaw 迁移

如果你之前使用 OpenClaw，NetClaw Agent 可以自动导入配置、记忆、技能和 API Key。

**首次安装：** `netclaw setup` 会自动检测 `~/.openclaw` 并在配置前询问是否迁移。

**任意时刻手动迁移：**

```bash
netclaw claw migrate              # 交互式迁移（完整预设）
netclaw claw migrate --dry-run    # 预览将迁移的内容
netclaw claw migrate --preset user-data   # 只迁移用户数据，跳过密钥
netclaw claw migrate --overwrite  # 覆盖冲突项
```

导入范围包括：
- **SOUL.md** — 人格文件
- **Memories** — MEMORY.md / USER.md 条目
- **Skills** — 用户技能 → `~/.netclaw/skills/openclaw-imports/`（旧版 `~/.hermes/` 安装自动沿用原路径）
- **命令白名单** — 审批规则
- **消息平台配置** — 平台设置、允许用户、工作目录
- **API Keys** — 允许列表内的密钥 (Telegram / OpenRouter / OpenAI / Anthropic / ElevenLabs)
- **TTS 资产** — 工作区音频文件
- **工作区指令** — AGENTS.md (`--workspace-target`)

查看 `netclaw claw migrate --help` 了解全部选项，或使用 `openclaw-migration` 技能以交互方式迁移并预览。

---

## 贡献 · Contributing

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境、代码规范与 PR 流程。

开发环境快速上手：

```bash
git clone https://github.com/netclawsec/netclaw-agent.git
cd netclaw-agent
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv venv --python 3.11
source venv/bin/activate
uv pip install -e ".[all,dev]"
python -m pytest tests/ -q
```

> **RL 训练（可选）：** 若要参与 RL / Tinker-Atropos 集成：
> ```bash
> git submodule update --init tinker-atropos
> uv pip install -e "./tinker-atropos"
> ```

---

## 社区 · Community

- [Issues](https://github.com/netclawsec/netclaw-agent/issues) — 问题反馈
- [Discussions](https://github.com/netclawsec/netclaw-agent/discussions) — 功能讨论
- [Skills Hub](https://agentskills.io) — 技能市场
- [NetClawSec 官网](https://netclawsec.com) — 公司与产品

---

## 许可与致谢 · License & Credits

基于 **MIT 协议** 开源 — 详见 [LICENSE](LICENSE)。

**NetClaw Agent** 由 [网钳科技 NetClawSec](https://netclawsec.com) 产品化与维护。项目在上游开源项目的基础上进行深度整合、商业化与本土化适配；上游归属与详细 Fork 结构见 [NETCLAW.md](NETCLAW.md)。
