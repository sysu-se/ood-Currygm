<script>
	import game from '@sudoku/game';
	import { exploreStatus } from '@sudoku/stores/grid';

	export let data = {};
	export let hideModal;

	$: mode = data.mode || 'status';
	$: notice = data.notice || null;

	/**
	 * 功能：进入探索模式并关闭弹窗。
	 * 上下文：当前局面没有唯一候选数时，用户通过此按钮开始探索分支。
	 */
	function handleStartExplore() {
		game.startExplore();
		hideModal();
	}

	/**
	 * 功能：回到探索起点但保留探索 history。
	 * 上下文：用户可以先回到主局面观察，再通过 Undo 回到探索分支末端。
	 */
	function handleReturnToStart() {
		game.returnToExploreStart();
		hideModal();
	}

	/**
	 * 功能：退出探索模式并把当前探索 history 合并到主模式。
	 * 上下文：用户确认采用当前探索状态时调用，回到普通模式后仍可 Undo/Redo 探索路径。
	 */
	function handleExitExplore() {
		game.exitExplore();
		hideModal();
	}
</script>

{#if mode === 'start'}
	<h1 class="text-3xl font-semibold mb-5 leading-none">进入探索模式</h1>
	<p class="text-lg mb-5">当前没有可直接确定的下一步，是否进入探索模式尝试候选数？</p>

	<div class="flex justify-end">
		<button class="btn btn-small mr-3" on:click={hideModal}>暂不进入</button>
		<button class="btn btn-small btn-primary" on:click={handleStartExplore}>进入探索</button>
	</div>
{:else if mode === 'at-start'}
	<h1 class="text-3xl font-semibold mb-5 leading-none">探索起点</h1>
	<p class="text-lg mb-5">{notice ? notice.message : '已回到探索模式开始前的局面，是否退出并合并探索历史？'}</p>

	<div class="flex justify-end">
		<button class="btn btn-small mr-3" on:click={hideModal}>继续探索</button>
		<button class="btn btn-small btn-primary" on:click={handleExitExplore}>退出并合并</button>
	</div>
{:else}
	<h1 class="text-3xl font-semibold mb-5 leading-none">探索模式</h1>
	<p class="text-lg mb-3">当前正在探索分支中。</p>
	<p class="text-sm text-gray-700 mb-5">
		探索步数：{$exploreStatus.active ? $exploreStatus.index : 0} / {$exploreStatus.active ? Math.max($exploreStatus.length - 1, 0) : 0}
	</p>

	<div class="flex flex-wrap justify-end gap-3">
		<button class="btn btn-small" on:click={hideModal}>关闭</button>
		<button class="btn btn-small" on:click={handleReturnToStart}>回到起点</button>
		<button class="btn btn-small btn-primary" on:click={handleExitExplore}>退出并合并</button>
	</div>
{/if}
