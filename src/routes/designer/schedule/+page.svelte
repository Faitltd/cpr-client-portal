<script lang="ts">
	import ScheduleView from '$lib/components/ScheduleView.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<title>Schedule · Designer · CPR Portal</title>
</svelte:head>

<h1 class="title">Schedule</h1>

<ScheduleView
	weekDays={data.weekDays}
	people={data.people}
	allPeople={data.allPeople}
	shifts={data.shifts}
	weekStart={data.weekStart}
	weekLabel={data.weekLabel}
	prevWeek={data.prevWeek}
	nextWeek={data.nextWeek}
	thisWeek={data.thisWeek}
	personFilter={data.personFilter}
/>

<style>
	.title {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}
</style>
