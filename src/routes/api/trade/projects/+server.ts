import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals, isTradeActiveStage } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import { getDealProjectIdsForLinking, getProject, getDealTaskSummaries, matchDealsToProjectsByName } from '$lib/server/projects';

const MAX_CONCURRENCY = 3;
const PROJECT_TASK_PREVIEW_LIMIT = 4;

function toSafeIso(value: unknown, fallback?: unknown) {
  const date = new Date(value as any);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  if (fallback) {
    const fallbackDate = new Date(fallback as any);
    if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
  }
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function normalizeProjectResponse(payload: any) {
  if (!payload) return null;
  if (payload.project && typeof payload.project === 'object') return payload.project;
  if (Array.isArray(payload.projects) && payload.projects[0]) return payload.projects[0];
  return payload;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  for (const k of ['name', 'display_value', 'displayValue', 'value']) {
    if (typeof r[k] === 'string' && (r[k] as string).trim()) return (r[k] as string).trim();
  }
  return null;
}

function toCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }
  return null;
}

function getTaskCountHint(project: any): number | null {
  const direct = toCount(project?.task_count ?? project?.tasks_count ?? project?.taskCount);
  if (direct !== null) return direct;
  const t = project?.tasks;
  if (!t || typeof t !== 'object') return null;
  const total = toCount(t.total_count ?? t.count ?? t.total);
  if (total !== null) return total;
  const open = toCount(t.open_count ?? t.open);
  const closed = toCount(t.closed_count ?? t.closed);
  return open === null && closed === null ? null : (open ?? 0) + (closed ?? 0);
}

function getCompletedCountHint(project: any): number | null {
  const direct = toCount(project?.task_completed_count ?? project?.completed_task_count);
  if (direct !== null) return direct;
  const t = project?.tasks;
  return t ? toCount(t.closed_count ?? t.closed) : null;
}

function normalizeForList(project: any, source: string) {
  return {
    ...project,
    status: toText(project?.status ?? project?.Status) ?? 'Unknown',
    start_date: toText(project?.start_date ?? project?.start_date_string) ?? null,
    end_date: toText(project?.end_date ?? project?.end_date_string) ?? null,
    task_count: getTaskCountHint(project) ?? 0,
    task_completed_count: getCompletedCountHint(project) ?? null,
    source
  };
}

const getDealLabel = (deal: any) =>
  deal?.Deal_Name || deal?.Potential_Name || deal?.Name || deal?.name || null;

const isPlaceholderName = (name: string | null) =>
  Boolean(name && /^deal\s+\d+$/i.test(name.trim()));

const hasUsefulData = (deal: any) =>
  Boolean(
    deal?.Address || deal?.Street || deal?.City || deal?.Stage ||
    deal?.Garage_Code || deal?.WiFi || deal?.Refined_SOW || deal?.File_Upload
  );

