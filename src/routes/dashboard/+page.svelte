<script lang="ts">
	import { onMount, tick } from 'svelte';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';
	import ClientChatPanel from '$lib/components/ClientChatPanel.svelte';
	import DailyUpdate from '$lib/components/DailyUpdate.svelte';

	interface EmailPref {
		id: string;
		deal_id: string;
		client_email: string;
		frequency: string;
		enabled: boolean;
	}

	interface EmailTimelineItem {
		id: string;
		deal_id: string;
		date: string;
		direction: 'inbound' | 'outbound';
		subject: string;
		summary: string | null;
		from_name: string | null;
		from_email: string | null;
		to: string[];
	}

	let projects: any[] = [];
	let invoices: any[] = [];
	let loading = true;
	let error = '';
	let invoiceError = '';
	// Only the chatbot section starts expanded.
	let financialOpen = false;
	let invoicesOpen = false;
	let changeOrdersOpen = false;
	let emailUpdatesOpen = false;
	let documentsOpen = false;
	let accountOpen = false;
	let botOpen = true;

	// --- Project Tasks (Zoho Projects) ---
	let tasks: any[] = [];
	let tasksLoading = false;
	let tasksError = '';
	let tasksOpen = false;
	const getTaskName = (t: any) => t?.name ?? t?.task_name ?? 'Untitled task';
	const getTaskStatusLabel = (t: any) => {
		const s = t?.status;
		if (typeof s === 'string') return s;
		if (s && typeof s === 'object' && typeof s.name === 'string') return s.name;
		if (typeof t?.percent_complete === 'string' && t.percent_complete === '100') return 'Complete';
		return 'Open';
	};
	const isTaskComplete = (t: any) => {
		const label = getTaskStatusLabel(t).toLowerCase();
		if (t?.status?.is_closed_type === true) return true;
		return label === 'complete' || label === 'completed' || label === 'closed';
	};
	const loadProjectTasks = async (dealId: string) => {
		if (!dealId) return;
		tasksLoading = true;
		tasksError = '';
		try {
			const res = await fetch(`/api/project/${encodeURIComponent(dealId)}/tasks`);
			if (res.status === 401) {
				tasksError = 'Please sign in again to view tasks.';
				return;
			}
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				tasksError = payload?.error || `Failed to load tasks (${res.status})`;
				return;
			}
			const payload = await res.json();
			tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
		} catch {
			tasksError = 'Failed to load tasks';
		} finally {
			tasksLoading = false;
		}
	};

	// --- Change Order request form ---
	let coPanelOpen = false;
	let coDealId = '';
	let coNote = '';
	let coPhotoUploadRef: PhotoUpload;
	let coSubmitting = false;
	let coSuccess = '';
	let coSubmitError = '';
	let coBooksWarning = '';

	const openChangeOrderPanel = () => {
		coPanelOpen = true;
		coSuccess = '';
		coSubmitError = '';
		coBooksWarning = '';
		if (!coDealId && projects[0]?.id) coDealId = String(projects[0].id);
	};

	const closeChangeOrderPanel = () => {
		coPanelOpen = false;
		coNote = '';
		coPhotoUploadRef?.reset();
		coSubmitError = '';
	};

	const submitChangeOrder = async () => {
		if (!coDealId) {
			coSubmitError = 'Please choose a project.';
			return;
		}
		if (!coNote.trim()) {
			coSubmitError = 'Please describe the change you would like to request.';
			return;
		}
		coSubmitting = true;
		coSubmitError = '';
		coSuccess = '';
		coBooksWarning = '';
		try {
			const photoIds = coPhotoUploadRef?.getPhotoIds() ?? [];
			const res = await fetch('/api/client/change-orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					deal_id: coDealId,
					note: coNote.trim(),
					photo_ids: photoIds.length > 0 ? photoIds : null
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				coSubmitError = payload?.error || `Request failed (${res.status})`;
				return;
			}
			coSuccess = 'Change order request submitted. The office team has been notified.';
			const warningParts: string[] = [];
			if (payload?.data?.books_skipped_reason) {
				warningParts.push(
					payload.data.books_skipped_reason === 'no_customer'
						? 'A draft quote was not auto-created (no Books contact on file).'
						: 'A draft quote was not auto-created.'
				);
			}
			if (payload?.data?.cliq && payload.data.cliq.ok === false) {
				const cliqErr = payload.data.cliq.error || `HTTP ${payload.data.cliq.status ?? '?'}`;
				warningParts.push(`Direct Cliq post failed: ${cliqErr}`);
			}
			if (warningParts.length > 0) {
				coBooksWarning = `Note: ${warningParts.join(' ')} The office will follow up manually.`;
			}
			coNote = '';
			coPhotoUploadRef?.reset();
			coPanelOpen = false;
		} catch (err) {
			coSubmitError = err instanceof Error ? err.message : 'Failed to submit change order';
		} finally {
			coSubmitting = false;
		}
	};

	// Photos
	let photosOpen = false;

	// Contracts / Documents / Access Info
	let contracts: any[] = [];
	let contractsLoading = true;
	let contractError = '';
	let projectDocuments: any[] = [];
	let projectDocumentsLoading = true;
	let clientPortalUrl: string | null = null;

	// WorkDrive Client Portal folder listing — fetched lazily when the
	// Documents section is first opened so the dashboard load stays fast.
	type PortalFile = {
		id: string;
		name: string;
		folder: string | null;
		url: string | null;
		modifiedTime: string | null;
	};
	let portalFiles: PortalFile[] = [];
	let portalFilesLoading = false;
	let portalFilesLoaded = false;
	let portalFilesMessage = '';

	const loadPortalFiles = async () => {
		if (!accessProjectId || portalFilesLoading || portalFilesLoaded) return;
		portalFilesLoading = true;
		portalFilesMessage = '';
		try {
			const res = await fetch(`/api/project/${accessProjectId}/files`);
			const payload = await res.json().catch(() => ({}));
			if (res.ok) {
				portalFiles = Array.isArray(payload?.files) ? payload.files : [];
				portalFilesMessage = payload?.message || '';
				portalFilesLoaded = true;
			} else {
				portalFilesMessage = payload?.message || 'Unable to load documents.';
			}
		} catch {
			portalFilesMessage = 'Unable to load documents.';
		} finally {
			portalFilesLoading = false;
		}
	};

	$: if ((documentsOpen || photosOpen) && accessProjectId && !portalFilesLoaded && !portalFilesLoading) {
		loadPortalFiles();
	}

	// Images belong in the Photos section; everything else stays in Documents.
	const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;
	const isImageFile = (f: PortalFile) =>
		IMAGE_EXT_RE.test(f.name) || (f.mime ?? '').startsWith('image/');
	$: portalDocs = portalFiles.filter((f) => !isImageFile(f));
	$: portalPhotos = portalFiles.filter(isImageFile);

	// CRM file attachments split the same way — images render under Photos.
	const isImageAttachment = (doc: any) => IMAGE_EXT_RE.test(String(doc?.File_Name || ''));
	$: attachmentDocs = projectDocuments.filter((d) => !isImageAttachment(d));
	$: attachmentPhotos = projectDocuments.filter(isImageAttachment);

	$: portalFileGroups = (() => {
		const map = new Map<string, PortalFile[]>();
		for (const f of portalDocs) {
			const key = f.folder ?? '';
			const list = map.get(key) ?? [];
			list.push(f);
			map.set(key, list);
		}
		return Array.from(map.entries()).map(([folder, files]) => ({ folder, files }));
	})();
	let accessProjectId = '';
	let wifiInput = '';
	let doorCodeInput = ''
	let accessMessage = '';
	let accessError = '';
	let accessUpdating = false;
	let accessOpen = false;

	const submitAccessInfo = async () => {
		accessMessage = '';
		accessError = '';
		const wifi = wifiInput.trim();
		const doorCode = doorCodeInput.trim();
		if (!wifi || !doorCode) { accessError = 'WiFi and door code are required.'; return; }
		if (wifi.length > 200) { accessError = 'WiFi must be 200 characters or less.'; return; }
		if (doorCode.length > 100) { accessError = 'Door code must be 100 characters or less.'; return; }
		accessUpdating = true;
		try {
			const res = await fetch(`/api/project/${accessProjectId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ wifi, garageCode: doorCode })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) { accessError = payload?.message || 'Failed to update.'; return; }
			accessMessage = payload?.message || 'Access info updated.';
		} catch { accessError = 'Failed to update access info.'; }
		finally { accessUpdating = false; }
	};

	// Account — password reset
	let pwNew = '';
	let pwConfirm = '';
	let pwMessage = '';
	let pwLoading = false;

	const submitPassword = async () => {
		pwMessage = '';
		if (pwNew.length < 8) { pwMessage = 'Password must be at least 8 characters.'; return; }
		if (pwNew !== pwConfirm) { pwMessage = 'Passwords do not match.'; return; }
		pwLoading = true;
		try {
			const res = await fetch('/account/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: pwNew })
			});
			const payload = await res.json().catch(() => ({}));
			if (res.ok) { pwMessage = payload.message || 'Password updated.'; pwNew = ''; pwConfirm = ''; }
			else { pwMessage = payload.message || 'Unable to update password.'; }
		} catch { pwMessage = 'Unable to update password.'; }
		finally { pwLoading = false; }
	};
	let emailPrefs: EmailPref[] = [];
	let emailPrefsLoading = true;
	let emailTimeline: EmailTimelineItem[] = [];
	let emailTimelineLoading = true;
	let emailTimelineError = '';

	// Per-email expand state + body cache.
	// emailBodies = id → { loading, content, error } where content is sanitized HTML.
	let expandedEmails: Set<string> = new Set();
	let emailBodies = new Map<string, { loading: boolean; content: string | null; error: string | null }>();

	const sanitizeEmailHtml = (raw: string): string => {
		// Lightweight allowlist: strip script/style/iframe tags, drop on* handlers
		// and javascript: URLs. The full body is from Zoho-stored mail which is
		// already moderated, but defense-in-depth — the client portal is the
		// homeowner's surface, not internal staff.
		let html = String(raw);
		html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
		html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, '');
		html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
		html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
		html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
		html = html.replace(/javascript:/gi, 'about:blank#blocked');
		return html;
	};

	const toggleEmailExpand = async (email: EmailTimelineItem) => {
		const id = email.id;
		if (expandedEmails.has(id)) {
			expandedEmails.delete(id);
			expandedEmails = new Set(expandedEmails);
			return;
		}
		expandedEmails.add(id);
		expandedEmails = new Set(expandedEmails);

		const cached = emailBodies.get(id);
		if (cached && (cached.content || cached.error)) return;

		emailBodies.set(id, { loading: true, content: null, error: null });
		emailBodies = new Map(emailBodies);
		try {
			const res = await fetch(
				`/api/client/emails/${encodeURIComponent(id)}?dealId=${encodeURIComponent(email.deal_id || '')}`
			);
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				emailBodies.set(id, {
					loading: false,
					content: null,
					error: payload?.error || `Failed to load email (${res.status})`
				});
				emailBodies = new Map(emailBodies);
				return;
			}
			const payload = await res.json();
			const content = typeof payload?.content === 'string' ? payload.content : null;
			emailBodies.set(id, {
				loading: false,
				content: content ? sanitizeEmailHtml(content) : null,
				error: content ? null : 'Email body unavailable'
			});
			emailBodies = new Map(emailBodies);
		} catch {
			emailBodies.set(id, { loading: false, content: null, error: 'Failed to load email' });
			emailBodies = new Map(emailBodies);
		}
	};
	const getErrorMessage = (payload: any, fallback: string) =>
		payload?.error || payload?.message || fallback;
	const readJson = async (res: Response) => res.json().catch(() => ({}));
	const getProgressPhotosLink = (deal: any) => {
		// Prefer the WD_Photos external share — it points at the Photos folder
		// itself and needs no Zoho login.
		const wdPhotos = deal?.WD_Photos;
		if (typeof wdPhotos === 'string' && /^https?:\/\//i.test(wdPhotos.trim())) {
			return wdPhotos.trim();
		}
		const crmLink = deal?.Client_Portal_Folder || deal?.External_Link;
		if (typeof crmLink === 'string' && /^https?:\/\//i.test(crmLink.trim())) {
			return crmLink.trim();
		}
		const dealId = String(deal?.id || '').trim();
		if (!dealId) return '';
		return `/project/${encodeURIComponent(dealId)}/photos`;
	};
	const getClientPortalUrl = (deal: any): string | null => {
		const link = deal?.Client_Portal_Folder;
		if (typeof link === 'string' && /^https?:\/\//i.test(link.trim())) {
			return link.trim();
		}
		return null;
	};
	const formatInvoiceDate = (invoice: any) => {
		const raw =
			invoice?.invoice_date ??
			invoice?.date ??
			invoice?.created_time ??
			invoice?.created_date ??
			null;
		if (!raw) return '—';
		const parsed = new Date(raw);
		return Number.isNaN(parsed.valueOf()) ? String(raw) : parsed.toLocaleDateString();
	};
	$: invoiceTotals = invoices.reduce(
		(acc, invoice) => {
			const total = Number(invoice?.total || 0);
			const balance = Number(invoice?.balance || 0);
			if (!Number.isNaN(total)) acc.total += total;
			if (!Number.isNaN(balance)) acc.balance += balance;
			return acc;
		},
		{ total: 0, balance: 0 }
	);
	$: amountPaid = Math.max(0, invoiceTotals.total - invoiceTotals.balance);
	// Mirrors the Books quote view: Price (quote total), Invoiced, and
	// Balance = Price minus Invoiced. Falls back to the open-invoice balance
	// when no quotes are on file.
	let quotedTotal = 0;
	$: remainingBalance =
		quotedTotal > 0 ? Math.max(0, quotedTotal - invoiceTotals.total) : invoiceTotals.balance;

	// Change orders pulled from the quote's "Change Order #…" line items.
	type ChangeOrderItem = {
		name: string;
		description: string | null;
		total: number;
		quoteNumber: string | null;
		quoteDate: string | null;
	};
	let changeOrderItems: ChangeOrderItem[] = [];
	$: changeOrders = invoices.filter((invoice) => {
		const number = String(invoice?.invoice_number || invoice?.invoice_id || '').trim();
		return number.toUpperCase().startsWith('CO');
	});
	$: regularInvoices = invoices.filter((invoice) => !changeOrders.includes(invoice));

	const formatRelativeTime = (value: string | null) => {
		if (!value) return 'Recently';
		const timestamp = new Date(value).getTime();
		if (Number.isNaN(timestamp)) return value;

		const diffMs = Date.now() - timestamp;
		const minute = 60 * 1000;
		const hour = 60 * minute;
		const day = 24 * hour;

		if (diffMs < minute) return 'Just now';
		if (diffMs < hour) {
			const minutes = Math.floor(diffMs / minute);
			return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
		}
		if (diffMs < day) {
			const hours = Math.floor(diffMs / hour);
			return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		}
		if (diffMs < day * 2) return 'Yesterday';
		if (diffMs < day * 7) {
			const days = Math.floor(diffMs / day);
			return `${days} day${days === 1 ? '' : 's'} ago`;
		}
		return new Date(value).toLocaleDateString();
	};

	const updateEmailFrequency = async (pref: EmailPref, frequency: string) => {
		try {
			const res = await fetch('/api/client/email-preferences', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ deal_id: pref.deal_id, frequency })
			});
			if (!res.ok) {
				const payload = await readJson(res);
				throw new Error(getErrorMessage(payload, 'Failed to update'));
			}
			pref.frequency = frequency;
			emailPrefs = [...emailPrefs];
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to update email preference');
		}
	};

	// ── Project Review booking (Zoho Bookings inline embed) ──────────
	const BOOKING_URL = 'https://homecpr.zohobookings.com/portal-embed#/4636703000003236055';
	const BOOKING_SCRIPT = 'https://bookings.nimbuspop.com/assets/embed.js';
	let bookingOpen = false;
	let bookingInitialized = false;
	let bookingError = '';

	async function toggleBooking() {
		bookingOpen = !bookingOpen;
		if (!bookingOpen || bookingInitialized) return;
		await tick(); // container must be in the DOM before the embed mounts
		const init = () => {
			try {
				(window as any).Bookings?.inlineEmbed({
					url: BOOKING_URL,
					parent: '#booking-inline-container',
					height: '600px'
				});
				bookingInitialized = true;
			} catch {
				bookingError = 'Could not load the scheduler. Please refresh and try again.';
			}
		};
		if ((window as any).Bookings) {
			init();
			return;
		}
		const script = document.createElement('script');
		script.src = BOOKING_SCRIPT;
		script.onload = init;
		script.onerror = () => {
			bookingError = 'Could not load the scheduler. Please refresh and try again.';
		};
		document.head.appendChild(script);
	}

	onMount(async () => {
		fetch('/api/client/email-preferences')
			.then(async (res) => {
				if (res.status === 401) return;
				const payload = await readJson(res);
				if (res.ok) emailPrefs = payload.data || [];
			})
			.catch(() => {})
			.finally(() => { emailPrefsLoading = false; });

		fetch('/api/client/emails')
			.then(async (res) => {
				if (res.status === 401) return;
				const payload = await readJson(res);
				if (!res.ok) throw new Error(getErrorMessage(payload, 'Failed to load emails'));
				emailTimeline = payload.data || [];
			})
			.catch((err) => {
				emailTimelineError = err.message || 'Failed to load emails';
			})
			.finally(() => {
				emailTimelineLoading = false;
			});

		try {
			const [projectsRes, invoicesRes, contractsRes] = await Promise.all([
				fetch('/api/projects'),
				fetch('/api/invoices'),
				fetch('/api/sign/requests')
			]);

			if (projectsRes.status === 401) {
				throw new Error('Please login again');
			}
			if (!projectsRes.ok) throw new Error('Failed to fetch projects');
			const projectsData = await projectsRes.json();
			projects = projectsData.data || [];

			if (invoicesRes.ok) {
				const invoicesData = await invoicesRes.json();
				invoices = invoicesData.data || [];
				quotedTotal = Number(invoicesData.quotedTotal || 0);
				changeOrderItems = Array.isArray(invoicesData.changeOrderItems)
					? invoicesData.changeOrderItems
					: [];
			} else if (invoicesRes.status !== 401) {
				invoiceError = 'Failed to fetch invoices';
			}

			if (contractsRes.ok) {
				const contractsData = await contractsRes.json();
				contracts = contractsData.data || [];
			} else if (contractsRes.status !== 401) {
				contractError = 'Failed to fetch contracts';
			}
			contractsLoading = false;

			// Fetch project detail (documents + access info) using first project
			if (projects.length > 0) {
				const pid = projects[0].id;
				accessProjectId = pid;
				const detailRes = await fetch(`/api/project/${pid}`);
				if (detailRes.ok) {
					const detail = await detailRes.json();
					wifiInput = detail.deal?.WiFi || '';
					doorCodeInput = detail.deal?.Garage_Code || '';
					projectDocuments = detail.documents || [];
					clientPortalUrl = getClientPortalUrl(detail.deal);
				}
				loadProjectTasks(pid);
			}
			projectDocumentsLoading = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="dashboard">
	<header class="page-header">
		<h1>My Projects</h1>
		<p class="page-subtitle">View and manage your renovation projects</p>
	</header>

	{#if loading}
		<div class="state-card">Loading your projects...</div>
	{:else if error}
		<div class="state-card state-error">
			<p>Error: {error}</p>
			<a href="/auth/client" class="btn-primary">Please login again</a>
		</div>
	{:else if projects.length === 0}
		<div class="state-card">No projects found</div>
	{:else}
		<!-- Schedule a Project Review — always visible at the top -->
		<section class="review-banner">
			<div class="review-banner-text">
				<h2>Schedule a 15-minute Project Review</h2>
				<p>Bring your questions! · Tuesday–Thursday, 4–5 PM</p>
			</div>
			<button class="review-btn" type="button" on:click={toggleBooking} aria-expanded={bookingOpen}>
				{bookingOpen ? 'Hide scheduler' : 'Pick a time'}
			</button>
		</section>
		{#if bookingOpen}
			<section class="review-embed">
				{#if bookingError}
					<p class="review-error">{bookingError}</p>
				{:else if !bookingInitialized}
					<p class="review-loading">Loading available times…</p>
				{/if}
				<div id="booking-inline-container"></div>
			</section>
		{/if}

		<!-- Today on site — positive Cliq updates + WorkDrive Photos folder -->
		<DailyUpdate dealId={String(projects[0].id)} />

		<!-- Project Bot -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (botOpen = !botOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="8"/><circle cx="7" cy="9" r="1" fill="currentColor"/><circle cx="13" cy="9" r="1" fill="currentColor"/><path d="M7 13h6"/></svg>
					Ask CPR Bot
				</span>
				<span class="toggle-icon">{botOpen ? '−' : '+'}</span>
			</button>
			{#if botOpen}
				<ClientChatPanel
					dealId={String(projects[0].id)}
					dealLabel={projects[0].Deal_Name || 'My project'}
				/>
			{/if}
		</section>

		<!-- Photos -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (photosOpen = !photosOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="8" r="2"/><path d="M18 14l-4-4-3 3-2-2-5 5"/></svg>
					Progress Photos
				</span>
				<span class="toggle-icon">{photosOpen ? '−' : '+'}</span>
			</button>
			{#if photosOpen}
				{#if portalFilesLoading}
					<p class="muted-text">Loading photos…</p>
				{:else if portalPhotos.length > 0 || attachmentPhotos.length > 0}
					<div class="doc-list">
						{#each portalPhotos as file (file.id)}
							<div class="doc-item">
								{#if file.url}
									<a href={file.url} target="_blank" rel="noreferrer noopener" class="doc-link">{file.name}</a>
								{:else}
									<span class="doc-link">{file.name}</span>
								{/if}
								{#if file.modifiedTime}
									<span class="meta-text">{new Date(file.modifiedTime).toLocaleDateString()}</span>
								{/if}
							</div>
						{/each}
						{#each attachmentPhotos as doc (doc.id)}
							<div class="doc-item">
								<a href={`/api/project/${accessProjectId}/documents/${doc.id}?fileName=${encodeURIComponent(doc.File_Name)}`} target="_blank" class="doc-link">{doc.File_Name}</a>
								<span class="meta-text">{new Date(doc.Created_Time).toLocaleDateString()}</span>
							</div>
						{/each}
					</div>
				{/if}
				{@const photoLinks = projects.filter(p => getProgressPhotosLink(p))}
				{#if photoLinks.length === 0 && portalPhotos.length === 0 && attachmentPhotos.length === 0 && !portalFilesLoading}
					<p class="muted-text">No photos available.</p>
				{:else if photoLinks.length > 0}
					<div class="doc-list">
						{#each photoLinks as project}
							{@const link = getProgressPhotosLink(project)}
							<div class="doc-item">
								<span class="doc-link-label">{project.Deal_Name || 'Project'}</span>
								<a
									href={link}
									class="btn-secondary btn-sm"
									target={link.startsWith('http') ? '_blank' : undefined}
									rel={link.startsWith('http') ? 'noreferrer' : undefined}
								>View Photos</a>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</section>

		<!-- Project Tasks -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (tasksOpen = !tasksOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5h12M4 10h8M4 15h10"/><circle cx="17" cy="10" r="3"/></svg>
					Project Tasks
					{#if !tasksLoading && tasks.length > 0}
						<span class="count-pill">{tasks.filter(isTaskComplete).length}/{tasks.length}</span>
					{/if}
				</span>
				<span class="toggle-icon">{tasksOpen ? '−' : '+'}</span>
			</button>
			{#if tasksOpen}
				{#if tasksLoading}
					<p class="muted-text">Loading tasks…</p>
				{:else if tasksError}
					<p class="muted-text" style="color:#c00;">{tasksError}</p>
				{:else if tasks.length === 0}
					<p class="muted-text">
						No project tasks yet. Your project manager will add the work plan to Zoho Projects.
					</p>
				{:else}
					<ul class="task-list">
						{#each tasks as task}
							<li class="task-row">
								<span
									class="task-name"
									class:task-name-complete={isTaskComplete(task)}
								>{getTaskName(task)}</span>
								<span
									class="task-status-pill"
									class:task-status-complete={isTaskComplete(task)}
									class:task-status-open={!isTaskComplete(task)}
								>{getTaskStatusLabel(task)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>

		<!-- Financial Summary -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (financialOpen = !financialOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v2M10 16v2M2 10h2M16 10h2"/><circle cx="10" cy="10" r="5"/></svg>
					Financial Summary
				</span>
				<span class="toggle-icon">{financialOpen ? '−' : '+'}</span>
			</button>
			{#if financialOpen}
			<div class="summary-grid">
				{#if quotedTotal > 0}
					<div class="summary-card">
						<span class="summary-label">Price</span>
						<span class="summary-value">${quotedTotal.toLocaleString()}</span>
					</div>
				{/if}
				<div class="summary-card">
					<span class="summary-label">Invoiced</span>
					<span class="summary-value">${invoiceTotals.total.toLocaleString()}</span>
				</div>
				<div class="summary-card">
					<span class="summary-label">Balance</span>
					<span class="summary-value">${remainingBalance.toLocaleString()}</span>
				</div>
			</div>
			{/if}
		</section>

		<!-- Invoices -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (invoicesOpen = !invoicesOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="14" height="16" rx="2"/><path d="M7 6h6M7 10h6M7 14h4"/></svg>
					Invoices
				</span>
				<span class="toggle-icon">{invoicesOpen ? '−' : '+'}</span>
			</button>
			{#if invoicesOpen}
			{#if invoiceError}
				<p class="muted-text error-text">{invoiceError}</p>
			{:else if regularInvoices.length === 0}
				<p class="muted-text">No invoices found.</p>
			{:else}
				<div class="card-list">
					{#each regularInvoices as invoice}
						<div class="invoice-card">
							<div class="invoice-info">
								<h3 class="invoice-number">{invoice.invoice_number || invoice.invoice_id}</h3>
								<div class="invoice-meta">
									<span class="badge badge-muted">{invoice.status || 'Unknown'}</span>
									<span class="meta-text">{formatInvoiceDate(invoice)}</span>
								</div>
							</div>
							<div class="invoice-amounts">
								<div class="amount-row">
									<span class="amount-label">Total</span>
									<span class="amount-value">${Number(invoice.total || 0).toLocaleString()}</span>
								</div>
								<div class="amount-row">
									<span class="amount-label">Balance</span>
									<span class="amount-value">${Number(invoice.balance || 0).toLocaleString()}</span>
								</div>
							</div>
							<div class="invoice-actions">
								{#if invoice.payment_url}
									<a class="btn-primary" href={invoice.payment_url} target="_blank" rel="noreferrer">Pay Now</a>
								{/if}
								{#if invoice.invoice_url}
									<a class="btn-secondary" href={invoice.invoice_url} target="_blank" rel="noreferrer">View Invoice</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>

		<!-- Change Orders -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (changeOrdersOpen = !changeOrdersOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l6 6-10 10H2v-6L12 2z"/><path d="M9 5l6 6"/></svg>
					Change Orders
				</span>
				<span class="toggle-icon">{changeOrdersOpen ? '−' : '+'}</span>
			</button>
			{#if changeOrdersOpen}
			<div class="co-request-area">
				{#if coSuccess}
					<div class="co-banner co-banner-success">{coSuccess}</div>
				{/if}
				{#if coBooksWarning}
					<div class="co-banner co-banner-warning">{coBooksWarning}</div>
				{/if}

				{#if !coPanelOpen}
					<button class="co-request-btn" type="button" on:click={openChangeOrderPanel}>
						Request a Change Order
					</button>
				{:else}
					<div class="co-panel">
						{#if projects.length > 1}
							<div class="co-field">
								<label for="co-deal-select">Project</label>
								<select id="co-deal-select" bind:value={coDealId}>
									<option value="" disabled>Select a project…</option>
									{#each projects as project}
										<option value={project.id}>{project.Deal_Name || project.Name || `Project ${project.id}`}</option>
									{/each}
								</select>
							</div>
						{/if}

						<div class="co-field">
							<label for="co-note">Describe the change you would like</label>
							<textarea
								id="co-note"
								rows="6"
								bind:value={coNote}
								placeholder="What would you like changed or added? Add as much detail as you can."
							></textarea>
						</div>

						<div class="co-field">
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<label>Photos / videos (optional)</label>
							<PhotoUpload bind:this={coPhotoUploadRef} maxFiles={5} />
						</div>

						{#if coSubmitError}
							<div class="co-banner co-banner-error">{coSubmitError}</div>
						{/if}

						<div class="co-actions">
							<button
								class="co-submit-btn"
								type="button"
								on:click={submitChangeOrder}
								disabled={coSubmitting || !coNote.trim() || !coDealId}
							>
								{coSubmitting ? 'Submitting…' : 'Submit request'}
							</button>
							<button
								class="co-cancel-btn"
								type="button"
								on:click={closeChangeOrderPanel}
								disabled={coSubmitting}
							>
								Cancel
							</button>
						</div>
					</div>
				{/if}
			</div>

			{#if changeOrderItems.length > 0}
				<div class="co-item-list">
					{#each changeOrderItems as item}
						<div class="co-item">
							<div class="co-item-info">
								<span class="co-item-name">{item.name}</span>
								{#if item.description}
									<span class="co-item-desc">{item.description}</span>
								{/if}
							</div>
							<span class="co-item-price">${item.total.toLocaleString()}</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if invoiceError}
				<p class="muted-text error-text">{invoiceError}</p>
			{:else if changeOrders.length === 0 && changeOrderItems.length === 0}
				<p class="muted-text">No previous change orders.</p>
			{:else if changeOrders.length > 0}
				<div class="card-list">
					{#each changeOrders as invoice}
						<div class="invoice-card">
							<div class="invoice-info">
								<h3 class="invoice-number">{invoice.invoice_number || invoice.invoice_id}</h3>
								<div class="invoice-meta">
									<span class="badge badge-muted">{invoice.status || 'Unknown'}</span>
									<span class="meta-text">{formatInvoiceDate(invoice)}</span>
								</div>
							</div>
							<div class="invoice-amounts">
								<div class="amount-row">
									<span class="amount-label">Total</span>
									<span class="amount-value">${Number(invoice.total || 0).toLocaleString()}</span>
								</div>
								<div class="amount-row">
									<span class="amount-label">Balance</span>
									<span class="amount-value">${Number(invoice.balance || 0).toLocaleString()}</span>
								</div>
							</div>
							<div class="invoice-actions">
								{#if invoice.payment_url}
									<a class="btn-primary" href={invoice.payment_url} target="_blank" rel="noreferrer">Pay Now</a>
								{/if}
								{#if invoice.invoice_url}
									<a class="btn-secondary" href={invoice.invoice_url} target="_blank" rel="noreferrer">View Invoice</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>

		<!-- Email Updates Timeline -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (emailUpdatesOpen = !emailUpdatesOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 4l8 6 8-6"/></svg>
					Email Updates
				</span>
				<span class="toggle-icon">{emailUpdatesOpen ? '−' : '+'}</span>
			</button>
			{#if emailUpdatesOpen}
			{#if emailTimelineLoading}
				<p class="muted-text">Loading...</p>
			{:else if emailTimelineError}
				<p class="muted-text error-text">{emailTimelineError}</p>
			{:else if emailTimeline.length === 0}
				<p class="muted-text">No email updates yet.</p>
			{:else}
				<div class="email-timeline">
					{#each emailTimeline as email (email.id)}
						{@const expanded = expandedEmails.has(email.id)}
						{@const body = emailBodies.get(email.id)}
						<div class="email-item email-{email.direction}">
							<button
								type="button"
								class="email-item-trigger"
								on:click={() => toggleEmailExpand(email)}
								aria-expanded={expanded}
							>
								<div class="email-item-top">
									<div class="email-item-labels">
										<span class="badge {email.direction === 'inbound' ? 'badge-inbound' : 'badge-outbound'}">
											{email.direction === 'inbound' ? 'Received' : 'Sent'}
										</span>
										{#if email.from_name}
											<span class="email-from">{email.from_name}</span>
										{/if}
									</div>
									<span class="email-time">
										{formatRelativeTime(email.date)}
										<span class="email-expand-chevron" class:rotated={expanded} aria-hidden="true">▾</span>
									</span>
								</div>
								<p class="email-subject">{email.subject}</p>
								{#if email.summary && !expanded}
									<p class="email-summary">{email.summary}</p>
								{/if}
							</button>
							{#if expanded}
								<div class="email-body">
									{#if body?.loading}
										<p class="muted-text">Loading email…</p>
									{:else if body?.error}
										<p class="muted-text error-text">{body.error}</p>
									{:else if body?.content}
										<!-- email body sanitized on receive; trusted enough to render -->
										<div class="email-body-content">{@html body.content}</div>
									{:else}
										<p class="muted-text">Email body unavailable.</p>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Email frequency preferences -->
			{#if !emailPrefsLoading && emailPrefs.length > 0}
				<div class="email-prefs-sub">
					<span class="email-prefs-label">Update frequency</span>
					{#each emailPrefs as pref (pref.id)}
						<div class="email-pref-card">
							<div class="email-pref-info">
								<span class="email-pref-deal">Project {pref.deal_id.slice(-6)}</span>
								<span class="email-pref-email">{pref.client_email}</span>
							</div>
							<select
								value={pref.frequency}
								on:change={(e) => updateEmailFrequency(pref, e.currentTarget.value)}
							>
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
								<option value="none">None</option>
							</select>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>
{/if}

	<!-- Documents (contracts + uploaded files + external Client Portal folder) -->
	<!-- Only shown when the user has at least one project; documents are scoped to that project. -->
	{#if projects.length > 0}
	<section class="section">
		<button class="section-header" type="button" on:click={() => (documentsOpen = !documentsOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v6l4 2"/><circle cx="10" cy="10" r="8"/></svg>
				Documents
			</span>
			<span class="toggle-icon">{documentsOpen ? '−' : '+'}</span>
		</button>
		{#if documentsOpen}
			{#if portalFilesLoading}
				<p class="muted-text">Loading documents…</p>
			{:else if portalDocs.length > 0}
				{#each portalFileGroups as group (group.folder)}
					{#if group.folder}
						<p class="docs-subhead">{group.folder}</p>
					{/if}
					<div class="doc-list">
						{#each group.files as file (file.id)}
							<div class="doc-item">
								{#if file.url}
									<a href={file.url} target="_blank" rel="noreferrer noopener" class="doc-link">{file.name}</a>
								{:else}
									<span class="doc-link">{file.name}</span>
								{/if}
								{#if file.modifiedTime}
									<span class="meta-text">{new Date(file.modifiedTime).toLocaleDateString()}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			{:else if portalFilesMessage}
				<p class="muted-text">{portalFilesMessage}</p>
			{/if}
			{#if clientPortalUrl}
				<div class="doc-list">
					<div class="doc-item">
						<a
							href={clientPortalUrl}
							target="_blank"
							rel="noreferrer noopener"
							class="doc-link"
						>Open documents folder ↗</a>
					</div>
				</div>
			{/if}
			{#if contractsLoading || projectDocumentsLoading}
				<p class="muted-text">Loading…</p>
			{:else}
				{#if contractError}
					<p class="muted-text error-text">{contractError}</p>
				{:else if contracts.length > 0}
					<p class="docs-subhead">Contracts</p>
					<div class="card-list">
						{#each contracts as contract}
							<div class="contract-card">
								<div class="contract-info">
									<h3 class="contract-name">{contract.name}</h3>
									<span class="badge badge-muted">{contract.status || 'Unknown'}</span>
								</div>
								<div class="contract-actions">
									{#if contract.can_sign}
										<a class="btn-primary" href={`/contracts/${contract.id}/sign`} target="_blank" rel="noopener">Sign</a>
									{/if}
									{#if /complete|signed/i.test(contract.status || '')}
										<a class="btn-secondary" href={`/api/sign/requests/${contract.id}/pdf`} target="_blank" rel="noopener">View PDF</a>
									{:else if contract.view_url}
										<a class="btn-secondary" href={`/contracts/${contract.id}/view?url=${encodeURIComponent(contract.view_url)}`} target="_blank" rel="noopener">View</a>
									{:else}
										<a class="btn-secondary" href={`/contracts/${contract.id}/view`} target="_blank" rel="noopener">View</a>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
				{#if attachmentDocs.length > 0}
					<p class="docs-subhead">Files</p>
					<div class="doc-list">
						{#each attachmentDocs as doc}
							<div class="doc-item">
								<a href={`/api/project/${accessProjectId}/documents/${doc.id}?fileName=${encodeURIComponent(doc.File_Name)}`} target="_blank" class="doc-link">{doc.File_Name}</a>
								<span class="meta-text">{new Date(doc.Created_Time).toLocaleDateString()}</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if !contractError && contracts.length === 0 && attachmentDocs.length === 0 && portalDocs.length === 0 && !clientPortalUrl}
					<p class="muted-text">No documents linked to this project yet.</p>
				{/if}
			{/if}
		{/if}
	</section>
	{/if}

	<!-- Access Info -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (accessOpen = !accessOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="11" r="4"/><path d="M12 7l6 6M15 7h3v3"/></svg>
				Update Access Info
			</span>
			<span class="toggle-icon">{accessOpen ? '−' : '+'}</span>
		</button>
		{#if accessOpen}
			<div class="access-body">
				<label class="access-label" for="dash-wifi">WiFi</label>
				<input id="dash-wifi" class="access-input" type="text" bind:value={wifiInput} placeholder="WiFi details" />
				<label class="access-label" for="dash-door">Door Code</label>
				<input id="dash-door" class="access-input" type="text" bind:value={doorCodeInput} placeholder="Door code" />
				<button class="access-btn" type="button" on:click={submitAccessInfo} disabled={accessUpdating || !accessProjectId}>
					{accessUpdating ? 'Saving…' : 'Save Access Info'}
				</button>
				{#if accessMessage}<p class="access-msg-ok">{accessMessage}</p>{/if}
				{#if accessError}<p class="access-msg-err">{accessError}</p>{/if}
			</div>
		{/if}
	</section>

	<!-- Account -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (accountOpen = !accountOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="7" r="4"/><path d="M3 18c0-3.3 3.1-6 7-6s7 2.7 7 6"/></svg>
				Account
			</span>
			<span class="toggle-icon">{accountOpen ? '−' : '+'}</span>
		</button>
		{#if accountOpen}
			<div class="account-body">
				<h3 class="account-subhead">Set Password</h3>
				<label class="account-label" for="pw-new">New Password</label>
				<input id="pw-new" class="account-input" type="password" bind:value={pwNew} />
				<label class="account-label" for="pw-confirm">Confirm Password</label>
				<input id="pw-confirm" class="account-input" type="password" bind:value={pwConfirm} />
				<button
					class="account-btn"
					type="button"
					on:click={submitPassword}
					disabled={pwLoading || !pwNew || !pwConfirm}
				>
					{pwLoading ? 'Updating…' : 'Update Password'}
				</button>
				{#if pwMessage}
					<p class="account-message">{pwMessage}</p>
				{/if}
				<div class="account-divider"></div>
				<a class="account-logout" href="/api/logout?next=/">Log out</a>
			</div>
		{/if}
	</section>
</div>

<style>
	/* ── Mobile-first base ────────────────────────────── */
	.dashboard {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	.page-header h1 {
		font-size: 1.35rem;
		font-weight: 800;
		color: #111827;
		margin: 0;
	}

	.page-subtitle {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}

	/* ── Sections ─────────────────────────────────────── */
	.section {
		margin-bottom: 1.25rem;
	}

	/* ── Project Review booking banner ───────────────── */
	.review-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
		padding: 1rem 1.25rem;
		background: #fffbeb;
		border: 1px solid #fcd34d;
		border-radius: 12px;
	}

	.review-banner-text h2 {
		margin: 0 0 0.2rem;
		font-size: 1.05rem;
		font-weight: 700;
		color: #92400e;
	}

	.review-banner-text p {
		margin: 0;
		color: #b45309;
		font-size: 0.9rem;
	}

	.review-btn {
		background: #111827;
		color: #fff;
		border: none;
		border-radius: 10px;
		padding: 0.7rem 1.3rem;
		font-weight: 700;
		font-size: 0.95rem;
		min-height: 44px;
		cursor: pointer;
		white-space: nowrap;
	}

	.review-btn:hover {
		background: #1f2937;
	}

	.review-embed {
		margin: -0.5rem 0 1.25rem;
		padding: 0.75rem;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
	}

	.review-loading,
	.review-error {
		margin: 0.5rem 0.5rem 0.75rem;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.review-error {
		color: #b91c1c;
	}

	.section-header {
		width: 100%;
		box-sizing: border-box;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.7rem 2.4rem;
		border: 1px solid #e5e7eb;
		background: #f8fafc;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		color: #111827;
		-webkit-tap-highlight-color: transparent;
	}

	.section-header .toggle-icon {
		position: absolute;
		right: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
	}

	.section-header:hover {
		background: #eef2f7;
	}

	/* Non-interactive header variant for external-link sections */
	.section-header-link {
		cursor: default;
	}

	.section-header-link:hover {
		background: #f8fafc;
	}

	.section-header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.section-header-left svg {
		flex-shrink: 0;
		color: #6b7280;
	}

	.toggle-icon {
		font-size: 1.25rem;
		line-height: 1;
		color: #9ca3af;
	}

	.section-unavailable {
		font-size: 1rem;
		color: #d1d5db;
	}

	.docs-subhead {
		margin: 0.85rem 0 0.3rem;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
	}

	/* External link button inside section header */
	.section-external-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.75rem;
		background: #111827;
		color: #fff;
		text-decoration: none;
		border-radius: 7px;
		font-size: 0.8rem;
		font-weight: 600;
		min-height: 34px;
		flex-shrink: 0;
		transition: background 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.section-external-link:hover {
		background: #1f2937;
	}

	/* ── State cards ──────────────────────────────────── */
	.state-card {
		text-align: center;
		padding: 2rem 1rem;
		background: #f5f5f5;
		border-radius: 12px;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.state-error {
		color: #dc2626;
		background: #fef2f2;
	}

	/* ── Muted text ──────────────────────────────────── */
	.muted-text {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0.75rem 0 0;
		padding-left: 0.25rem;
	}

	.error-text {
		color: #dc2626;
	}

	/* ── Project Tasks (Zoho Projects) ──────────────────── */
	.count-pill {
		font-size: 0.78rem;
		color: #4b5563;
		background: #f3f4f6;
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		font-weight: 500;
		margin-left: 0.5rem;
	}
	.task-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.task-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.8rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
	}
	.task-name {
		flex: 1;
		font-size: 0.9rem;
		color: #111827;
		word-break: break-word;
	}
	.task-name-complete {
		color: #6b7280;
		text-decoration: line-through;
	}
	.task-status-pill {
		flex-shrink: 0;
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.18rem 0.55rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.task-status-open {
		color: #166534;
		background: #dcfce7;
	}
	.task-status-complete {
		color: #4b5563;
		background: #e5e7eb;
	}

	/* ── Change-order request form ────────────────────── */
	.co-request-area {
		padding: 0.75rem 0.25rem 1rem;
	}

	.co-request-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.co-request-btn:hover {
		background: #0052a3;
	}

	.co-panel {
		display: grid;
		gap: 1rem;
		background: #f9fafb;
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		padding: 1.1rem;
	}

	.co-field {
		display: grid;
		gap: 0.4rem;
	}

	.co-field label {
		font-weight: 600;
		font-size: 0.92rem;
		color: #111827;
	}

	.co-panel textarea,
	.co-panel select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-family: inherit;
		font-size: 1rem;
		min-height: 44px;
		background: #fff;
	}

	.co-panel textarea {
		resize: vertical;
		min-height: 120px;
		line-height: 1.5;
	}

	.co-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.co-submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.co-submit-btn:hover:not(:disabled) {
		background: #0052a3;
	}

	.co-submit-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.co-cancel-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: #1a1a1a;
		border: 1px solid #d0d0d0;
		border-radius: 8px;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.co-cancel-btn:hover:not(:disabled) {
		background: #f5f5f5;
	}

	.co-cancel-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.co-banner {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-size: 0.95rem;
		margin-bottom: 0.85rem;
	}

	.co-banner-success {
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #065f46;
	}

	.co-banner-warning {
		background: #fffbeb;
		border: 1px solid #fde68a;
		color: #92400e;
	}

	.co-banner-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
	}

	/* ── Activity ─────────────────────────────────────── */
	.activity-list {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}

	.activity-item {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem 0.75rem;
		border-left: 3px solid transparent;
		border-radius: 0 8px 8px 0;
		background: #fafafa;
	}

	.activity-item-comm {
		border-left-color: #3b82f6;
	}

	.activity-item-daily_log {
		border-left-color: #10b981;
	}

	.activity-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.activity-labels {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.activity-time {
		color: #9ca3af;
		font-size: 0.75rem;
	}

	.activity-summary {
		margin: 0;
		color: #374151;
		font-size: 0.85rem;
		line-height: 1.45;
	}

	/* ── Badges ───────────────────────────────────────── */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.badge-muted {
		background: #f3f4f6;
		color: #374151;
	}

	.badge-channel {
		background: #e0e7ff;
		color: #3730a3;
		text-transform: capitalize;
	}

	/* ── Project cards ────────────────────────────────── */
	.project-card {
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		margin-bottom: 0.75rem;
	}

	.project-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.stage-badge {
		display: inline-flex;
		align-items: center;
		background: #e0f2fe;
		color: #0369a1;
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.project-date {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.project-name {
		font-size: 1rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.25rem;
	}

	.project-meta {
		color: #6b7280;
		font-size: 0.8rem;
		margin: 0 0 0.75rem;
	}

	/* ── Buttons ──────────────────────────────────────── */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		background: #111827;
		color: #fff;
		text-decoration: none;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s;
		border: none;
		cursor: pointer;
	}

	.btn-primary:hover {
		background: #1f2937;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		background: #fff;
		color: #374151;
		text-decoration: none;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		border: 1px solid #d1d5db;
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s;
		cursor: pointer;
	}

	.btn-secondary:hover {
		background: #f9fafb;
	}

	/* ── Financial summary ────────────────────────────── */
	.summary-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		justify-items: start;
	}

	/* Change-order items from the quote */
	.co-item-list {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.co-item {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 1.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
	}

	.co-item-info {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	.co-item-name {
		font-weight: 600;
		color: #111827;
		font-size: 0.92rem;
	}

	.co-item-desc {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.co-item-price {
		font-weight: 700;
		color: #111827;
		white-space: nowrap;
	}

	.summary-card {
		padding: 0.85rem 1.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #f8fafc;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: fit-content;
		min-width: 11rem;
	}

	.summary-label {
		color: #6b7280;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}

	.summary-value {
		font-size: 1.15rem;
		font-weight: 800;
		color: #111827;
	}

	/* ── Card list / Invoice cards ────────────────────── */
	.card-list {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.75rem;
		justify-items: start;
	}

	.invoice-card {
		padding: 1rem 1.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		width: fit-content;
		min-width: 16rem;
		max-width: 100%;
		box-sizing: border-box;
	}

	.invoice-info {
		margin-bottom: 0.6rem;
	}

	.invoice-number {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.35rem;
	}

	.invoice-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.meta-text {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.invoice-amounts {
		display: flex;
		gap: 2rem;
		margin-bottom: 0.75rem;
	}

	.amount-row {
		display: flex;
		flex-direction: column;
	}

	.amount-label {
		font-size: 0.7rem;
		color: #9ca3af;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.amount-value {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
	}

	.invoice-actions {
		display: flex;
		gap: 0.5rem;
	}

	.invoice-actions .btn-primary,
	.invoice-actions .btn-secondary {
		flex: 1;
	}

	/* ── Email timeline ───────────────────────────────── */
	.email-timeline {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.75rem;
		justify-items: start;
	}

	.email-item {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.65rem 0.85rem;
		border-left: 3px solid transparent;
		border-radius: 0 8px 8px 0;
		background: #fafafa;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
	}

	.email-outbound {
		border-left-color: #3b82f6;
	}

	.email-inbound {
		border-left-color: #10b981;
	}

	.email-item-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.email-item-labels {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.badge-outbound {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.badge-inbound {
		background: #d1fae5;
		color: #065f46;
	}

	.email-from {
		font-size: 0.75rem;
		color: #6b7280;
		font-weight: 500;
	}

	.email-time {
		color: #9ca3af;
		font-size: 0.75rem;
	}

	.email-subject {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #111827;
		line-height: 1.35;
	}

	.email-summary {
		margin: 0;
		font-size: 0.8rem;
		color: #6b7280;
		line-height: 1.4;
	}

	.email-item-trigger {
		all: unset;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		cursor: pointer;
		text-align: left;
		width: 100%;
	}
	.email-item-trigger:focus-visible {
		outline: 2px solid #3b82f6;
		outline-offset: 2px;
		border-radius: 4px;
	}
	.email-expand-chevron {
		display: inline-block;
		margin-left: 0.4rem;
		color: #9ca3af;
		transition: transform 120ms ease;
	}
	.email-expand-chevron.rotated {
		transform: rotate(180deg);
	}
	.email-body {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px dashed #e5e7eb;
		font-size: 0.85rem;
		color: #1f2937;
		line-height: 1.5;
	}
	.email-body-content {
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.email-body-content :global(img),
	.email-body-content :global(table) {
		max-width: 100%;
		height: auto;
	}
	.email-body-content :global(a) {
		color: #2563eb;
		word-break: break-all;
	}
	.email-body-content :global(blockquote) {
		border-left: 3px solid #e5e7eb;
		padding-left: 0.75rem;
		margin: 0.5rem 0;
		color: #6b7280;
	}

	/* ── Email prefs (sub-section) ────────────────────── */
	.email-prefs-sub {
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid #e5e7eb;
		display: grid;
		gap: 0.5rem;
	}

	.email-prefs-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
		color: #9ca3af;
	}

	.email-pref-card {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 1.5rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		flex-wrap: wrap;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
	}

	.email-pref-card select {
		width: auto;
	}

	.email-pref-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.email-pref-deal {
		font-weight: 700;
		font-size: 0.8rem;
		color: #111827;
	}

	.email-pref-email {
		color: #9ca3af;
		font-size: 0.7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.email-pref-card select {
		padding: 0.45rem 0.65rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		min-height: 44px;
		font-size: 0.85rem;
		background: #fff;
		color: #374151;
		-webkit-tap-highlight-color: transparent;
		flex-shrink: 0;
	}

	/* ── Photos ───────────────────────────────────────── */
	.doc-link-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: #111827;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.btn-sm {
		padding: 0.4rem 0.85rem;
		font-size: 0.8rem;
		min-height: 36px;
		flex-shrink: 0;
	}

	/* ── Project Overview ──────────────────────────────── */
	.overview-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.overview-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #f8fafc;
	}

	.overview-item-full {
		grid-column: 1 / -1;
	}

	.overview-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
		color: #9ca3af;
	}

	.overview-value {
		font-size: 0.9rem;
		font-weight: 600;
		color: #111827;
	}

	.overview-text {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: #374151;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.notes-list {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.note-card {
		padding: 0.75rem 1rem;
		border-left: 3px solid #3b82f6;
		border-radius: 0 8px 8px 0;
		background: #f8fafc;
	}

	.note-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.note-date {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.note-author {
		font-size: 0.75rem;
		color: #6b7280;
		font-style: italic;
	}

	.note-content {
		margin: 0;
		font-size: 0.85rem;
		color: #374151;
		line-height: 1.45;
	}

	/* ── Contracts ────────────────────────────────────── */
	.contract-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.85rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	.contract-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.contract-name {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}

	.contract-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	/* ── Documents ─────────────────────────────────────── */
	.doc-list {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}

	.doc-item {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 1.5rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #fff;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
	}

	.doc-link {
		font-size: 0.85rem;
		font-weight: 500;
		color: #1d4ed8;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.doc-link:hover {
		text-decoration: underline;
	}

	/* ── Access Info ───────────────────────────────────── */
	.access-body {
		padding: 1rem 0.25rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 520px;
	}

	.access-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
		margin-top: 0.5rem;
	}

	.access-input {
		padding: 0.65rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9rem;
		min-height: 44px;
		background: #fff;
	}

	.access-btn {
		margin-top: 0.75rem;
		padding: 0.65rem 1rem;
		background: #111827;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
		align-self: flex-start;
	}

	.access-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.access-msg-ok {
		font-size: 0.82rem;
		color: #166534;
		margin: 0.25rem 0 0;
	}

	.access-msg-err {
		font-size: 0.82rem;
		color: #b91c1c;
		margin: 0.25rem 0 0;
	}

	/* ── Coming soon ──────────────────────────────────── */
	.coming-soon {
		font-style: italic;
	}

	/* ── Account section ──────────────────────────────── */
	.account-body {
		padding: 1rem 0.25rem 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		max-width: 22rem;
	}

	.account-body input {
		width: 100%;
	}

	.account-subhead {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.5rem;
	}

	.account-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
		margin-top: 0.5rem;
	}

	.account-input {
		padding: 0.65rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9rem;
		min-height: 44px;
		background: #fff;
	}

	.account-btn {
		margin-top: 0.75rem;
		padding: 0.65rem 1rem;
		background: #111827;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	.account-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.account-message {
		font-size: 0.82rem;
		color: #374151;
		margin: 0.25rem 0 0;
	}

	.account-divider {
		height: 1px;
		background: #e5e7eb;
		margin: 0.75rem 0;
	}

	.account-logout {
		display: inline-flex;
		align-items: center;
		font-size: 0.85rem;
		font-weight: 500;
		color: #9ca3af;
		text-decoration: none;
	}

	.account-logout:hover {
		color: #374151;
	}

	/* ── Desktop ──────────────────────────────────────── */
	@media (min-width: 640px) {
		.dashboard {
			padding: 2rem;
		}

		.page-header h1 {
			font-size: 1.65rem;
		}

		.page-subtitle {
			font-size: 0.9rem;
		}

		.section-header {
			font-size: 1.1rem;
			padding: 0.75rem 1rem;
		}

		.summary-value {
			font-size: 1.4rem;
		}

		.summary-label {
			font-size: 0.75rem;
		}

		.project-card {
			display: grid;
			grid-template-columns: 1fr auto;
			grid-template-rows: auto auto;
			gap: 0.5rem 1.5rem;
			align-items: center;
			padding: 1.25rem;
		}

		.project-top {
			grid-column: 1 / -1;
			margin-bottom: 0;
		}

		.project-name {
			font-size: 1.1rem;
			grid-column: 1;
		}

		.project-meta {
			grid-column: 1;
			margin-bottom: 0;
		}

		.project-actions {
			grid-column: 2;
			grid-row: 2 / 4;
			flex-direction: column;
		}

		.invoice-card {
			display: grid;
			grid-template-columns: 1fr auto auto;
			align-items: center;
			gap: 1rem;
			padding: 1rem 1.25rem;
		}

		.invoice-info {
			margin-bottom: 0;
		}

		.invoice-amounts {
			margin-bottom: 0;
			gap: 1.5rem;
		}

		.invoice-actions {
			flex-direction: column;
			gap: 0.4rem;
		}

		.invoice-actions .btn-primary,
		.invoice-actions .btn-secondary {
			flex: none;
			white-space: nowrap;
			min-width: 110px;
		}
	}
</style>
