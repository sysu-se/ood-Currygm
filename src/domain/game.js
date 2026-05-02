/**
 * @fileoverview Game 领域对象，负责当前 Sudoku 会话、线性历史、Undo/Redo 与会话序列化。
 */

import { createSudokuFromJSON } from './sudoku.js';

/**
 * @typedef {import('./sudoku.js').SudokuObject} SudokuObject
 */

/**
 * @typedef {Object} GameObject
 * @property {function(): SudokuObject} getSudoku
 * @property {function({ row: number, col: number, value: number|null }): boolean} guess
 * @property {function(): boolean} undo
 * @property {function(): boolean} redo
 * @property {function(): boolean} canUndo
 * @property {function(): boolean} canRedo
 * @property {function(number, number): boolean} isFixedCell
 * @property {function(number|null, number|null): { ok: boolean, reason?: string, message: string, row?: number, col?: number, candidates?: number[] }} getCandidateHint
 * @property {function(): { ok: boolean, reason?: string, message: string, row?: number, col?: number, value?: number }} applyNextStepHint
 * @property {function(): boolean} isExploring
 * @property {function(): { ok: boolean, message: string }} startExplore
 * @property {function(): { ok: boolean, message: string }} exitExplore
 * @property {function(): { ok: boolean, message: string }} returnToExploreStart
 * @property {function(): { active: boolean, index: number, length: number, returnedToStart: boolean }} getExploreStatus
 * @property {function(number|null, number|null): { ok: boolean, reason?: string, message: string, row?: number, col?: number, candidates?: number[] }} getExploreCandidateHint
 * @property {function(): ({ reason: string, message: string }|null)} consumeExploreNotice
 * @property {function(): Object} toJSON
 * @property {function(): string} toString
 */

const SUDOKU_SIZE = 9;
const failedExploreBoards = new Set();

function snapshotSudoku(sudoku) {
	return sudoku.toJSON();
}

function cloneSnapshot(snapshot) {
	return createSudokuFromJSON(snapshot).toJSON();
}

/**
 * 克隆并校验序列化的历史栈。
 *
 * @param {Array<{ grid: number[][], fixed?: boolean[][] }>} history
 * @param {string} fieldName
 * @returns {Array<{ grid: number[][], fixed: boolean[][] }>}
 * @throws {TypeError} 当 `history` 不是数组时抛出。
 */
function cloneHistory(history, fieldName) {
	if (!Array.isArray(history)) {
		throw new TypeError(`${fieldName} must be an array.`);
	}

	return history.map(cloneSnapshot);
}

/**
 * 为棋盘快照生成稳定 key，用于记录探索失败局面。
 *
 * @param {{ grid: number[][], fixed?: boolean[][] }} snapshot
 * @returns {string}
 */
function buildSnapshotKey(snapshot) {
	const gridKey = snapshot.grid.flat().join('');
	const fixedKey = snapshot.fixed
		? snapshot.fixed.flat().map(cell => (cell ? '1' : '0')).join('')
		: '';

	return `${gridKey}|${fixedKey}`;
}

/**
 * 将 Sudoku 对象或序列化快照转换为独立的 Sudoku 实例。
 *
 * @param {SudokuObject|{ grid: number[][] }} sudoku
 * @returns {SudokuObject}
 */
function normalizeSudokuInput(sudoku) {
	if (sudoku && typeof sudoku.clone === 'function' && typeof sudoku.toJSON === 'function') {
		return sudoku.clone();
	}

	return createSudokuFromJSON(sudoku);
}

/**
 * 判断候选提示请求中的坐标是否缺失。
 *
 * @param {number|null|undefined} row
 * @param {number|null|undefined} col
 * @returns {boolean}
 */
function isMissingPosition(row, col) {
	return row === null || row === undefined || col === null || col === undefined;
}

/**
 * 判断候选提示请求中的坐标是否超出数独范围。
 *
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
function isInvalidPosition(row, col) {
	return !Number.isInteger(row) || row < 0 || row >= SUDOKU_SIZE
		|| !Number.isInteger(col) || col < 0 || col >= SUDOKU_SIZE;
}

/**
 * 围绕一个 Sudoku 实例创建 Game 领域对象。
 *
 * Game 会在每次成功输入前保存完整 Sudoku 快照，
 * 这样 undo/redo 不会受后续对象修改影响，序列化后的会话也更稳定。
 *
 * @param {Object} options
 * @param {SudokuObject} options.sudoku
 * @param {Array<{ grid: number[][], fixed?: boolean[][] }>} [options.undoStack=[]]
 * @param {Array<{ grid: number[][], fixed?: boolean[][] }>} [options.redoStack=[]]
 * @returns {GameObject}
 * @throws {TypeError} 当缺少 `sudoku` 或历史栈格式错误时抛出。
 */
