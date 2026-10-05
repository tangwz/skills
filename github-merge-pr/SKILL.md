---
name: github-merge-pr
description: 合并 GitHub PR 到 main，保持线性提交历史，删除远端 PR 分支并保留本地分支。用户要求合并 PR、线性历史或合并后仅保留本地分支时使用；单纯查看 PR 或修复审查意见不触发合并。
---

# GitHub PR 线性合并

默认目标是 `main`：保留按功能主题拆分的提交，不新增 merge commit；合并后只删除该 PR 的远端分支，保留本地分支。用户指定其他目标或策略时以其要求为准。与用户沟通用简体中文，提交信息和代码使用 English。

## 范围与授权

- 优先使用 `gh` CLI；临时失败时可使用已连接的 GitHub 工具核对真实状态。不要把本机网络故障解释为仓库权限不足。
- 技能被选中不等于用户授权合并、删除分支或重写历史。依据本次请求和已有授权执行；用户已经明确授权的动作不重复询问。
- 阅读目标仓库的 `AGENTS.md`。不夹带其他改动，不擅自更新架构、仓库合并设置或分支保护，不绕过规则、审查和 CI。
- 仅处理已授权的审查修复；修复按主题提交到原 PR，验证后再 resolve。过期讨论不自动视为已修复。发布 PR 评论、联系审查者或建立持续监控需要相应授权。

## 合并前的证据

1. 从用户指定的 PR 或当前分支确认 GitHub 主机、仓库、PR 编号、base/head 分支、head 所属仓库与对应 remote。核对 PR、API 和 Git remote 指向同一主机；所有 `gh api` 调用显式指定该主机。不要假设 remote 总是 `origin`，也不要把 fork 的分支当成 base 仓库的同名分支。
2. 读取 PR 最新状态、完整审查讨论及审查摘要、当前 head 的 CI、分支保护、rulesets 和合并队列要求。讨论分页要读完。PR 已合并时只完成剩余清理；已关闭但未合并时停止。未解决意见、进行中的审查、仍有效的 changes requested、待完成的必需检查或相关 CI 失败都应先处理。
3. 记录完整的已验证 head SHA 和 base SHA。CI 必须覆盖该 head，或平台明确记录的对应测试合并提交；不能用旧 head 的成功结果代替。逐项核对有效的必需 approval 的 `commit_id` / `commit.oid` 是否对应该 head，或确认适用保护规则在服务端保证最近一次可审查 push 已获批准；汇总的 `APPROVED` 状态不能替代这一证据。没有配置 CI 时按仓库约定采用可用验证，说明依据。
4. 查看 `git status`、`git branch -vv`、`git worktree list --porcelain` 和最新远端 refs。本地待推送提交必须与已验证 PR head 一致；目标分支不能夹带未发布提交。head/base 变化时重新评估，不顺手合入未审查的提交。
5. 保留所有不属于本次任务的已修改、暂存和未跟踪文件。目标分支已在另一 worktree 检出时使用该 worktree。可证明不受影响的修改不阻碍快进；先记录其差异，之后比较。若会冲突，停止依赖该工作区的写操作，不自动 stash、reset 或清理文件。
6. 在入队或任何远端合并前，fetch 已核对的精确 head ref，并确认取回的 SHA 等于 `reviewed_head`；先让真正的本地 `refs/heads/$local_topic` 保存该提交。分支不存在时直接创建而无需 checkout；已存在时核对它指向该 head，不覆盖不同提交或移动另一 worktree 的分支。名称冲突时保留原分支并停止，或按已有授权采用独立本地名称。仅有 `FETCH_HEAD`、远端跟踪 ref 或打算合并后再创建分支，不满足本地保留要求。

单纯合并且树和已验证 head 不变时，复用现有测试证据。只有新增修复、冲突解决或集成结果改变才补充有意义的验证。

## 选择能保持直线的方式

**远端合并必须带 head 条件。** 使用在服务端将 `reviewed_head` 与当前 PR head 一起校验的合并操作；head 已变化时应拒绝合并并重新核对。固定源 SHA 的普通 `git push` 只检查目标 ref 能否更新，不能保证 PR head 仍是已验证版本；再次预读 head 也不能消除这两个操作之间的竞态。见 [GitHub 条件式合并接口](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)。

**快进以原子约束为前提。** 若平台提供能原子校验 PR head 的快进合并机制，且仓库流程允许、base 是 head 的祖先、新增区间无 merge commit，可用它保留原 SHA。没有这种已验证机制时，不直接向 base 推送旧 head。标准 GitHub 合并没有纯快进选项，不能为保留 SHA 改用无 head 条件的 push。

**先确认实际提交范围。** 读取平台的 stack 归属与所有尚未合并的 downstack PR；不能只根据所选 PR 的 base/head 猜测是否独立。属于 stack 时不使用下方单 PR 命令：先确认选定 PR 和全部未合并 downstack PR 的授权，并逐项记录主机、仓库、head SHA 与本地 topic。对每个将落地的 PR 核对审查、CI 和合并策略，完成第 6 步的本地保留，以及下节的依赖 PR、共享 source 和并发清理约束；任一层不满足条件时不启动整个 stack 合并。所有层均满足后才使用官方异步 stack 路径，并逐层验收与清理，见 [堆叠 PR 合并](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests)。

