<script>
	import Candidates from './Candidates.svelte';
	import { fade } from 'svelte/transition';
	import { SUDOKU_SIZE } from '@sudoku/constants';
	import { cursor } from '@sudoku/stores/cursor';
	import { nextStepHint } from '@sudoku/stores/nextStepHint';

	export let value;
	export let cellX;
	export let cellY;
	export let candidates;
	export let candidateHint;

	export let disabled;
	export let conflictingNumber;
	export let userNumber;
	export let selected;
	export let sameArea;
	export let sameNumber;
	export let nextStepNumber;

	const borderRight = (cellX !== SUDOKU_SIZE && cellX % 3 !== 0);
	const borderRightBold = (cellX !== SUDOKU_SIZE && cellX % 3 === 0);
	const borderBottom = (cellY !== SUDOKU_SIZE && cellY % 3 !== 0);
	const borderBottomBold = (cellY !== SUDOKU_SIZE && cellY % 3 === 0);

	function handleCellClick() {
		nextStepHint.clear();
		cursor.set(cellX - 1, cellY - 1);
	}
</script>

<div class="cell row-start-{cellY} col-start-{cellX}"
     class:hint-active={candidateHint && candidateHint.visible && candidateHint.row === cellY - 1 && candidateHint.col === cellX - 1}
     class:border-r={borderRight}
     class:border-r-4={borderRightBold}
     class:border-b={borderBottom}
     class:border-b-4={borderBottomBold}>

	{#if !disabled}
		<div class="cell-inner"
		     class:user-number={userNumber}
		     class:selected={selected}
		     class:same-area={sameArea}
		     class:same-number={sameNumber}
		     class:conflicting-number={conflictingNumber}
		     class:next-step-number={nextStepNumber}>

			<button class="cell-btn" on:click={handleCellClick}>
				{#if candidates}
					<Candidates {candidates} />
				{:else}
					<span class="cell-text">{value || ''}</span>
				{/if}
			</button>

			{#if candidateHint && candidateHint.visible && candidateHint.row === cellY - 1 && candidateHint.col === cellX - 1}
				<div class="candidate-hint" transition:fade={{ duration: 900 }}>
					<div class="candidate-hint-title">{candidateHint.message}</div>
					{#if candidateHint.ok}
						<div class="candidate-hint-values">
							{candidateHint.candidates.join('、')}
						</div>
					{/if}
				</div>
			{/if}

		</div>
	{/if}

</div>

<style>
	.cell {
		@apply relative h-full w-full row-end-auto col-end-auto;
	}

	.hint-active {
		z-index: 60;
	}

	.cell-inner {
		@apply relative h-full w-full text-gray-800;
	}

	.cell-btn {
		@apply absolute inset-0 h-full w-full;
	}

	.cell-btn:focus {
		@apply outline-none;
	}

	.cell-text {
		@apply leading-full text-base;
	}

	@media (min-width: 300px) {
		.cell-text {
			@apply text-lg;
		}
	}

	@media (min-width: 350px) {
		.cell-text {
			@apply text-xl;
		}
	}

	@media (min-width: 400px) {
		.cell-text {
			@apply text-2xl;
		}
	}

	@media (min-width: 500px) {
		.cell-text {
			@apply text-3xl;
		}
	}

	@media (min-width: 600px) {
		.cell-text {
			@apply text-4xl;
		}
	}

	.user-number {
		@apply text-primary;
	}

	.selected {
		@apply bg-primary text-white;
	}

	.same-area {
		@apply bg-primary-lighter;
	}

	.same-number {
		@apply bg-primary-light;
	}

	.conflicting-number {
		@apply text-red-600;
	}

	.next-step-number {
		@apply text-green-600;
	}

	.candidate-hint {
		@apply absolute px-2 py-1 rounded-lg bg-white text-gray-800 shadow-lg text-xs pointer-events-none;
		z-index: 70;
		left: 50%;
		top: 0;
		transform: translate(-50%, -85%);
		white-space: nowrap;
	}

	.candidate-hint-title {
		@apply font-semibold;
	}

	.candidate-hint-values {
		@apply mt-1 text-primary;
	}
</style>
