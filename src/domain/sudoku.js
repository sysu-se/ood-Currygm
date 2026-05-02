/**
 * @fileoverview Sudoku 领域对象，负责棋盘状态、固定题面格、输入校验、冲突检测与序列化。
 */

/**
 * @typedef {Object} SudokuObject
 * @property {function(): number[][]} getGrid
 * @property {function(number, number): boolean} isFixedCell
 * @property {function({ row: number, col: number, value: number|null }): boolean} guess
 * @property {function(): SudokuObject} clone
 * @property {function(): Array<{ row: number, col: number }>} getInvalidCells
 * @property {function(number, number): number[]} getCandidates
 * @property {function(): number[][][]} getCandidateGrid
 * @property {function(): { grid: number[][], fixed: boolean[][] }} toJSON
 * @property {function(): string} toString
 */

const BOX_SIZE = 3;
const SUDOKU_SIZE = 9;

function copyGrid(grid) {
	return grid.map(row => row.slice());
}

function copyFixedCells(fixedCells) {
	return fixedCells.map(row => row.slice());
}

/**
 * 将单元格值标准化为内部使用的 0-9 表示。
 *
 * @param {number|null} value
 * @returns {number}
 * @throws {TypeError} 当值不是 0 到 9 之间的整数时抛出。
 */
function normalizeCellValue(value) {
	if (value === null) {
		return 0;
	}

	if (!Number.isInteger(value) || value < 0 || value > 9) {
		throw new TypeError('Sudoku cell values must be integers between 0 and 9.');
	}

	return value;
}

/**
 * 校验并标准化 9x9 数独棋盘。
 *
 * @param {number[][]} input
 * @returns {number[][]}
 * @throws {TypeError} 当棋盘形状或单元格值不合法时抛出。
 */
function normalizeGrid(input) {
	if (!Array.isArray(input) || input.length !== SUDOKU_SIZE) {
		throw new TypeError('Sudoku grid must be a 9x9 array.');
	}

	return input.map((row, rowIndex) => {
		if (!Array.isArray(row) || row.length !== SUDOKU_SIZE) {
			throw new TypeError(`Sudoku row ${rowIndex} must contain 9 cells.`);
		}

		return row.map(normalizeCellValue);
	});
}

function deriveFixedCells(grid) {
	return grid.map(row => row.map(cell => cell !== 0));
}

/**
 * 校验序列化数据中的固定格掩码。
 *
 * @param {boolean[][]} fixedCells
 * @returns {boolean[][]}
 * @throws {TypeError} 当掩码不是 9x9 布尔矩阵时抛出。
 */
function normalizeFixedCells(fixedCells) {
	if (!Array.isArray(fixedCells) || fixedCells.length !== SUDOKU_SIZE) {
		throw new TypeError('Sudoku fixed field must be a 9x9 boolean array.');
	}

	return fixedCells.map((row, rowIndex) => {
		if (!Array.isArray(row) || row.length !== SUDOKU_SIZE) {
			throw new TypeError(`Sudoku fixed row ${rowIndex} must contain 9 cells.`);
		}

		return row.map(cell => {
			if (typeof cell !== 'boolean') {
				throw new TypeError('Sudoku fixed cells must be booleans.');
			}

			return cell;
		});
	});
}

/**
 * 标准化来自 UI 或 API 边界的一次用户输入。
 *
 * @param {Object} move
 * @param {number} move.row
 * @param {number} move.col
 * @param {number|null} move.value
 * @returns {{ row: number, col: number, value: number }}
 * @throws {TypeError|RangeError} 当输入格式或坐标不合法时抛出。
 */
function normalizeMove(move) {
	if (!move || typeof move !== 'object') {
		throw new TypeError('Move must be an object.');
	}

	const { row, col } = move;
	const value = normalizeCellValue(move.value);

	if (!Number.isInteger(row) || row < 0 || row >= SUDOKU_SIZE) {
		throw new RangeError('Move row must be between 0 and 8.');
	}

	if (!Number.isInteger(col) || col < 0 || col >= SUDOKU_SIZE) {
		throw new RangeError('Move col must be between 0 and 8.');
	}

	return { row, col, value };
}

