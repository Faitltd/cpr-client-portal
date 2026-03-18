<script lang="ts">
	import DealSelector from '$lib/components/DealSelector.svelte';

	// ── Data types ─────────────────────────────────────────────────
	interface Approval {
		id: string; title: string; category: string; priority: string;
		assigned_to: string; status: string; due_date: string | null; created_at: string;
		description: string | null;
	}
	interface ChangeOrder {
		id: string; title: string; status: string; estimated_amount: number | null;
		approved_amount: number | null; identified_by: string | null; identified_at: string;
		description: string | null;
	}
	interface DailyLog {
		id: string; log_date: string; hours_worked: number | null; trade_partner_id: string | null;
		work_completed: string | null; work_planned: string | null;
		issues_encountered: string | null; weather_delay: boolean;
	}
	interface CommsEntry {
		id: string; channel: string; direction: string; subject: string | null;
		summary: string | null; contacted_by: string | null; sla_target_hours: number; created_at: string;
	}
	interface FieldIssue {
		id: string; title: string; severity: string; issue_type: string;
		status: string; description: string | null; created_at: string;
	}
	interface ProcurementItem {
		id: string; item_name: string; status: string; category: string | null;
		vendor: string | null; cost: number | null; expected_date: string | null;
	}

	// ── State ───────────────────────────────────────────────────────
	let dealId = '';

	let open = {
		approvals: true,
		changeOrders: true,
		dailyLogs: true,
		comms: true,
		fieldIssues: true,
		procurement: true
	};

	let approvals: Approval[] = [];
	let changeOrders: ChangeOrder[] = [];
	let dailyLogs: DailyLog[] = [];
	let comms: CommsEntry[] = [];
	let fieldIssues: FieldIssue[] = [];
	let procurement: ProcurementItem[] = [];

	let loading = {
		approvals: false, changeOrders: false, dailyLogs: false,
		comms: false, fieldIssues: false, procurement: false
	};
	let errors: Record<string, string> = {};

	// ── Derived counts ──────────────────────────────────────────────
	$: pendingApprovals = approvals.filter(a => a.status === 'pending').length;
	$: openIssues = fieldIssues.filter(i => i.status === 'open').length;
	$: totalHours = dailyLogs.reduce((s, l) => s + (l.hours_worked ?? 0), 0);

	// ── Event handler ───────────────────────────────────────────────
	function handleSelect(e: CustomEvent<{ id: string; label: string }>) {
		dealId = e.detail.id;
		if (!dealId) return;
		fetchApprovals();
		fetchChangeOrders();
		fetchDailyLogs();
		fetchComms();
		fetchFieldIssues();
		fetchProcurement();
	}

	// ── Fetch helpers ───────────────────────────────────────────────
	async function fetchApprovals() {
		loading.approvals = true; errors.approvals = '';
		try {
			const r = await fetch(`/api/admin/approvals?dealId=${encodeURIComponent(dealId)}`);
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Failed');
			approvals = j.data ?? [];
		} catch (e) { errors.approvals = e instanceof Error ? e.message : 'Failed'; }
		finally { loading.approvals = false; }
	}

	async function fetchChangeOrders() {
		loading.changeOrders = true; errors.changeOrders = '';
		try {
			const r = await fetch(`/api/admin/change-orders?dealId=${encodeURIComponent(dealId)}`);
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Failed');
			changeOrders = Array.isArray(j.data) ? j.data : [];
		} catch (e) { errors.changeOrders = e instanceof Error ? e.message : 'Failed'; }
		finally { loading.changeOrders = false; }
	}

	async function fetchDailyLogs() {
		loading.dailyLogs = true; errors.dailyLogs = '';
		try {
			const r = await fetch(`/api/admin/daily-logs?dealId=${encodeURIComponent(dealId)}`);
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Failed');
			dailyLogs = j.data ?? [];
		} catch (e) { errors.dailyLogs = e instanceof Error ? e.message : 'Failed'; }
		finally { loading.dailyLogs = false; }
	}

	async function fetchComms() {
		loading.comms = true; errors.comms = '';
		try {
			const r = await fetch(`/api/admin/comms?dealId=${encodeURIComponent(dealId)}`);
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Failed');
			comms = j.data ?? [];
		} catch (e) { errors.comms = e instanceof Error ? e.message : 'Failed'; }
		finally { loading.comms = false; }
	}

	async function fetchFieldIssues() {
		loading.fieldIssues = true; errors.fieldIssues = '';
		try {
			const r = await fetch(`/api/admin/field-issues?dealId=${encodeURIComponent(dealId)}`);
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.message || 'Failed');
			fieldIssues = Array.isArray(j.data) ? j.data : [];
		} catch (e) { errors.fieldIssues = e instanceof Error ? e.message : 'Failed'; }
		finally { loading.fieldIssues = false; }
	}

	async function fetchProcurement() {
		loading.procurement = true; errors.procurement = '';
		try {
			const r = await fetch(`/api/admin/procurement?dealId=${encodeURIComponent(dealId)}`);
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.message || 'Failed');
			procurement = Array.isArray(j.data) ? j.data : [];
		} catch (e) { errors.procurement = e instanceof Error ? e.message : 'Failed'; }
		finally { loading.procurement = false; }
	}

	// ── Formatters ──────────────────────────────────────────────────
	function fmtDate(v: string | null | undefined) {
		if (!v) return '—';
		const [y, m, d] = v.split('T')[0].split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
	function fmtDateTime(v: string | null) {
		if (!v) return '—';
		const d = new Date(v);
		return isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}
	function fmtCurrency(v: number | null) {
		if (v === null || v === undefined) return '—';
		return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
	}
	function trunc(v: string | null, n = 120) {
		if (!v) return '';
		return v.length > n ? v.slice(0, n) + '…' : v;
	}

	// ── Badge helpers ───────────────────────────────────────────────
	const PRIORITY_COLOR: Record<string, string> = {
		urgent: '#dc2626', high: '#d97706', normal: '#6b7280', low: '#2563eb'
	};
	const SEVERITY_COLOR: Record<string, string> = {
		critical: '#dc2626', high: '#d97706', medium: '#6b7280', low: '#2563eb'
	};
	const STATUS_BG: Record<string, string> = {
		pending: '#fef3c7', approved: '#d1fae5', rejected: '#fee2e2', deferred: '#e0e7ff',
		identified: '#fef3c7', scoped: '#ede9fe', sent: '#dbeafe', billed: '#dcfce7',
		open: '#fef3c7', acknowledged: '#dbeafe', resolved: '#d1fae5',
		needed: '#f3f4f6', ordered: '#ede9fe', shipped: '#fef3c7', delivered: '#d1fae5',
		delayed: '#fee2e2', damaged: '#fce7f3', installed: '#d1fae5'
	};
	const STATUS_COLOR: Record<string, string> = {
		pending: '#92400e', approved: '#065f46', rejected: '#991b1b', deferred: '#3730a3',
		identified: '#92400e', scoped: '#5b21b6', sent: '#1e40af', billed: '#065f46',
		open: '#92400e', acknowledged: '#1e40af', resolved: '#065f46',
		needed: '#374151', ordered: '#5b21b6', shipped: '#92400e', delivered: '#065f46',
		delayed: '#991b1b', damaged: '#9d174d', installed: '#065f46'
	};

	const CHANNEL_EMOJI: Record<string, string> = {
		email: '📧', phone: '📞', text: '💬', portal: '🌐', in_person: '🤝'
	};

	function logGroups(logs: DailyLog[]) {
		const map = new Map<string, DailyLog[]>();
		for (const l of logs) {
			if (!map.has(l.log_date)) map.set(l.log_date, []);
			map.get(l.log_date)!.push(l);
		}
		return Array.from(map.entries())
			.sort((a, b) => b[0].localeCompare(a[0]))
			.map(([date, items]) => ({ date, label: fmtDate(date), items }));
	}

	const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
	function issuesBySeverity(issues: FieldIssue[]) {
		return SEVERITY_ORDER
			.map(sev => ({ sev, items: issues.filter(i => i.severity === sev) }))
			.filter(g => g.items.length > 0);
	}
</script>

<div class="container">
	<div class="page-header">
		<h1>Admin Dashboard</h1>
	</div>

	<DealSelector on:select={handleSelect} />

	{#if !dealId}
		<div class="empty-state">
			<p>Select a deal above to load project data.</p>
		</div>
	{:else}

		<!-- ── Approvals ─────────────────────────────────────── -->
		<div class="section-card">
			<div class="section-head">
				<button class="toggle-btn" on:click={() => (open.approvals = !open.approvals)}>
					<span class="chevron" class:down={open.approvals}>▸</span>
					<span class="section-title">Approvals</span>
					{#if pendingApprovals > 0}
						<span class="count-badge warn">{pendingApprovals} pending</span>
					{:else if approvals.length > 0}
						<span class="count-badge">{approvals.length}</span>
					{/if}
				</button>
				<a class="manage-link" href="/admin/approvals">Manage →</a>
			</div>

			{#if open.approvals}
				<div class="section-body">
					{#if loading.approvals}
						<p class="muted">Loading…</p>
					{:else if errors.approvals}
						<p class="error-text">{errors.approvals}</p>
					{:else if approvals.length === 0}
						<p class="muted">No approvals for this deal.</p>
					{:else}
						<div class="item-list">
							{#each approvals as a (a.id)}
								<div class="item-row">
									<div class="item-main">
										<span class="item-title">{a.title}</span>
										{#if a.description}<p class="item-desc">{trunc(a.description)}</p>{/if}
									</div>
									<div class="item-meta">
										<span class="badge" style="background:{STATUS_BG[a.status]};color:{STATUS_COLOR[a.status]}">{a.status}</span>
										<span class="badge" style="color:{PRIORITY_COLOR[a.priority]};background:#f9fafb">{a.priority}</span>
										{#if a.due_date}<span class="meta-text">Due {fmtDate(a.due_date)}</span>{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── Change Orders ─────────────────────────────────── -->
		<div class="section-card">
			<div class="section-head">
				<button class="toggle-btn" on:click={() => (open.changeOrders = !open.changeOrders)}>
					<span class="chevron" class:down={open.changeOrders}>▸</span>
					<span class="section-title">Change Orders</span>
					{#if changeOrders.length > 0}
						<span class="count-badge">{changeOrders.length}</span>
					{/if}
				</button>
				<a class="manage-link" href="/admin/change-orders">Manage →</a>
			</div>

			{#if open.changeOrders}
				<div class="section-body">
					{#if loading.changeOrders}
						<p class="muted">Loading…</p>
					{:else if errors.changeOrders}
						<p class="error-text">{errors.changeOrders}</p>
					{:else if changeOrders.length === 0}
						<p class="muted">No change orders for this deal.</p>
					{:else}
						{@const totalEst = changeOrders.reduce((s, o) => s + (o.estimated_amount ?? 0), 0)}
						{@const totalApp = changeOrders.filter(o => o.status === 'approved' || o.status === 'billed').reduce((s, o) => s + (o.approved_amount ?? 0), 0)}
						<div class="mini-stats">
							<div class="mini-stat"><span>{changeOrders.length}</span><span class="stat-label">Orders</span></div>
							<div class="mini-stat"><span>{fmtCurrency(totalEst)}</span><span class="stat-label">Estimated</span></div>
							<div class="mini-stat"><span>{fmtCurrency(totalApp)}</span><span class="stat-label">Approved</span></div>
						</div>
						<div class="item-list">
							{#each changeOrders as o (o.id)}
								<div class="item-row">
									<div class="item-main">
										<span class="item-title">{o.title}</span>
										{#if o.description}<p class="item-desc">{trunc(o.description)}</p>{/if}
									</div>
									<div class="item-meta">
										<span class="badge" style="background:{STATUS_BG[o.status]};color:{STATUS_COLOR[o.status]}">{o.status}</span>
										{#if o.estimated_amount != null}<span class="meta-text">{fmtCurrency(o.estimated_amount)}</span>{/if}
										<span class="meta-text muted">{fmtDate(o.identified_at)}</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── Daily Logs ─────────────────────────────────────── -->
		<div class="section-card">
			<div class="section-head">
				<button class="toggle-btn" on:click={() => (open.dailyLogs = !open.dailyLogs)}>
					<span class="chevron" class:down={open.dailyLogs}>▸</span>
					<span class="section-title">Daily Logs</span>
					{#if dailyLogs.length > 0}
						<span class="count-badge">{dailyLogs.length} logs · {totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)} hrs</span>
					{/if}
				</button>
				<a class="manage-link" href="/admin/daily-logs">Manage →</a>
			</div>

			{#if open.dailyLogs}
				<div class="section-body">
					{#if loading.dailyLogs}
						<p class="muted">Loading…</p>
					{:else if errors.dailyLogs}
						<p class="error-text">{errors.dailyLogs}</p>
					{:else if dailyLogs.length === 0}
						<p class="muted">No daily logs for this deal.</p>
					{:else}
						{#each logGroups(dailyLogs) as group}
							<div class="log-group">
								<div class="log-date-label">{group.label}</div>
								{#each group.items as log (log.id)}
									<div class="log-entry">
										<div class="log-tags">
											{#if log.hours_worked != null}<span class="tag">{log.hours_worked} hrs</span>{/if}
											{#if log.weather_delay}<span class="tag warn">🌧 Weather delay</span>{/if}
										</div>
										{#if log.work_completed}<p class="log-line"><span class="log-label">Done:</span> {trunc(log.work_completed)}</p>{/if}
										{#if log.work_planned}<p class="log-line"><span class="log-label">Planned:</span> {trunc(log.work_planned)}</p>{/if}
										{#if log.issues_encountered}<p class="log-line warn-text"><span class="log-label">Issues:</span> {trunc(log.issues_encountered)}</p>{/if}
									</div>
								{/each}
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── Communications ────────────────────────────────── -->
		<div class="section-card">
			<div class="section-head">
				<button class="toggle-btn" on:click={() => (open.comms = !open.comms)}>
					<span class="chevron" class:down={open.comms}>▸</span>
					<span class="section-title">Communications</span>
					{#if comms.length > 0}<span class="count-badge">{comms.length}</span>{/if}
				</button>
				<a class="manage-link" href="/admin/comms">Manage →</a>
			</div>

			{#if open.comms}
				<div class="section-body">
					{#if loading.comms}
						<p class="muted">Loading…</p>
					{:else if errors.comms}
						<p class="error-text">{errors.comms}</p>
					{:else if comms.length === 0}
						<p class="muted">No communications for this deal.</p>
					{:else}
						<div class="item-list">
							{#each comms as c (c.id)}
								<div class="item-row">
									<div class="item-main">
										<span class="item-title">
											{CHANNEL_EMOJI[c.channel] ?? ''} {c.subject || '(no subject)'}
										</span>
										{#if c.summary}<p class="item-desc">{trunc(c.summary)}</p>{/if}
									</div>
									<div class="item-meta">
										<span class="badge" style="background:{c.direction === 'outbound' ? '#d1fae5' : '#dbeafe'};color:{c.direction === 'outbound' ? '#065f46' : '#1e40af'}">{c.direction}</span>
										{#if c.contacted_by}<span class="meta-text">{c.contacted_by}</span>{/if}
										<span class="meta-text muted">{fmtDateTime(c.created_at)}</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── Field Issues ───────────────────────────────────── -->
		<div class="section-card">
			<div class="section-head">
				<button class="toggle-btn" on:click={() => (open.fieldIssues = !open.fieldIssues)}>
					<span class="chevron" class:down={open.fieldIssues}>▸</span>
					<span class="section-title">Field Issues</span>
					{#if openIssues > 0}
						<span class="count-badge warn">{openIssues} open</span>
					{:else if fieldIssues.length > 0}
						<span class="count-badge">{fieldIssues.length}</span>
					{/if}
				</button>
				<a class="manage-link" href="/admin/field-issues">Manage →</a>
			</div>

			{#if open.fieldIssues}
				<div class="section-body">
					{#if loading.fieldIssues}
						<p class="muted">Loading…</p>
					{:else if errors.fieldIssues}
						<p class="error-text">{errors.fieldIssues}</p>
					{:else if fieldIssues.length === 0}
						<p class="muted">No field issues for this deal.</p>
					{:else}
						{#each issuesBySeverity(fieldIssues) as group}
							<div class="issue-group">
								<div class="issue-severity-label" style="color:{SEVERITY_COLOR[group.sev]}">{group.sev.toUpperCase()}</div>
								{#each group.items as issue (issue.id)}
									<div class="item-row">
										<div class="item-main">
											<span class="item-title">{issue.title}</span>
											{#if issue.description}<p class="item-desc">{trunc(issue.description)}</p>{/if}
										</div>
										<div class="item-meta">
											<span class="badge" style="background:{STATUS_BG[issue.status]};color:{STATUS_COLOR[issue.status]}">{issue.status}</span>
											<span class="meta-text muted">{fmtDateTime(issue.created_at)}</span>
										</div>
									</div>
								{/each}
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── Procurement ────────────────────────────────────── -->
		<div class="section-card">
			<div class="section-head">
				<button class="toggle-btn" on:click={() => (open.procurement = !open.procurement)}>
					<span class="chevron" class:down={open.procurement}>▸</span>
					<span class="section-title">Procurement</span>
					{#if procurement.length > 0}<span class="count-badge">{procurement.length} items</span>{/if}
				</button>
				<a class="manage-link" href="/admin/procurement">Manage →</a>
			</div>

			{#if open.procurement}
				<div class="section-body">
					{#if loading.procurement}
						<p class="muted">Loading…</p>
					{:else if errors.procurement}
						<p class="error-text">{errors.procurement}</p>
					{:else if procurement.length === 0}
						<p class="muted">No procurement items for this deal.</p>
					{:else}
						<div class="item-list">
							{#each procurement as item (item.id)}
								<div class="item-row">
									<div class="item-main">
										<span class="item-title">{item.item_name}</span>
										{#if item.vendor || item.category}
											<p class="item-desc">{[item.category, item.vendor].filter(Boolean).join(' · ')}</p>
										{/if}
									</div>
									<div class="item-meta">
										<span class="badge" style="background:{STATUS_BG[item.status]};color:{STATUS_COLOR[item.status]}">{item.status}</span>
										{#if item.cost != null}<span class="meta-text">{fmtCurrency(item.cost)}</span>{/if}
										{#if item.expected_date}<span class="meta-text muted">Exp. {fmtDate(item.expected_date)}</span>{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

	{/if}
</div>

<style>
	.container {
		max-width: 860px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		color: #111827;
	}

	.empty-state {
		text-align: center;
		padding: 3rem 1rem;
		color: #9ca3af;
		font-size: 0.95rem;
	}

	/* ── Section cards ─────────────────────────────────── */
	.section-card {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		margin-bottom: 0.75rem;
		overflow: hidden;
	}

	.section-head {
		display: flex;
		align-items: center;
		padding: 0 1rem;
		min-height: 52px;
		border-bottom: 1px solid transparent;
		gap: 0.5rem;
	}

	.section-card:has(.section-body) .section-head {
		border-bottom-color: #f3f4f6;
	}

	.toggle-btn {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		font-size: 0.95rem;
		font-weight: 600;
		color: #111827;
		text-align: left;
		min-height: 52px;
	}

	.toggle-btn:hover { color: #0066cc; }

	.chevron {
		font-size: 0.75rem;
		color: #9ca3af;
		transition: transform 0.15s;
		display: inline-block;
	}
	.chevron.down { transform: rotate(90deg); }

	.section-title { font-weight: 600; }

	.count-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 600;
		background: #f3f4f6;
		color: #6b7280;
	}
	.count-badge.warn { background: #fef3c7; color: #92400e; }

	.manage-link {
		font-size: 0.8rem;
		color: #6b7280;
		text-decoration: none;
		white-space: nowrap;
		padding: 0.25rem 0;
	}
	.manage-link:hover { color: #0066cc; }

	.section-body {
		padding: 1rem 1.25rem;
	}

	/* ── Mini stats ────────────────────────────────────── */
	.mini-stats {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.mini-stat {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.mini-stat span {
		font-size: 1.1rem;
		font-weight: 700;
		color: #111827;
	}

	.mini-stat .stat-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9ca3af;
	}

	/* ── Item list ─────────────────────────────────────── */
	.item-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.item-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 0;
		border-bottom: 1px solid #f9fafb;
	}

	.item-row:last-child { border-bottom: none; }

	.item-main {
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #111827;
	}

	.item-desc {
		margin: 0.15rem 0 0;
		font-size: 0.82rem;
		color: #6b7280;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: capitalize;
		white-space: nowrap;
	}

	.meta-text {
		font-size: 0.78rem;
		color: #374151;
		white-space: nowrap;
	}

	.meta-text.muted { color: #9ca3af; }

	/* ── Daily logs ────────────────────────────────────── */
	.log-group {
		margin-bottom: 1rem;
	}

	.log-group:last-child { margin-bottom: 0; }

	.log-date-label {
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #9ca3af;
		margin-bottom: 0.4rem;
	}

	.log-entry {
		padding: 0.6rem 0;
		border-bottom: 1px solid #f9fafb;
	}

	.log-entry:last-child { border-bottom: none; }

	.log-tags {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.35rem;
		flex-wrap: wrap;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #f3f4f6;
		color: #374151;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.tag.warn { background: #fef3c7; color: #92400e; }

	.log-line {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
		color: #374151;
	}

	.log-label {
		font-weight: 600;
		color: #6b7280;
	}

	.warn-text { color: #b45309; }

	/* ── Field issues ──────────────────────────────────── */
	.issue-group { margin-bottom: 0.75rem; }
	.issue-group:last-child { margin-bottom: 0; }

	.issue-severity-label {
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		margin-bottom: 0.25rem;
	}

	/* ── Misc ──────────────────────────────────────────── */
	.muted { color: #9ca3af; font-size: 0.85rem; margin: 0; }
	.error-text { color: #b91c1c; font-size: 0.85rem; margin: 0; }

	@media (max-width: 640px) {
		.container { padding: 1rem; }

		.item-row { flex-direction: column; gap: 0.4rem; }
		.item-meta { justify-content: flex-start; }

		.mini-stats { flex-wrap: wrap; gap: 1rem; }
	}
</style>
