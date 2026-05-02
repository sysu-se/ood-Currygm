# Homework 2 设计演进说明

## 1. 如何实现提示功能？

本次作业实现了两类提示：候选提示和下一步提示。

候选提示由 `Sudoku` 先根据当前棋盘计算候选数集合。`Sudoku.getCandidateGrid()` 会为每个空格计算当前可填数字，`Sudoku.getCandidates(row, col)` 则返回指定格子的候选数。候选数计算只依赖数独规则：同行、同列、同宫不能重复。

`Game.getCandidateHint(row, col)` 在 `Sudoku` 的基础上增加了面向 UI 的判断和提示信息。例如未选择格子时返回“请先选择一个格子”，当前棋盘存在冲突时返回“当前局面存在冲突”，已填格子则提示无需查看候选数。这个接口只读，不会写入棋盘，也不会进入 history。

下一步提示由 `Game.applyNextStepHint()` 实现。它会扫描当前候选数集合，寻找候选数长度为 1 的空格，并按行优先顺序选择第一个可确定格子。找到后通过统一的落子入口写入棋盘，因此该操作会进入 Undo / Redo history。UI 层通过 `nextStepHint` store 标记这个由提示填入的格子，用不同颜色显示。

## 2. 提示功能属于 Sudoku 还是 Game？

提示功能由 `Sudoku` 和 `Game` 协作完成。

`Sudoku` 更适合负责“规则推导”，也就是候选数集合如何计算、当前棋盘是否冲突、某个格子是否固定。这些逻辑只和数独棋盘本身有关，不应该依赖 UI，也不应该关心用户当前操作流程。

`Game` 更适合负责“会话语义”。例如用户是否选择了格子、当前局面有冲突时应该给什么提示、下一步提示是否要写入 history、提示成功后是否影响 Undo / Redo，这些都属于游戏会话层的行为。因此最终设计是：`Sudoku` 提供底层候选数能力，`Game` 封装成 UI 可以直接消费的提示接口。

## 3. 如何实现探索模式？

探索模式实现为 `Game` 的一种临时分支状态，而不是 UI 层的临时变量。

当用户点击“下一步提示”且当前没有唯一候选数时，UI 弹出探索模式确认框。用户确认后调用 `Game.startExplore()`，`Game` 会从当前局面创建探索 history：

- `exploreSnapshots = [当前主局面快照]`
- `exploreIndex = 0`
- 主局面的 `undoHistory` / `redoHistory` 保持不变

进入探索后，普通输入仍调用 `Game.guess()`，但 `Game` 会根据当前是否处于探索模式，把落子写入探索 history，而不是主 history。探索中的 Undo / Redo 也只在 `exploreSnapshots` 内移动。退出探索时，`Game.exitExplore()` 会把当前探索状态合并回主 history，回到普通模式后仍能继续撤销和重做探索路径。

探索模式下，用户每次选择格子，UI 会调用 `Game.getExploreCandidateHint(row, col)` 自动显示候选数。如果当前棋盘已经冲突，或者选中空格没有候选数，则认为探索失败，并显示失败提示。

探索失败记忆使用模块级 `failedExploreBoards` 集合保存失败局面。失败时不会把整条探索路径都标为错误，而是只记录当前失败局面以及它之前最多两个探索局面。这样可以减少把正确中间局面误判为失败的风险。

## 4. 主局面与探索局面的关系是什么？

主局面和探索局面不共享同一个可变棋盘对象，而是通过快照隔离。

`Sudoku` 本身通过 `toJSON()` 导出 `{ grid, fixed }` 快照，通过 `createSudokuFromJSON()` 恢复棋盘。`Game` 在进入探索时保存当前主局面快照，探索中的每一步也保存完整快照。恢复某一步时重新创建 `Sudoku` 对象，避免多个历史节点共享二维数组引用。

探索模式的退出操作同时承担“提交并合并探索历史”的职责。用户可以选择：

- 继续探索：保留探索 history。
- 回到起点：调用 `returnToExploreStart()`，恢复探索开始前的局面，但不删除探索 history。此时再次 Undo 可以回到探索 history 的栈顶局面。
- 退出探索：调用 `exitExplore()`，把探索模式当前状态的 history 合并进主 history，然后删除临时探索状态。

合并时，探索当前局面左侧的快照进入主 `undoHistory`，探索当前局面右侧的快照进入主 `redoHistory`。因此回到普通模式后，界面保持退出时探索模式下的当前局面，同时 Undo / Redo 能继续覆盖主模式和探索模式中的所有相关局面。

## 5. history 结构是否发生变化？

发生了变化，但主 history 仍保持线性栈结构。

Homework 1 中只有一组主 history：

- `undoHistory`
- `redoHistory`

Homework 2 中增加了一组探索专用 history：

- `exploreSnapshots`
- `exploreIndex`
- `exploreReturnedToStart`

普通模式下，`guess()`、`undo()`、`redo()` 仍使用主 history。探索模式下，这些操作切换到探索 history。探索 history 不是树状 DAG，而是一条临时线性分支；当用户在探索中 Undo 后重新落子，会截断当前位置之后的探索快照，形成新的线性分支。退出探索时，当前索引左侧合并到主 undo 栈，右侧合并到主 redo 栈，原有主 redo 栈保留在探索 redo 之后。