function validatePosition(row, col) {
	if (!Number.isInteger(row) || row < 0 || row >= SUDOKU_SIZE) {
		throw new RangeError('Row must be between 0 and 8.');
	}

	if (!Number.isInteger(col) || col < 0 || col >= SUDOKU_SIZE) {
		throw new RangeError('Col must be between 0 and 8.');
	}
}

function countCellStats(grid) {
	let filled = 0;

	for (const row of grid) {
		for (const cell of row) {
			if (cell !== 0) {
				filled += 1;
			}
		}
	}

	return {
		filled,
		empty: SUDOKU_SIZE * SUDOKU_SIZE - filled,
	};
}

function buildGridString(grid) {
	const { filled, empty } = countCellStats(grid);
	const invalidCount = collectInvalidCells(grid).length;
	const lines = [];

	lines.push(`Sudoku(filled=${filled}, empty=${empty}, invalid=${invalidCount})`);
	lines.push('    0 1 2   3 4 5   6 7 8');

	for (let row = 0; row < SUDOKU_SIZE; row += 1) {
		if (row > 0 && row % BOX_SIZE === 0) {
			lines.push('   ------+-------+------');
		}

		const cells = [];
		for (let col = 0; col < SUDOKU_SIZE; col += 1) {
			if (col > 0 && col % BOX_SIZE === 0) {
				cells.push('|');
			}

			cells.push(grid[row][col] === 0 ? '.' : String(grid[row][col]));
		}

		lines.push(`${row}  ${cells.join(' ')}`);
	}

	return lines.join('\n');
}

/**
 * 查找所有与同行、同列或同宫内其他格子冲突的已填格子。
 *
 * @param {number[][]} grid
 * @returns {Array<{ row: number, col: number }>}
 */
function collectInvalidCells(grid) {
	const invalid = new Set();
	const addInvalid = (row, col) => {
		invalid.add(`${row},${col}`);
	};

	for (let row = 0; row < SUDOKU_SIZE; row += 1) {
		for (let col = 0; col < SUDOKU_SIZE; col += 1) {
			const value = grid[row][col];

			if (value === 0) {
				continue;
			}

			for (let other = 0; other < SUDOKU_SIZE; other += 1) {
				if (other !== col && grid[row][other] === value) {
					addInvalid(row, col);
					addInvalid(row, other);
				}

				if (other !== row && grid[other][col] === value) {
					addInvalid(row, col);
					addInvalid(other, col);
				}
			}

			const startRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
			const startCol = Math.floor(col / BOX_SIZE) * BOX_SIZE;

			for (let boxRow = startRow; boxRow < startRow + BOX_SIZE; boxRow += 1) {
				for (let boxCol = startCol; boxCol < startCol + BOX_SIZE; boxCol += 1) {
					if ((boxRow !== row || boxCol !== col) && grid[boxRow][boxCol] === value) {
						addInvalid(row, col);
						addInvalid(boxRow, boxCol);
					}
				}
			}
		}
	}

	return Array.from(invalid, key => {
		const [row, col] = key.split(',').map(Number);
		return { row, col };
	});
}

/**
 * 判断指定数字是否可以作为某个空格的候选数。
 *
 * @param {number[][]} grid
 * @param {number} row
 * @param {number} col
 * @param {number} value
 * @returns {boolean}
 */
function canUseCandidate(grid, row, col, value) {
	for (let index = 0; index < SUDOKU_SIZE; index += 1) {
		if (grid[row][index] === value || grid[index][col] === value) {
			return false;
		}
	}

	const startRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
	const startCol = Math.floor(col / BOX_SIZE) * BOX_SIZE;

	for (let boxRow = startRow; boxRow < startRow + BOX_SIZE; boxRow += 1) {
		for (let boxCol = startCol; boxCol < startCol + BOX_SIZE; boxCol += 1) {
			if (grid[boxRow][boxCol] === value) {
				return false;
			}
		}
	}

	return true;
}

