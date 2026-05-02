<script>
	import { fade } from 'svelte/transition';
	import game from '@sudoku/game';
	import { canRedo, canUndo, isExploring } from '@sudoku/stores/grid';
	import { candidateHint } from '@sudoku/stores/candidateHint';
	import { cursor } from '@sudoku/stores/cursor';
	import { nextStepHint } from '@sudoku/stores/nextStepHint';
	import { notes } from '@sudoku/stores/notes';
	import { gamePaused } from '@sudoku/stores/game';
	import { modal } from '@sudoku/stores/modal';

	/**
	 * 功能：展示领域对象产生的探索模式提示。
	 * 上下文：Undo 到探索起点需要弹窗确认，其余探索失败提示复用候选提示浮层。
	 *
	 * @param {{ reason: string, message: string }|null} notice - 探索提示
	 */
	function handleExploreNotice(notice) {
		if (!notice) {
			return;
		}

		if (notice.reason === 'EXPLORE_AT_START') {
			modal.show('explore', { mode: 'at-start', notice });
			return;
		}

		candidateHint.show({
			ok: false,
			reason: notice.reason,
			message: notice.message,
			row: $cursor.y,
			col: $cursor.x,
		}, $cursor);
	}

	function handleHint() {
		const result = game.getCandidateHint($cursor.y, $cursor.x);
		candidateHint.show(result, $cursor);
	}

	function handleNextStepHint() {
		const result = game.applyNextStepHint();

		if (result.ok) {
			candidateHint.hide();
			nextStepHint.show(result);
			return;
		}

		if (result.reason === 'NO_NEXT_STEP') {
			nextStepHint.clear();
			modal.show('explore', { mode: $isExploring ? 'status' : 'start' });
			return;
		}

		nextStepHint.clear();
		candidateHint.show(result, $cursor);
	}

	function handleUndo() {
		nextStepHint.clear();
		game.undo();
		handleExploreNotice(game.consumeExploreNotice());
	}

	function handleRedo() {
		nextStepHint.clear();
		game.redo();
		handleExploreNotice(game.consumeExploreNotice());
	}

	function handleExploreStatus() {
		modal.show('explore', { mode: 'status' });
	}
</script>

<div class="action-buttons space-x-3">

	<button class="btn btn-round" disabled={$gamePaused || !$canUndo} title="Undo" on:click={handleUndo}>
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
		</svg>
	</button>

	<button class="btn btn-round" disabled={$gamePaused || !$canRedo} title="Redo" on:click={handleRedo}>
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 90 00-8 8v2M21 10l-6 6m6-6l-6-6" />
		</svg>
	</button>

	<button class="btn btn-round" disabled={$gamePaused} on:click={handleHint} title="候选提示">
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
		</svg>
	</button>

	<button class="btn btn-round" disabled={$gamePaused} on:click={handleNextStepHint} title="下一步提示">
		<span class="next-step-icon">1</span>
	</button>

	{#if $isExploring}
		<button class="btn btn-round" disabled={$gamePaused} on:click={handleExploreStatus} title="探索模式">
			<span class="next-step-icon">探</span>
		</button>
	{/if}

	<button class="btn btn-round btn-badge" on:click={notes.toggle} title="Notes ({$notes ? 'ON' : 'OFF'})">
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
		</svg>

		<span class="badge tracking-tighter" class:badge-primary={$notes}>{$notes ? 'ON' : 'OFF'}</span>
	</button>

</div>

{#if $candidateHint.visible && $candidateHint.row === null && $candidateHint.col === null}
	<div class="hint-message" transition:fade={{ duration: 900 }}>
		{$candidateHint.message}
	</div>
{/if}


<style>
	.action-buttons {
		@apply flex flex-wrap justify-evenly self-end;
	}

	.btn-badge {
		@apply relative;
	}

	.badge {
		min-height: 20px;
		min-width:  20px;
		@apply p-1 rounded-full leading-none text-center text-xs text-white bg-gray-600 inline-block absolute top-0 left-0;
	}

	.badge-primary {
		@apply bg-primary;
	}

	.hint-message {
		@apply mt-3 px-3 py-2 rounded-lg bg-white text-sm text-gray-800 shadow text-center;
	}

	.next-step-icon {
		@apply font-bold text-lg leading-none;
	}
</style>