export function createGame({ sudoku, undoStack = [], redoStack = [] } = {}) {
	if (!sudoku) {
		throw new TypeError('createGame requires a sudoku instance.');
	}

	let activeSudoku = normalizeSudokuInput(sudoku);
	let undoHistory = cloneHistory(undoStack, 'undoStack');
	let redoHistory = cloneHistory(redoStack, 'redoStack');
	let exploreSnapshots = null;
	let exploreIndex = -1;
	let exploreReturnedToStart = false;
	let exploreNotice = null;

	function restore(snapshot) {
		activeSudoku = createSudokuFromJSON(snapshot);
	}

	function getCurrentSnapshot() {
		return snapshotSudoku(activeSudoku);
	}

	/**
	 * 功能：判断当前是否处于探索模式。
	 * 上下文：Game 在探索模式下切换到独立 history，避免污染主局面 history。
	 *
	 * @returns {boolean}
	 */
	function isExploreActive() {
		return Array.isArray(exploreSnapshots);
	}

	/**
	 * 功能：写入探索模式提示消息，等待 UI 消费。
	 * 上下文：Undo 到探索起点、失败局面复现等事件不一定直接由按钮触发，因此用 notice 暂存。
	 *
	 * @param {string} reason
	 * @param {string} message
	 */
	function setExploreNotice(reason, message) {
		exploreNotice = { reason, message };
	}

	/**
	 * 功能：记录最近三个探索局面到失败记忆集合。
	 * 上下文：发生探索失败时，只记录失败终点和它之前最多两个探索局面，降低整条路径误判风险。
	 */
	function rememberRecentExploreFailure() {
		if (!isExploreActive()) {
			return;
		}

		const start = Math.max(0, exploreIndex - 2);
		const snapshots = exploreSnapshots.slice(start, exploreIndex + 1);

		for (const snapshot of snapshots) {
			failedExploreBoards.add(buildSnapshotKey(snapshot));
		}
	}

	/**
	 * 功能：检测当前探索局面是否复现过失败路径。
	 * 上下文：用户在探索中回到已知失败局面时，UI 应给出即时提示。
	 *
	 * @returns {boolean}
	 */
	function detectRememberedExploreFailure() {
		if (!isExploreActive()) {
			return false;
		}

		if (failedExploreBoards.has(buildSnapshotKey(getCurrentSnapshot()))) {
			setExploreNotice('EXPLORE_FAILED_MEMORY', '该局面曾经导致失败，请尝试其他探索路径');
			return true;
		}

		return false;
	}

	/**
	 * 功能：记录探索模式下的一次写入，并维护探索专用 history。
	 * 上下文：探索 history 使用当前状态快照列表，不改动主局面的 undo/redo 栈。
	 *
	 * @param {{ row: number, col: number, value: number|null }} move
	 * @returns {boolean}
	 */
	function applyExploreMove(move) {
		if (exploreReturnedToStart) {
			exploreIndex = 0;
			exploreReturnedToStart = false;
		}

		const changed = activeSudoku.guess(move);

		if (!changed) {
			return false;
		}

		exploreSnapshots = exploreSnapshots.slice(0, exploreIndex + 1);
		exploreSnapshots.push(getCurrentSnapshot());
		exploreIndex += 1;

		if (activeSudoku.getInvalidCells().length > 0) {
			rememberRecentExploreFailure();
			setExploreNotice('EXPLORE_FAILED', '探索失败：当前局面出现冲突');
		} else {
			detectRememberedExploreFailure();
		}

		return true;
	}

	/**
	 * 功能：把探索模式当前的 Undo/Redo 状态合并回主 history。
	 * 上下文：退出探索后要保留当前可见局面，并允许普通模式继续撤销和重做探索路径。
	 */
	function mergeExploreHistoryIntoMain() {
		const currentExploreIndex = exploreReturnedToStart ? 0 : exploreIndex;
		const currentSnapshot = cloneSnapshot(exploreSnapshots[currentExploreIndex]);
		const exploreUndoSnapshots = exploreSnapshots
			.slice(0, currentExploreIndex)
			.map(cloneSnapshot);
		const exploreRedoSnapshots = exploreSnapshots
			.slice(currentExploreIndex + 1)
			.map(cloneSnapshot)
			.reverse();

		undoHistory = undoHistory.concat(exploreUndoSnapshots);
		redoHistory = redoHistory.concat(exploreRedoSnapshots);
		restore(currentSnapshot);
	}

	/**
	 * 功能：记录一次会改变棋盘的操作。
	 * 上下文：普通输入和下一步提示都通过这里进入 history，保证 undo/redo 行为一致。
	 *
	 * @param {{ row: number, col: number, value: number|null }} move - 要写入的数独操作
	 * @returns {boolean} true 表示棋盘发生变化
	 */
	function applyMove(move) {
		if (isExploreActive()) {
			return applyExploreMove(move);
		}

		const previousSnapshot = getCurrentSnapshot();
		const changed = activeSudoku.guess(move);

		if (!changed) {
			return false;
		}

		undoHistory.push(previousSnapshot);
		redoHistory = [];
		return true;
	}

	return {
		getSudoku() {
			return activeSudoku.clone();
		},

		guess(move) {
			return applyMove(move);
		},

		undo() {
			if (isExploreActive()) {
				if (exploreReturnedToStart) {
					if (exploreIndex <= 0) {
						setExploreNotice('EXPLORE_AT_START', '已回到探索模式开始前的局面，是否退出探索模式？');
						return false;
					}

					restore(exploreSnapshots[exploreIndex]);
					exploreReturnedToStart = false;
					detectRememberedExploreFailure();
					return true;
				}

				if (exploreIndex === 0) {
					setExploreNotice('EXPLORE_AT_START', '已回到探索模式开始前的局面，是否退出探索模式？');
					return false;
				}

				exploreIndex -= 1;
				restore(exploreSnapshots[exploreIndex]);

				if (exploreIndex === 0) {
					setExploreNotice('EXPLORE_AT_START', '已回到探索模式开始前的局面，是否退出探索模式？');
				} else {
					detectRememberedExploreFailure();
				}

				return true;
			}

			if (undoHistory.length === 0) {
				return false;
			}

			redoHistory.push(getCurrentSnapshot());
			restore(undoHistory.pop());
			return true;
		},

		redo() {
			if (isExploreActive()) {
				if (exploreReturnedToStart || exploreIndex >= exploreSnapshots.length - 1) {
					return false;
				}

				exploreIndex += 1;
				restore(exploreSnapshots[exploreIndex]);
				detectRememberedExploreFailure();
				return true;
			}

			if (redoHistory.length === 0) {
				return false;
			}

			undoHistory.push(getCurrentSnapshot());
			restore(redoHistory.pop());
			return true;
		},

		canUndo() {
			if (isExploreActive()) {
				return exploreReturnedToStart ? exploreIndex > 0 : exploreIndex > 0;
			}

			return undoHistory.length > 0;
		},

		canRedo() {
			if (isExploreActive()) {
				return !exploreReturnedToStart && exploreIndex < exploreSnapshots.length - 1;
			}

			return redoHistory.length > 0;
		},

		isFixedCell(row, col) {
			return activeSudoku.isFixedCell(row, col);
		},

		getCandidateHint(row, col) {
			if (isMissingPosition(row, col)) {
				return {
					ok: false,
					reason: 'NO_CELL_SELECTED',
					message: '请先选择一个格子',
				};
			}

			if (isInvalidPosition(row, col)) {
				return {
					ok: false,
					reason: 'INVALID_POSITION',
					message: '选择的格子位置不合法',
				};
			}

			if (activeSudoku.getInvalidCells().length > 0) {
				return {
					ok: false,
					reason: 'BOARD_CONFLICT',
					message: '当前局面存在冲突，请先修正冲突后再查看候选数',
				};
			}

			if (activeSudoku.getGrid()[row][col] !== 0) {
				return {
					ok: false,
					reason: 'CELL_FILLED',
					message: '该格子已经有数字，无需查看候选数',
				};
			}

			// 功能：通过 Sudoku 统一计算全盘候选数，再取出 UI 当前选中格的候选集合。
			// 上下文：候选提示是只读查询，不写入 history，也不影响 undo/redo。
			const candidates = activeSudoku.getCandidateGrid()[row][col].slice();

			if (candidates.length === 0) {
				return {
					ok: false,
					reason: 'NO_CANDIDATES',
					message: '该格子当前没有可用候选数',
				};
			}

			return {
				ok: true,
				row,
				col,
				candidates,
				message: '当前格子的候选数如下',
			};
		},

		applyNextStepHint() {
			if (activeSudoku.getInvalidCells().length > 0) {
				return {
					ok: false,
					reason: 'BOARD_CONFLICT',
					message: '当前局面存在冲突，请先修正冲突后再使用下一步提示',
				};
			}

			const grid = activeSudoku.getGrid();
			const candidateGrid = activeSudoku.getCandidateGrid();

			for (let row = 0; row < SUDOKU_SIZE; row += 1) {
				for (let col = 0; col < SUDOKU_SIZE; col += 1) {
					const candidates = candidateGrid[row][col];

					if (grid[row][col] === 0 && candidates.length === 1) {
						const value = candidates[0];

						applyMove({ row, col, value });

						return {
							ok: true,
							row,
							col,
							value,
							message: '已填入下一步提示数字',
						};
					}
				}
			}

			return {
				ok: false,
				reason: 'NO_NEXT_STEP',
				message: '当前没有可直接确定的下一步',
			};
		},

		isExploring() {
			return isExploreActive();
		},

		startExplore() {
			if (isExploreActive()) {
				return {
					ok: false,
					message: '当前已经处于探索模式',
				};
			}

			exploreSnapshots = [getCurrentSnapshot()];
			exploreIndex = 0;
			exploreReturnedToStart = false;
			exploreNotice = null;
			detectRememberedExploreFailure();

			return {
				ok: true,
				message: '已进入探索模式',
			};
		},

		exitExplore() {
			if (!isExploreActive()) {
				return {
					ok: false,
					message: '当前不在探索模式',
				};
			}

			mergeExploreHistoryIntoMain();
			exploreSnapshots = null;
			exploreIndex = -1;
			exploreReturnedToStart = false;
			exploreNotice = null;

			return {
				ok: true,
				message: '已将探索历史合并到主模式',
			};
		},

		returnToExploreStart() {
			if (!isExploreActive()) {
				return {
					ok: false,
					message: '当前不在探索模式',
				};
			}

			restore(exploreSnapshots[0]);
			exploreReturnedToStart = true;

			return {
				ok: true,
				message: '已回到探索开始前的局面，探索历史仍然保留',
			};
		},

		getExploreStatus() {
			return {
				active: isExploreActive(),
				index: isExploreActive() ? exploreIndex : -1,
				length: isExploreActive() ? exploreSnapshots.length : 0,
				returnedToStart: exploreReturnedToStart,
			};
		},

		getExploreCandidateHint(row, col) {
			if (!isExploreActive()) {
				return {
					ok: false,
					reason: 'NOT_EXPLORING',
					message: '当前不在探索模式',
				};
			}

			if (activeSudoku.getInvalidCells().length > 0) {
				rememberRecentExploreFailure();
				setExploreNotice('EXPLORE_FAILED', '探索失败：当前局面出现冲突');
				return {
					ok: false,
					reason: 'EXPLORE_FAILED',
					message: '探索失败：当前局面出现冲突',
					row,
					col,
				};
			}

			if (detectRememberedExploreFailure()) {
				return {
					ok: false,
					reason: 'EXPLORE_FAILED_MEMORY',
					message: '该局面曾经导致失败，请尝试其他探索路径',
					row,
					col,
				};
			}

			if (isMissingPosition(row, col)) {
				return {
					ok: false,
					reason: 'NO_CELL_SELECTED',
					message: '请先选择一个格子',
				};
			}

			if (isInvalidPosition(row, col)) {
				return {
					ok: false,
					reason: 'INVALID_POSITION',
					message: '选择的格子位置不合法',
				};
			}

			if (activeSudoku.getGrid()[row][col] !== 0) {
				return {
					ok: false,
					reason: 'CELL_FILLED',
					message: '该格子已经有数字，无需查看候选数',
					row,
					col,
				};
			}

			const candidates = activeSudoku.getCandidates(row, col);

			if (candidates.length === 0) {
				rememberRecentExploreFailure();
				setExploreNotice('EXPLORE_FAILED', '探索失败：当前格子没有可用候选数');
				return {
					ok: false,
					reason: 'EXPLORE_FAILED',
					message: '探索失败：当前格子没有可用候选数',
					row,
					col,
				};
			}

			return {
				ok: true,
				row,
				col,
				candidates,
				message: '探索模式候选数如下',
			};
		},

		consumeExploreNotice() {
			const notice = exploreNotice;
			exploreNotice = null;
			return notice;
		},

		toJSON() {
			return {
				sudoku: getCurrentSnapshot(),
				undoStack: cloneHistory(undoHistory),
				redoStack: cloneHistory(redoHistory),
			};
		},

		toString() {
			return [
				'Game State:',
				activeSudoku.toString(),
				`undo=${undoHistory.length}, redo=${redoHistory.length}`,
			].join('\n');
		},
	};
}

/**
 * 从序列化数据恢复 Game 会话。
 *
 * @param {Object} json
 * @param {{ grid: number[][], fixed?: boolean[][] }} json.sudoku
 * @param {Array<{ grid: number[][], fixed?: boolean[][] }>} [json.undoStack]
 * @param {Array<{ grid: number[][], fixed?: boolean[][] }>} [json.redoStack]
 * @returns {GameObject}
 * @throws {TypeError} 当序列化会话不合法时抛出。
 */
export function createGameFromJSON(json) {
	if (!json || typeof json !== 'object') {
		throw new TypeError('Game JSON must be an object.');
	}

	return createGame({
		sudoku: createSudokuFromJSON(json.sudoku),
		undoStack: json.undoStack === undefined ? [] : json.undoStack,
		redoStack: json.redoStack === undefined ? [] : json.redoStack,
	});
}
