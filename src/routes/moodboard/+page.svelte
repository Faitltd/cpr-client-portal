<script lang="ts">
	import { onMount } from 'svelte';

	const SUPA_URL = 'https://dhjbpebtjtdicevnkjpd.supabase.co';
	const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoamJwZWJ0anRkaWNldm5ranBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNDE5MDYsImV4cCI6MjA4NTYxNzkwNn0.p9D-N4C8Hpqe5mdD7cHB3VHCZ746spywLP7a3ciuqVo';

	// Regroup each color by its saved countertop tags (Wood / Dark / Light).
	// Colors with no tags keep their original style groups.
	function regroup(DATA: any, tags: Record<string, string>) {
		for (const c of DATA.colors) {
			const boards = c.styles.flatMap((st: any) => st.boards);
			if (!boards.some((b: any) => tags[b.id])) continue;
			const order = (b: any) => b.src * 10 + (b.tag === 'A' ? 0 : 1);
			const bk: Record<string, any[]> = { wood: [], dark: [], light: [], more: [] };
			for (const b of boards) (bk[tags[b.id]] ?? bk.more).push(b);
			const groups: any[] = [];
			const add = (k: string, label: string) => {
				if (bk[k].length) groups.push({ name: label, boards: bk[k].sort((a: any, b: any) => order(a) - order(b)) });
			};
			add('wood', c.name + ' + Wood');
			add('dark', c.name + ' + Dark');
			add('light', c.name + ' + Light');
			add('more', c.name + ' + Unsorted');
			c.styles = groups;
			c.count = boards.length;
		}
		return DATA;
	}

	onMount(async () => {
		const [{ initMoodboard }, res, tagRes] = await Promise.all([
			import('$lib/moodboard/moodboard.js'),
			fetch('/moodboard/data.json'),
			fetch(SUPA_URL + '/rest/v1/moodboard_board_tags?select=board_id,counter', {
				headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON }
			}).catch(() => null)
		]);
		const DATA = await res.json();
		const tags: Record<string, string> = {};
		try {
			if (tagRes && tagRes.ok) for (const r of await tagRes.json()) tags[r.board_id] = r.counter;
		} catch (e) {}
		initMoodboard(regroup(DATA, tags));
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
    <div class="lb-notes">
      <textarea id="lbNote" rows="2" placeholder="Add a note — what do you like about this board? (saved on this device)"></textarea>
    </div>
    <div class="lb-foot">
      <button class="navbtn" id="lbPrev"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> Prev</button>
      <span class="count-chip" id="lbCount"></span>
      <span class="sp"></span>
      <button class="navbtn" id="lbNext">Next <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
  </div>
</div>
