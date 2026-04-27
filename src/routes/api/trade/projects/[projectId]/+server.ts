import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import {
  getDealProjectIdsForLinking,
  getProject,
  getAllProjectTasks,
  getAllProjectActivities
} from '$lib/server/projects';

const projectTasksCache = new Map<string, { fetchedAt: number; tasks: any[] }>();
const PROJECT_TASKS_CACHE_TTL_MS = 2 * 60 * 1000;

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

const getDealLabel = (deal: any) =>
  deal?.Deal_Name || deal?.Potential_Name || deal?.Name || deal?.name || null;

async function getDealDesigns(accessToken: string, dealId: string | null) {
  if (!dealId) return [];

  try {
    const response = await fetch(`https://www.zohoapis.com/crm/v2/Deals/${dealId}/Attachments`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 404) return [];
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Zoho CRM attachments request failed (${response.status})`);
    }

    const payload = await response.json().catch(() => ({}));
    const attachments = Array.isArray(payload?.data) ? payload.data : [];

    return attachments
      .filter((attachment: any) => {
        const name = String(attachment?.File_Name || '').trim();
        const lowerName = name.toLowerCase();
        const fileType = String(attachment?.file_type || '').trim().toLowerCase();

        return (
          fileType === 'pdf' ||
          lowerName.endsWith('.pdf') ||
          lowerName.includes('design') ||
          lowerName.includes('drawing')
        );
      })
      .map((attachment: any) => ({
        id: attachment?.id,
        name: attachment?.File_Name,
        url:
          attachment?.download_url ||
          `https://www.zohoapis.com/crm/v2/Deals/${dealId}/Attachments/${attachment?.id}`
      }))
      .filter((attachment: any) => attachment.id && attachment.name && attachment.url);
  } catch (err) {
    console.error(`[trade/projects/${dealId}] failed to load deal attachments:`, err);
    return [];
  }
}

// GET /api/trade/projects/:projectId
// Returns Zoho Project detail (tasks + activities) for an authorized trade partner.
export const GET: RequestHandler = async ({ cookies, params, url }) => {
  const sessionToken = cookies.get('trade_session');
  if (!sessionToken) throw error(401, 'Not authenticated');

  const session = await getTradeSession(sessionToken);
  if (!session) throw error(401, 'Invalid session');

  if (!session.trade_partner.zoho_trade_partner_id) throw error(403, 'No linked trade partner');

  const { projectId } = params;
  if (!projectId) throw error(400, 'Project ID required');

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

  // Build authorized project ID set and CRM deal map from trade partner's deals
  let authorizedProjectIds: Set<string>;
  let authorizedDealMap: Map<string, any>;
  let fallbackLink: { dealId: string | null; dealName: string | null; stage: string | null } | null =
    null;
  try {
    const dealList = await getTradePartnerDeals(
      accessToken,
      session.trade_partner.zoho_trade_partner_id
    );
    authorizedProjectIds = new Set<string>();
    authorizedDealMap = new Map<string, any>();
    for (const deal of dealList) {
      // Authorize by CRM deal ID (for fallback cards)
      if (deal?.id) authorizedDealMap.set(String(deal.id), deal);
      // Authorize by linked Zoho project IDs
      const ids = getDealProjectIdsForLinking(deal);
      for (const id of ids) {
        authorizedProjectIds.add(id);
        if (id === projectId) {
          fallbackLink = {
            dealId: deal?.id ? String(deal.id) : null,
            dealName: getDealLabel(deal),
            stage: typeof deal?.Stage === 'string' ? deal.Stage : null
          };
        }
      }
    }
  } catch (err) {
    console.error('Failed to verify trade partner project authorization:', err);
    throw error(500, 'Failed to verify authorization');
  }

  // If this is a CRM deal ID (not a Zoho project ID), return deal info with no tasks
  if (!authorizedProjectIds.has(projectId)) {
    const deal = authorizedDealMap!.get(projectId);
    if (!deal) {
      console.error(`[trade/projects/${projectId}] 403: not in authorizedProjectIds or dealMap`, {
        projectId,
        authorizedProjectIds: Array.from(authorizedProjectIds),
        dealIds: Array.from(authorizedDealMap!.keys()),
        dealProjectFields: Array.from(authorizedDealMap!.values()).map((d: any) => ({
          id: d?.id,
          name: d?.Deal_Name,
          Project_ID: d?.Project_ID,
          Zoho_Projects_ID: d?.Zoho_Projects_ID
        }))
      });
      throw error(403, 'Not authorized for this project');
    }
    const designs = await getDealDesigns(accessToken, String(deal?.id || projectId));
    return json({
      project: {
        id: projectId,
        deal_id: projectId,
        name: getDealLabel(deal) || `Deal ${projectId.slice(-6)}`,
        status: typeof deal.Stage === 'string' ? deal.Stage : 'Unknown',
        start_date: deal.Created_Time || null,
        end_date: deal.Closing_Date || null,
        source: 'crm_deal'
      },
      tasks: [],
      activities: [],
      designs
    });
  }

  let projectPayload: any = null;
  try {
    projectPayload = await getProject(projectId);
  } catch (projectErr) {
    console.error(`[trade/projects/${projectId}] getProject failed:`, projectErr instanceof Error ? projectErr.message : String(projectErr));
    // Don't bail — still try to fetch tasks directly
  }

  const project = normalizeProjectResponse(projectPayload);

  const bustCache = url.searchParams.has('fresh');
  if (bustCache) projectTasksCache.delete(projectId);

  const cachedTasks = projectTasksCache.get(projectId);
  const useTaskCache = cachedTasks && Date.now() - cachedTasks.fetchedAt < PROJECT_TASKS_CACHE_TTL_MS;
  const dealId = fallbackLink?.dealId || project?.deal_id || null;

  const [tasksResult, activitiesResult, designsResult] = await Promise.allSettled([
    useTaskCache
      ? Promise.resolve(cachedTasks!.tasks)
      : getAllProjectTasks(projectId, 100),
    getAllProjectActivities(projectId, 50),
    getDealDesigns(accessToken, dealId)
  ]);

  let tasks: any[] = [];
  let tasksLoadError: string | null = null;
  if (tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value)) {
    tasks = tasksResult.value;
    if (!useTaskCache && tasks.length > 0) {
      projectTasksCache.set(projectId, { fetchedAt: Date.now(), tasks });
    }
  } else if (tasksResult.status === 'rejected') {
    const msg = tasksResult.reason instanceof Error ? tasksResult.reason.message : String(tasksResult.reason);
    console.error(`[trade/projects/${projectId}] getAllProjectTasks failed:`, msg);
    tasksLoadError = msg;
  }

  const activities =
    activitiesResult.status === 'fulfilled' && Array.isArray(activitiesResult.value)
      ? activitiesResult.value
      : [];

  const designs =
    designsResult.status === 'fulfilled' && Array.isArray(designsResult.value)
      ? designsResult.value
      : [];

  return json({
    project: project
      ? { ...project, deal_id: dealId }
      : {
          id: projectId,
          deal_id: dealId,
          name: fallbackLink?.dealName || `Project ${projectId}`,
          status: fallbackLink?.stage || 'Unknown'
        },
    tasks,
    activities,
    designs,
    ...(tasksLoadError ? { tasksError: tasksLoadError } : {})
  });
};