失败记忆没有作为 history 的一部分，而是单独用 `failedExploreBoards` 保存曾经失败过的棋盘 key。它用于提示用户“这个局面曾经导致失败”，不参与 Undo / Redo 的状态恢复。

## 6. Homework 1 的哪些设计在 Homework 2 中暴露出局限？

Homework 1 的设计主要面向“单一主局面 + 线性撤销重做”，在 Homework 2 中暴露出几个局限：

1. `Game` 原本只管理一条 history，无法表达探索模式这种临时分支。
2. `undo()` / `redo()` 原本只需要操作主栈，现在需要根据游戏状态分派到主 history 或探索 history。
3. `Sudoku` 原本只需要支持落子和冲突检测，提示功能要求它进一步提供候选数推导能力。
4. UI 原本只消费当前棋盘二维数组，探索模式要求 UI 能感知 `Game` 的会话状态，例如是否正在探索、是否回到探索起点、是否复现失败局面。
5. 如果一开始没有严格使用快照和深拷贝，探索 history 很容易被后续落子污染。

这些问题说明领域对象不能只服务于测试用例，还需要能表达真实交互流程中的状态变化。

## 7. 如果重做 Homework 1，会如何修改原设计？

如果重做 Homework 1，我会从一开始就把 `Game` 设计成明确的会话状态机，而不是只包含当前 `Sudoku` 和两个 history 栈。

具体会做这些调整：

1. 明确区分 `Sudoku` 和 `Game` 的职责。`Sudoku` 只负责棋盘规则、固定格、候选数、冲突检测、序列化；`Game` 负责用户操作、history、提示、探索状态。
2. 统一所有写入入口。普通输入、下一步提示、探索落子都应经过同一个 `Game` 层入口，避免 UI 直接修改二维数组。
3. 从一开始就使用快照对象表示 history 节点，避免共享数组引用。
4. 为 `Game` 预留状态字段，例如 `mode: 'normal' | 'explore'`，这样新增探索模式时不需要改动大量 Undo / Redo 逻辑。
5. 更早建立 Svelte store adapter，让 UI 只消费领域对象导出的响应式视图状态，而不是在组件里拼接业务逻辑。

这样 Homework 2 增加 Hint 和 Explore 时，改动会更集中，也更容易保证主局面、探索局面和 UI 状态之间的一致性。

## 8. 探索模式的本质是什么？

本实现中的探索模式更接近“`Game` 进入一种新的状态，同时创建一条临时分支会话”。

它不是 UI 层的开关，也不是简单地在组件里保存一个临时数组。进入探索后，`Game` 内部会切换到探索状态，并使用 `exploreSnapshots` 和 `exploreIndex` 管理探索分支。此时用户仍然通过同一个 `Game.guess()`、`Game.undo()`、`Game.redo()` 接口操作游戏，但这些接口内部会根据当前状态决定操作主 history 还是探索 history。

从交互语义上看，探索模式表示“我暂时不确定下一步，只想在当前主局面上开一个试错分支”。因此它既是状态切换，也是分支会话。状态切换负责改变操作语义，分支会话负责保存探索过程中的快照和回滚点。

## 9. 主局面与探索局面的关系细化

主局面是普通模式下的当前 `activeSudoku` 以及主 history 栈；探索局面是在进入探索时从主局面快照派生出来的临时分支。

二者不共享可变数组。每个局面都通过 `Sudoku.toJSON()` 保存为 `{ grid, fixed }` 快照，通过 `createSudokuFromJSON()` 恢复。这样即使探索过程中多次修改棋盘，也不会污染主局面的历史节点。

当前实现支持把探索状态提交回主模式。`exitExplore()` 不会强制跳到探索栈最后一个局面，而是以探索模式当前显示的局面作为普通模式的新当前局面。

合并规则是：`exploreSnapshots[0 ... exploreIndex - 1]` 接到主 `undoHistory`，`exploreSnapshots[exploreIndex + 1 ... end]` 接到主 `redoHistory`。如果用户先调用 `returnToExploreStart()`，当前局面被视为探索起点，退出后可以通过普通 Redo 重新走过探索分支。

## 10. history 如何演进？

Homework 1 的 history 是普通线性撤销栈：

- 操作前保存当前快照到 `undoHistory`
- Undo 时把当前快照压入 `redoHistory`
- Redo 时把当前快照压回 `undoHistory`

Homework 2 保留了这套主 history，同时新增探索 history：

- `exploreSnapshots` 保存探索分支的完整快照序列
- `exploreIndex` 表示当前位于探索分支的哪个节点
- `exploreReturnedToStart` 表示是否临时回到探索起点但仍保留探索栈

探索 history 仍然是线性的，没有引入树状分支或 DAG。原因是本次作业不要求多层嵌套探索，也不要求复杂分支合并。在线性探索中，如果用户 Undo 到中间节点后重新落子，后续探索快照会被截断，这和普通编辑器里的线性 Undo / Redo 行为一致。

失败记忆没有合入 history，而是独立存在于 `failedExploreBoards`。它记录的是“这个棋盘状态曾经导致失败”，用于提示和剪枝，不参与状态恢复。