/**
 * 统计单个空格的候选数集合。
 *
 * @param {number[][]} grid
 * @param {number} row
 * @param {number} col
 * @returns {number[]}
 */
function collectCellCandidates(grid, row, col) {
	if (grid[row][col] !== 0) {
		return [];
	}

	const candidates = [];

	for (let value = 1; value <= SUDOKU_SIZE; value += 1) {
		if (canUseCandidate(grid, row, col, value)) {
			candidates.push(value);
		}
	}

	return candidates;
}

/**
 * 统计当前棋盘每个格子的候选数集合。
 *
 * 注意：此函数只做候选数的机械推导。调用方若要给用户提供提示，
 * 应先结合 collectInvalidCells() 判断当前局面是否存在冲突。
 *
 * @param {number[][]} grid
 * @returns {number[][][]}
 */
function collectCandidateGrid(grid) {
	return grid.map((rowValues, row) => (
		rowValues.map((_, col) => collectCellCandidates(grid, row, col))
	));
}

/**
 * 基于已校验的状态创建 Sudoku 对象。
 *
 * @param {{ grid: number[][], fixedCells: boolean[][] }} state
 * @returns {SudokuObject}
 */
function createSudokuFromState({ grid, fixedCells }) {
	let currentGrid = copyGrid(grid);
	let currentFixedCells = copyFixedCells(fixedCells);

	return {
		getGrid() {
			return copyGrid(currentGrid);
		},

		isFixedCell(row, col) {
			validatePosition(row, col);
			return currentFixedCells[row][col];
		},

		guess(move) {
			const normalizedMove = normalizeMove(move);

			if (currentFixedCells[normalizedMove.row][normalizedMove.col]) {
				throw new Error('Cannot modify a fixed puzzle cell.');
			}

			if (currentGrid[normalizedMove.row][normalizedMove.col] === normalizedMove.value) {
				return false;
			}

			currentGrid[normalizedMove.row][normalizedMove.col] = normalizedMove.value;
			return true;
		},

		clone() {
			return createSudokuFromState({
				grid: currentGrid,
				fixedCells: currentFixedCells,
			});
		},

		getInvalidCells() {
			return collectInvalidCells(currentGrid);
		},

		getCandidates(row, col) {
			validatePosition(row, col);
			return collectCellCandidates(currentGrid, row, col);
		},

		getCandidateGrid() {
			return collectCandidateGrid(currentGrid).map(row => row.map(cell => cell.slice()));
		},

		toJSON() {
			return {
				grid: copyGrid(currentGrid),
				fixed: copyFixedCells(currentFixedCells),
			};
		},

		toString() {
			return buildGridString(currentGrid);
		},
	};
}

/**
 * 根据初始题面创建 Sudoku 领域对象。
 *
 * 输入棋盘中的非零格会被视为固定题面格。
 *
 * @param {number[][]} input
 * @returns {SudokuObject}
 * @throws {TypeError} 当棋盘不合法时抛出。
 */
export function createSudoku(input) {
	const grid = normalizeGrid(input);

	return createSudokuFromState({
		grid,
		fixedCells: deriveFixedCells(grid),
	});
}

/**
 * 从序列化数据恢复 Sudoku 对象。
 *
 * 支持直接传入 9x9 棋盘，也支持 `toJSON()` 生成的 `{ grid, fixed }` 结构。
 *
 * @param {number[][]|{ grid: number[][], fixed?: boolean[][] }} json
 * @returns {SudokuObject}
 * @throws {TypeError} 当序列化数据不合法时抛出。
 */
export function createSudokuFromJSON(json) {
	if (Array.isArray(json)) {
		return createSudoku(json);
	}

	if (!json || typeof json !== 'object' || !Array.isArray(json.grid)) {
		throw new TypeError('Sudoku JSON must contain a grid field.');
	}

	const grid = normalizeGrid(json.grid);
	const fixedCells = json.fixed === undefined
		? deriveFixedCells(grid)
		: normalizeFixedCells(json.fixed);

	return createSudokuFromState({
		grid,
		fixedCells,
	});
}
