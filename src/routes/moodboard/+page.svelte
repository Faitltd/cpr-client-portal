<script lang="ts">
	import { onMount } from 'svelte';

	onMount(async () => {
		const [{ initMoodboard }, res] = await Promise.all([
			import('$lib/moodboard/moodboard.js'),
			fetch('/moodboard/data.json')
		]);
		const DATA = await res.json();
		initMoodboard(DATA);
	});
</script>

<svelte:head>
	<title>Kitchen Mood Board Map</title>
	<link rel="stylesheet" href="/moodboard/moodboard.css" />
</svelte:head>

<div class="bar">
  <div class="brand"><span class="mark"></span><span class="t">Kitchen Mood Board Map</span></div>
  <div class="sp"></div>
  <label class="search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input id="q" type="text" placeholder="Search styles..." autocomplete="off" spellcheck="false">
  </label>
  <button class="iconbtn" id="favBtn" title="Favorites" aria-label="Favorites">
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
    <span class="badge" id="favCount" hidden>0</span>
  </button>
  <button class="iconbtn" id="theme" title="Toggle theme" aria-label="Toggle theme">
    <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>
  </button>
</div>

<div class="crumbs" id="crumbs"></div>
<div id="stage"></div>

<div class="lb" id="lb">
  <div class="lb-card">
    <div class="lb-head">
      <span class="lb-sw" id="lbSw"></span>
      <span class="lh" id="lbTitle"></span>
      <span class="lm" id="lbPage"></span>
      <button class="navbtn x" id="lbFav" aria-label="Save to favorites" aria-pressed="false"></button>
      <a class="navbtn x" id="lbDownload" href="#" aria-label="Download image" download>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></svg>
      </a>
      <button class="navbtn x" id="lbClose" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="lb-img" id="lbImgWrap"><img id="lbImg" alt="Mood board"></div>
    <div class="lb-notes" hidden>
      <textarea id="lbNote" rows="2" placeholder="What do you like about this board?"></textarea>
    </div>
    <div class="lb-foot">
      <button class="navbtn" id="lbPrev"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> Prev</button>
      <span class="count-chip" id="lbCount"></span>
      <span class="sp"></span>
      <button class="navbtn" id="lbNext">Next <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
  </div>
</div>
