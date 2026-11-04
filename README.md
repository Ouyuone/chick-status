# chick-status

Claude Code 的像素小鸡 mod：一只小鸡站在输入框上方右侧，用造型和气泡告诉你会话和 PR 的状态。

| 状态 | 小鸡 |
| --- | --- |
| 处理中 | 拍翅膀动画 + `处理中 Ns` 计时 |
| 完成 | 开心眨眼 + 星星，显示 `✓ 完成 Ns`，5 秒后回到睡觉 |
| 空闲 | 迷你版睡觉（2 行），`zzZ · 上次 Ns` |
| PR open | 举绿旗（3 秒） |
| PR merged | 撒彩屑（3 秒） |
| PR closed | 掉眼泪（3 秒） |

气泡旁的标签显示当前分支最新 PR：`● #12 open`、`◆ #12 merged`、`✕ #12 closed`。当前分支已经真正合并进本地或 `origin` 上的 `dev`，或以 `release` 开头的分支时（`devops` 这类只是以 dev 开头的分支不算），还会显示 `◆ 已并入 <分支>`。

- PR 状态以 `gh pr list` 轮询为准（每 15 秒检查一次，结果缓存 2 分钟）。
- 在会话里执行 `gh pr create / merge / close / reopen` 或调用 GitHub MCP 的 PR 工具时，立即播放动画并马上刷新。
- 终端窄于 40 列时只显示一行文字。
- `/chick` 显示或隐藏小鸡，设置会被记住。
- `/clear` 清掉处理中、完成、上次耗时等会话状态；PR 状态保留。

## 安装

在 Claude Code 终端会话的输入框里：

```
/plugin install chick-status --marketplace Ouyuone/chick-status
```

出现 `Add marketplace?` 时输入 `y`，然后选择安装范围（默认第一个是用户范围，回车即可）。

在 shell 里：

```
claude plugin install chick-status --marketplace Ouyuone/chick-status
```

桌面应用里 `/plugin` 不可用：点输入框旁的 **+**，选 **Plugins** → **Add marketplace**，填 `Ouyuone/chick-status`，再 **Add plugin**。

## 依赖

- `git`：读取当前分支、判断本地合并。
- [`gh`](https://cli.github.com/)（可选）：已登录时才会显示 PR 状态；没有 `gh` 小鸡照常工作，只是不显示 PR 标签。

## 开发

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