选择 rebase 前检查 PR 新增范围内的每个提交，识别 tree 与唯一父提交相同的初始空提交。GitHub rebase 会丢弃这些提交；发布或自动化标记不能默认为可丢。存在空提交时先取得舍弃它们的明确授权，或选择符合原子约束且保留它们的策略；没有可用策略就停止。验收时记录获准舍弃的提交，不能仅凭最终 tree 一样宣称全部提交保留，见 [GitHub rebase 行为](https://docs.github.com/en/pull-requests/reference/pull-request-merges#rebase-and-merge-your-commits)。

**非队列路径同时约束 base。** `--match-head-commit` 不校验 base SHA，GitHub 合并接口也没有 expected-base 参数。仅当适用保护规则在合并时强制通过针对当前 base / 测试合并结果的必需检查，且要求分支保持最新时，才采用此路径。只有 head 的 CI 或刚预读的 base SHA 不足以阻止 base 随后推进；缺少这种集成约束时改走已核验策略的 merge queue，或停止并说明限制，不绕过保护，见 [分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)。

GitHub rebase merge 逐个重放非空主题提交，但会改变提交 ID；squash 将源提交替换为一个新提交，只在单一逻辑变更且用户接受压缩时考虑。依据已有授权选择；没有相应授权不执行 rebase、squash 或覆盖已发布历史。

**所有改写路径都检查签名来源。** 选择 rebase、squash 或采用这些策略的合并队列前，检查整个 PR 范围的签名、平台验证状态与适用签名要求。这些方式不保留原提交者的逐提交签名；新的 squash 提交即使带有 GitHub 的 Verified 签名，也不能替代原作者的来源验证。存在签名时说明损失，依据已有授权确认用户接受，或采用满足前述原子约束和签名规则的保留/授权重签策略。接受 SHA 改变或提交压缩不等于接受原签名丢失，不能仅凭最终 tree 一样宣称来源验证被保留；无可用策略则停止。见 [rebase 签名限制](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-rebase-and-merge) 与 [squash 签名规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-signed-commits)。

上述集成保护适用、PR 不属于 stack、仓库允许且已获 rebase 授权、目标分支不要求队列时，例如：

```bash
gh pr merge "$pr_url" --rebase --match-head-commit "$reviewed_head"
```

**入队前核对队列的实际策略。** 目标分支要求 merge queue 时，读取该分支适用的队列配置，确认实际使用 merge、rebase 还是 squash；CLI 的 `--rebase` 不会替队列选择策略。merge 会引入合并节点，必须停止；squash 只有符合前述压缩条件并获得授权才可入队；rebase 也需具备相应授权。无法读取或确定队列策略时停止入队，说明阻碍。不能仅凭命令行 flag 推断会保留主题提交，见 [GitHub 合并策略](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)。

**只条件式直接入队，不启用等待中的 auto-merge。** 先等待入队所需的检查与审查就绪，再重读并核对 head；通过 `gh api graphql` 调用专用 `enqueuePullRequest`，将 `expectedHeadOid` 设置为 `reviewed_head`，并核对实际队列条目。条件不满足时等待或停止，不降级为 auto-merge。`gh pr merge` 在检查未完成时可能启用 auto-merge，而启用时的 expected OID 不约束未来实际合并的 head：有写权限者的新 push 可能保留该设置。已有 auto-merge 时，按已有授权取消并读回状态后再采用条件式操作；无法取消则停止本技能的合并动作并说明仍有外部自动合并。见 [入队接口](https://docs.github.com/en/graphql/reference/pulls#enqueuepullrequestinput) 与 [auto-merge 行为](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)。

已排队不等于合并完成；head 改变或离队后重新评估，不自动为新 head 入队。不要使用默认 merge commit、默认 `gh pr update-branch`、管理员绕过或改变保护规则来获得直线。

**远端确认之前不推进本地 base。** 先完成条件式远端合并并读回实际结果，再执行下一节的本地快进。远端拒绝、失败、结果不明或仍在队列时，本地 base 保持原位置；只做状态核对，不自动回滚或强推。

## 先确认合并，再清理远端

- 读取 GitHub 的 `merged`、`mergedAt`、`mergeCommit` 和最新远端 base，确认实际合并结果。普通“关闭”不等于合并。快进时应验证原 head 已进入 base；rebase/squash 时依据平台的合并记录、提交对应关系与差异验证，不能要求旧 head SHA 可达。
- GitHub 合并完成后 fetch base remote，并在目标分支所属 worktree 中用 `--ff-only` 对齐本地 base 至已核对的远端结果。不能用可能创建 merge commit 的默认 `git pull`；本地分叉或脏文件冲突时保留现场并说明阻碍。
- 验证合并前已保留的本地 topic 分支仍存在且保存此次工作。快进时它和 base 位于同一提交链。rebase/squash 后，旧本地 topic 可能让 `--graph --all` 仍然分叉：核对本地独有提交与 worktree 修改后，按已获授权对齐至合并结果；没有授权则说明限制并保留数据。
- 禁止使用 `gh pr merge --delete-branch`，因为它会同时删除本地和远端分支；见 [CLI 文档](https://cli.github.com/manual/gh_pr_merge)。不要用 `git branch -d/-D` 或归档仍需保留的 worktree。
- 只删除 head 所属仓库的精确分支 ref，不能删除 base、默认分支或无关分支。删除前确认远端仍指向已验证 head；若已有新提交，停止清理并重新核对。若远端已自动删除，只验证即可。
- 合并或入队前（考虑仓库自动删除）及手动删除前，检查两组开放 PR：以该分支为 base 的依赖 PR，以及以同一主机、head 仓库和分支为 source 的其他 PR。只从共享 source 结果中排除正在合并的 PR（按完整 PR URL），不能只按编号或 base 过滤。依赖 PR 会被自动 retarget，共享 source 的 PR 可能失去来源分支；停止可能触发删除的操作，说明受影响 PR，并取得对应跨 PR 变更的授权。查询失败、分页不完整或仓库/ref 为 null 时也停止，不把分支删除授权等同于修改其他 PR 的授权，见 [GitHub 分支删除副作用](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request)。

**PR 关联预查不具备原子性。** 查询后仍可能新建依赖或共享 source 的 PR；SHA lease 只校验 ref 的提交位置，不能锁定 PR 关联集合。涉及可并发使用的分支时，触发删除前必须有能防止新关联的仓库侧协调窗口，或已有明确接受本次剩余并发影响的用户授权；仅授权删除该分支不能推定授权影响未知 PR。条件不满足时不执行手动删除，并保留远端分支报告待清理；自动删除可能触发相同影响时，在合并或入队前停止。不要为此擅自修改仓库设置或保护，见 [分支删除影响](https://docs.github.com/en/pull-requests/how-tos/commit-changes/managing-branches-within-your-repository#deleting-a-branch)。

`head_host` 和 `head_repo` 来自已核对的 PR 与 remote，分别为主机和 head 仓库（`owner/name`）。依赖 PR 查询示例：

```bash
gh api --hostname "$head_host" --paginate --method GET "repos/$head_repo/pulls" \
  -f state=open -f base="$head_branch" -f per_page=100
```

共享 source 使用 head ref 的 `associatedPullRequests`，覆盖不同 base 和 fork 的目标仓库；逐页核对返回的 head 仓库与分支，只排除完整 URL 等于 `pr_url` 的 PR。见 [GitHub Ref 查询](https://docs.github.com/en/graphql/reference/git#ref)：

```bash
gh api graphql --hostname "$head_host" --paginate \
  -F owner="${head_repo%%/*}" -F name="${head_repo#*/}" \
  -f ref="refs/heads/$head_branch" -f query='
  query($owner: String!, $name: String!, $ref: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $ref) {
        associatedPullRequests(first: 100, after: $endCursor, states: OPEN) {
          nodes { url headRefName headRepository { nameWithOwner } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }'
```

满足上述 PR 关联与并发条件后，可用显式 SHA lease 保护授权的删除，防止核对后分支又被推进；它不保护 PR 关联集合，此命令只删除指定 ref，不授权覆盖提交。见 [Git push 文档](https://git-scm.com/docs/git-push)：

```bash
git push --force-with-lease="refs/heads/$head_branch:$reviewed_head" \
  "$head_remote" ":refs/heads/$head_branch"
```

删除成功后 fetch/prune head remote。仅当本地 topic 的 upstream 指向刚删除的分支时，清除该跟踪配置；保留本地分支本身：

```bash
git branch --unset-upstream "$local_topic"
```

## 验收与交付

核对以下实际结果：

- GitHub PR 已合并到指定 base，远端 base 包含已验证的改动。
- 远端 head 分支不存在，本地 topic 分支存在；不能将远端跟踪 ref 误当成本地分支。
- 合并新增区间没有 merge commit，原有主题提交按选定策略保留。`git log --graph --oneline --decorate --all` 显示目标链的真实形状；其他分支或既有 merge 节点影响全图时明确说明，不删除无关 refs 伪造直线。
- 相关工作区原有未提交修改完整保留，没有额外改动。
- 专门监控该 PR 的既有任务在确认合并后按原约定停止；没有现成监控时不另建任务。

对超时、EOF 或 TLS 错误，先读回 PR 与远端 refs，确认上一次写入是否已经成功，再进行有限重试。仍无法核实时停止下一步写操作，报告“合并成功但清理待完成”等精确状态，不把部分完成报告为全部完成。

交付简洁说明 PR 链接、合并方式与最终 SHA、提交保留情况、远端删除和本地保留结果。只报告有证据的状态；新的 base CI 若仍运行，应区分它与合并前已经成功的检查。