const isDisplayableDeal = (deal: any) => {
  const label = getDealLabel(deal);
  if (label && !isPlaceholderName(label)) return true;
  return hasUsefulData(deal);
};

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// GET /api/trade/projects
// Returns trade partner's Zoho Projects with CRM deal fallback.
export const GET: RequestHandler = async ({ cookies }) => {
  const sessionToken = cookies.get('trade_session');
  if (!sessionToken) throw error(401, 'Not authenticated');

  const session = await getTradeSession(sessionToken);
  if (!session) throw error(401, 'Invalid session');

  if (!session.trade_partner.zoho_trade_partner_id) {
    return json({ projects: [] });
  }

  const tokens = await getZohoTokens();
  if (!tokens) throw error(500, 'Zoho not configured');

  let accessToken = tokens.access_token;
  if (new Date(tokens.expires_at) < new Date()) {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    accessToken = refreshed.access_token;
    await upsertZohoTokens({
      user_id: tokens.user_id,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
      scope: tokens.scope
    });
  }

  let deals: any[] = [];
  try {
    const allDeals = await getTradePartnerDeals(accessToken);
    deals = allDeals.filter((deal) => isTradeActiveStage(deal?.Stage));
  } catch (err) {
    console.error('Failed to fetch trade partner deals for projects:', err);
    throw error(500, 'Failed to fetch projects');
  }

  // Build deal → project mapping. Keyed by dealId so multiple deals can
  // link to the same Zoho project without one silently shadowing the other.
  const dealToProject = new Map<string, { projectId: string; dealId: string; dealName: string | null; stage: string | null }>();
  const debugDealInfo: Array<{ dealName: string | null; dealId: string | null; rawProjectsId: unknown; resolvedIds: string[] }> = [];

  for (const deal of deals) {
    const ids = getDealProjectIdsForLinking(deal);
    const dealId = deal?.id ? String(deal.id) : null;
    debugDealInfo.push({ dealName: getDealLabel(deal), dealId, rawProjectsId: deal?.Project_ID, resolvedIds: ids });
    if (ids.length === 0 || !dealId) continue;
    const dealName = getDealLabel(deal);
    const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
    // Use the first project ID linked to this deal
    if (!dealToProject.has(dealId)) {
      dealToProject.set(dealId, { projectId: ids[0], dealId, dealName, stage });
    }
  }

  const linkedDealIds = new Set(dealToProject.keys());

  // Fallback: match unmapped deals to Zoho Projects by deal name
  const unmappedForNameMatch = deals.filter((deal) => {
    const dealId = deal?.id ? String(deal.id) : '';
    return dealId && !linkedDealIds.has(dealId);
  });

  if (unmappedForNameMatch.length > 0) {
    try {
      const nameMatches = await matchDealsToProjectsByName(unmappedForNameMatch);
      for (const [dealId, projectId] of nameMatches.entries()) {
        const deal = unmappedForNameMatch.find((d) => String(d.id) === dealId);
        const dealName = deal ? getDealLabel(deal) : null;
        const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
        if (!dealToProject.has(dealId)) {
          dealToProject.set(dealId, { projectId, dealId, dealName, stage });
          linkedDealIds.add(dealId);
        }
      }
    } catch {
      // non-fatal: name matching is best-effort
    }
  }

  // Unique project IDs to fetch (multiple deals may share a project)
  const uniqueProjectIds = Array.from(new Set(Array.from(dealToProject.values()).map((l) => l.projectId)));
  const projectIds = uniqueProjectIds;

  // Build CRM fallback cards for deals without linked Zoho Projects
  const unmappedDeals = deals.filter((deal) => {
    const dealId = deal?.id ? String(deal.id) : '';
    return dealId && !linkedDealIds.has(dealId) && isDisplayableDeal(deal);
  });

  // Fetch task summaries for unmapped deals
  const unmappedDealIds = unmappedDeals.map((d) => String(d.id)).filter(Boolean);
  const taskCountsByDealId = new Map<string, number>();
  const taskCompletedByDealId = new Map<string, number>();
  const taskPreviewByDealId = new Map<string, any[]>();

  if (unmappedDealIds.length > 0) {
    try {
      const summaries = await getDealTaskSummaries(unmappedDealIds.slice(0, 20), {
        concurrency: 2,
        previewLimit: PROJECT_TASK_PREVIEW_LIMIT
      });
      for (const [dealId, summary] of summaries.entries()) {
        if (summary && typeof summary.taskCount === 'number') taskCountsByDealId.set(dealId, summary.taskCount);
        if (summary && typeof summary.completedCount === 'number') taskCompletedByDealId.set(dealId, summary.completedCount);
        taskPreviewByDealId.set(dealId, summary?.preview || []);
      }
    } catch {
      // non-fatal
    }
  }

  const crmProjects = unmappedDeals.map((deal) => {
    const dealId = String(deal.id);
    return {
      id: dealId,
      deal_id: dealId,
      name: getDealLabel(deal) || `Deal ${dealId.slice(-6)}`,
      status: typeof deal.Stage === 'string' ? deal.Stage : 'Unknown',
      start_date: deal.Created_Time || null,
      end_date: deal.Closing_Date || null,
      task_count: taskCountsByDealId.get(dealId) ?? 0,
      task_completed_count: taskCompletedByDealId.get(dealId) ?? null,
      task_preview: taskPreviewByDealId.get(dealId) ?? [],
      source: 'crm_deal'
    };
  });

  // If no Zoho project IDs, return CRM deals only
  if (projectIds.length === 0) {
    return json({ projects: crmProjects, _debug: debugDealInfo });
  }

  // Fetch each unique Zoho Project once
  const projectDataById = new Map<string, any>();
  await mapConcurrent(projectIds, MAX_CONCURRENCY, async (projectId) => {
    try {
      const response = await getProject(projectId);
      const project = normalizeProjectResponse(response);
      if (project) projectDataById.set(projectId, normalizeForList(project, 'zprojects'));
    } catch {
      // Will fall back to CRM data below
    }
  });

  // Build one entry per deal (not per project) so each deal can find its tasks
  const zohoProjects = Array.from(dealToProject.values()).map((link) => {
    const projectData = projectDataById.get(link.projectId);
    if (projectData) {
      return { ...projectData, id: link.projectId, deal_id: link.dealId };
    }
    return {
      id: link.projectId,
      deal_id: link.dealId,
      name: link.dealName || `Project ${link.projectId}`,
      status: link.stage || 'Unknown',
      start_date: null,
      end_date: null,
      task_count: 0,
      task_completed_count: null,
      task_preview: [],
      source: 'crm'
    };
  });

  // Combine: Zoho Projects first, then any unlinked CRM deals
  const linkedDealIdSet = new Set(zohoProjects.map((p) => p.deal_id));
  const remainingCrm = crmProjects.filter((p) => !linkedDealIdSet.has(p.deal_id));
  return json({ projects: [...zohoProjects, ...remainingCrm], _debug: debugDealInfo });
};
