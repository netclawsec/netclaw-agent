<!--
  NetClaw Agent — 网钳科技产品化 AI 智能体。中文 README。
  For English documentation, see README.md.
-->

<p align="center">
  <img src="assets/banner.png" alt="NetClaw Agent" width="100%">
</p>

<h1 align="center">NetClaw Agent · 网钳智能体</h1>

<p align="center">
  <b>网钳科技 (NetClawSec) 自研 · 通用 AI 智能体平台</b>
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/docs-English-7D5BA6?style=for-the-badge" alt="English"></a>
  <a href="https://github.com/netclawsec/netclaw-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-6E4A99?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://github.com/netclawsec/netclaw-agent/issues"><img src="https://img.shields.io/badge/\u95ee\u9898\u53cd\u9988-GitHub-3E2866?style=for-the-badge" alt="Issues"></a>
  <a href="https://netclawsec.com"><img src="https://img.shields.io/badge/\u51fa\u54c1-\u7f51\u94b3\u79d1\u6280-B9A1D3?style=for-the-badge" alt="Built by NetClawSec"></a>
</p>

---

## 一句话介绍

**NetClaw Agent**（网钳智能体）是 [网钳科技](https://netclawsec.com) 面向个人开发者、研究者与企业客户推出的**通用型 AI 智能体平台**，内置持续学习闭环：从对话中自动沉淀技能、在使用中自我进化、跨会话回忆历史、持续构建用户画像。

你可以在 5 美金的 VPS、GPU 集群、或空闲几乎零成本的 Serverless 上运行它。它不依赖你的笔记本 — 从 Telegram 就能驱动云端 VM 工作。

---

## 为什么选择 NetClaw Agent

### 1. 真正的终端界面

- 多行编辑、斜杠命令补全、对话历史滚动
- 打断并重定向当前工具调用
- 流式渲染工具输出与思考过程

### 2. 随处可达的消息端

单进程网关同时接入：

| 平台 | 能力 |
|---|---|
| Telegram | 双向对话、语音消息转写、文件互传 |
| Discord | 频道对话、DM、命令审批 |
| Slack | 工作区集成、Thread 对话 |
| WhatsApp | 商业消息通道 |
| Signal | 端到端加密通道 |
| Email | 异步对话、附件支持 |
| CLI | 本地终端界面 |

跨平台会话延续 — 从 Telegram 发起的问题，在 Discord 可以继续接上。

### 3. 闭环学习系统

这是 NetClaw Agent 的核心差异化能力：

- **程序性记忆 (Skills)** — 复杂任务完成后自动沉淀为可复用技能
- **技能自优化** — 同一技能在多次调用中自动迭代
- **跨会话记忆** — FTS5 全文检索 + LLM 摘要，回忆过往对话
- **用户建模** — 基于 [Honcho](https://github.com/plastic-labs/honcho) 的辩证式画像
- **兼容开放标准** — 与 [agentskills.io](https://agentskills.io) 生态互通

### 4. 定时任务自动化

内置 cron 调度器，用自然语言配置：

```text
/cron add "每天早 8 点把昨日 PR 列出发我 Telegram"
/cron add "每周五汇总本周工作进度邮件给团队"
```

无人值守执行，结果投递到任意平台。

### 5. 并行子代理

派发隔离子 Agent 并行处理多路工作流；通过 RPC 调用 Python 脚本，将多步流水线折叠为零上下文成本的一轮交互。

### 6. 多后端运行时

六种终端执行后端，一键切换：

| 后端 | 适用场景 |
|---|---|
| Local | 本地笔记本 / 服务器 |
| Docker | 沙箱隔离 |
| SSH | 远程机器 |
| Daytona | Serverless 持久化（闲置休眠） |
| Singularity | HPC / 科研环境 |
| Modal | GPU / Serverless |

---

## 支持的模型

NetClaw Agent 不绑定任何单一模型供应商，支持任意 OpenAI 兼容端点：

- **国产模型**：智谱 GLM、月之暗面 Kimi、MiniMax、小米 MiMo、百度文心、通义千问
- **国际模型**：OpenAI、Anthropic Claude、Google Gemini
- **聚合平台**：OpenRouter (200+ 模型)、Hugging Face Inference
- **私有部署**：vLLM、SGLang、LMDeploy、Ollama 及任意 OpenAI 兼容端点

切换模型一行命令：

```bash
netclaw model                    # 交互式选择
netclaw model zhipu:glm-4.6      # 直接指定
/model openrouter:anthropic/claude-sonnet-4.6   # 会话内切换
```

---

## 快速开始

### 安装

```bash
curl -fsSL https://raw.githubusercontent.com/netclawsec/netclaw-agent/main/scripts/install.sh | bash
```

支持 Linux / macOS / WSL2 / Android (Termux)。Windows 用户请先安装 [WSL2](https://learn.microsoft.com/zh-cn/windows/wsl/install)。

### 首次对话

```bash
source ~/.bashrc   # 或 source ~/.zshrc
netclaw             # 启动 TUI
```

> 命令行统一使用 `netclaw`。

### 配置模型 / 工具

```bash
netclaw model        # 选择 LLM
netclaw tools        # 启用/关闭工具
netclaw config set   # 设置配置项
netclaw setup        # 完整配置向导
```

### 启动消息网关

```bash
netclaw gateway setup   # 配置 Telegram/Discord 等平台
netclaw gateway start   # 启动网关进程
```

---

## 核心命令速查

```bash
netclaw               # 进入 TUI
netclaw model         # 选择模型
netclaw tools         # 配置工具
netclaw config set    # 修改配置
netclaw gateway       # 消息网关
netclaw setup         # 初次设置向导
netclaw claw migrate  # 从 OpenClaw 迁移
netclaw update        # 升级版本
netclaw doctor        # 诊断环境
```

会话内斜杠命令：

| 命令 | 作用 |
|---|---|
| `/new` `/reset` | 重置会话 |
| `/model provider:name` | 切换模型 |
| `/personality name` | 切换人格 |
| `/retry` `/undo` | 重试 / 撤销上一轮 |
| `/compress` `/usage` | 压缩上下文 / 查看用量 |
| `/insights [--days N]` | 使用洞察报告 |
| `/skills` `/<skill-name>` | 浏览与调用技能 |
| `/stop` | 打断当前任务 |

---

## 从 OpenClaw 迁移

```bash
netclaw claw migrate              # 交互式迁移（完整预设）
netclaw claw migrate --dry-run    # 预览迁移内容
netclaw claw migrate --preset user-data   # 只迁移用户数据，跳过密钥
netclaw claw migrate --overwrite  # 覆盖冲突项
```

导入范围：SOUL.md / MEMORY.md / USER.md / 用户技能 / 命令白名单 / 消息平台配置 / 允许列表密钥 / TTS 资产 / AGENTS.md。

---

## 开发贡献

```bash
git clone https://github.com/netclawsec/netclaw-agent.git
cd netclaw-agent
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv venv --python 3.11
source venv/bin/activate
uv pip install -e ".[all,dev]"
python -m pytest tests/ -q
```

详细开发规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 商业支持

NetClawSec 为企业客户提供：

- **私有化部署** — 内网 / 专有云一键交付
- **定制技能** — 针对行业场景开发专用技能
- **SLA 支持** — 响应时效与工单系统
- **合规咨询** — 数据主权、审计日志、密钥托管

联系：[netclawsec.com](https://netclawsec.com)

---

## 许可与致谢

基于 **MIT 协议** 开源 — 详见 [LICENSE](LICENSE)。

**NetClaw Agent** 由 [网钳科技 NetClawSec](https://netclawsec.com) 产品化与维护。项目在上游开源社区基础上做深度整合、工程化与本土化，上游归属与详细 Fork 结构见 [NETCLAW.md](NETCLAW.md)。

---

<p align="center">
  <sub>Copyright © 2026 <a href="https://netclawsec.com">NetClawSec · 网钳科技</a> · MIT License</sub>
</p>
