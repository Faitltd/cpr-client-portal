import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Helpers: re-implement the pure functions inline so we can test
// them without exporting internals from projects.ts.
// These mirror the exact logic in projects.ts and should be kept
// in sync. If projects.ts is refactored to export them, replace
// these with direct imports.
// ============================================================

// --- getProjectTaskDedupKey (mirrors projects.ts:1279) ---
function getProjectTaskDedupKey(task: any) {
  const idCandidates = [task?.id, task?.task_id, task?.taskId, task?.key];
  for (const candidate of idCandidates) {
    if (candidate === null || candidate === undefined) continue;
    const trimmed = String(candidate).trim();
    if (trimmed) return `id:${trimmed}`;
  }
  const name =
    typeof task?.name === 'string' ? task.name.trim()
    : typeof task?.task_name === 'string' ? task.task_name.trim()
    : typeof task?.title === 'string' ? task.title.trim()
    : '';
  const status =
    typeof task?.status === 'string' ? task.status.trim()
    : typeof task?.task_status === 'string' ? task.task_status.trim()
    : typeof task?.status_name === 'string' ? task.status_name.trim()
    : '';
  const start =
    typeof task?.start_date === 'string' ? task.start_date.trim()
    : typeof task?.start_time === 'string' ? task.start_time.trim()
    : '';
  const end =
    typeof task?.end_date === 'string' ? task.end_date.trim()
    : typeof task?.due_date === 'string' ? task.due_date.trim()
    : '';
  const fingerprint = `${name}|${status}|${start}|${end}`;
  if (fingerprint !== '|||') return `meta:${fingerprint}`;
  try {
    return `json:${JSON.stringify(task)}`;
  } catch {
    return 'json:{}';
  }
}

// --- dedupeProjectTasks (mirrors projects.ts:1326) ---
function dedupeProjectTasks(tasks: any[]) {
  const deduped: any[] = [];
  const seen = new Set<string>();
  for (const task of tasks || []) {
    const key = getProjectTaskDedupKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(task);
  }
  return deduped;
}

// --- looksLikeProjectTaskRecord (mirrors projects.ts:1206) ---
function looksLikeProjectTaskRecord(value: any) {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value).map((k) => k.toLowerCase());
  if (keys.length === 0) return false;
  if (keys.includes('task_name') || keys.includes('task_status')) return true;
  if (keys.includes('percent_complete') || keys.includes('percent_completed')) return true;
  if (keys.includes('completion_percentage')) return true;
  if (keys.includes('completed') || keys.includes('is_completed')) return true;
  if (keys.includes('task_id') || keys.includes('taskid')) return true;
  if ((keys.includes('name') || keys.includes('title')) && (keys.includes('status') || keys.includes('id'))) return true;
  return false;
}

// --- parseProjectTasks (mirrors projects.ts:1222) ---
function parseProjectTasks(payload: any) {
  const collected: any[] = [];
  const seen = new Set<string>();
  const addTask = (value: unknown) => {
    if (!looksLikeProjectTaskRecord(value)) return;
    const task = value as any;
    const key = getProjectTaskDedupKey(task);
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(task);
  };
  const visit = (value: unknown, depth = 0, keyHint = '') => {
    if (depth > 6 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (looksLikeProjectTaskRecord(item)) addTask(item);
      }
      for (const item of value) {
        if (item && typeof item === 'object' && !looksLikeProjectTaskRecord(item)) {
          visit(item, depth + 1, keyHint);
        }
      }
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (looksLikeProjectTaskRecord(record)) { addTask(record); return; }
    for (const [key, child] of Object.entries(record)) {
      if (!child) continue;
      const lowerKey = key.toLowerCase();
      const prioritize =
        lowerKey.includes('task') || lowerKey.includes('todo') || lowerKey.includes('item') ||
        lowerKey.includes('open') || lowerKey.includes('close') || keyHint.includes('task');
      if (prioritize || depth <= 2) visit(child, depth + 1, lowerKey);
    }
  };
  visit(payload, 0, '');
  return collected;
}

// --- getTaskCountHint (mirrors [projectId]/+server.ts:33) ---
function toCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 ? Math.round(value) : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    return null;
  }
  return null;
}

function getTaskCountHint(project: any): number | null {
  const direct = toCount(project?.task_count ?? project?.tasks_count ?? project?.task_total);
  if (direct !== null) return direct;
  const tasks = project?.tasks;
  if (!tasks || typeof tasks !== 'object') return null;
  const total = toCount(tasks.total_count ?? tasks.count ?? tasks.total);
  if (total !== null) return total;
  const open = toCount(tasks.open_count ?? tasks.open);
  const closed = toCount(tasks.closed_count ?? tasks.closed);
  if (open === null && closed === null) return null;
  return (open ?? 0) + (closed ?? 0);
}


// ============================================================
// TEST SUITES
// ============================================================

describe('Task parsing and ordering', () => {
  it('parseProjectTasks extracts tasks from a standard Zoho payload in order', () => {
    const payload = {
      tasks: [
        { id: '1', name: 'Demolition', status: 'Open' },
        { id: '2', name: 'Framing', status: 'Open' },
        { id: '3', name: 'Electrical rough-in', status: 'Open' },
        { id: '4', name: 'Plumbing rough-in', status: 'Open' },
        { id: '5', name: 'Insulation', status: 'Open' }
      ]
    };
    const tasks = parseProjectTasks(payload);
    expect(tasks.map((t: any) => t.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('parseProjectTasks preserves insertion order even with nested payloads', () => {
    const payload = {
      data: [
        { task_id: 'A', task_name: 'First' },
        { task_id: 'B', task_name: 'Second' },
        { task_id: 'C', task_name: 'Third' }
      ]
    };
    const tasks = parseProjectTasks(payload);
    expect(tasks.map((t: any) => t.task_id)).toEqual(['A', 'B', 'C']);
  });

  it('parseProjectTasks handles empty/null payloads', () => {
    expect(parseProjectTasks(null)).toEqual([]);
    expect(parseProjectTasks(undefined)).toEqual([]);
    expect(parseProjectTasks({})).toEqual([]);
    expect(parseProjectTasks({ tasks: [] })).toEqual([]);
  });
});

describe('Task deduplication', () => {
  it('removes duplicate tasks by id while preserving order of first occurrence', () => {
    const tasks = [
      { id: '1', name: 'Demolition', status: 'Open' },
      { id: '2', name: 'Framing', status: 'Open' },
      { id: '1', name: 'Demolition', status: 'Closed' },
      { id: '3', name: 'Electrical', status: 'Open' },
      { id: '2', name: 'Framing', status: 'Closed' }
    ];
    const result = dedupeProjectTasks(tasks);
    expect(result).toHaveLength(3);
    expect(result.map((t: any) => t.id)).toEqual(['1', '2', '3']);
    // First occurrence wins — status should be 'Open' not 'Closed'
    expect(result[0].status).toBe('Open');
  });

  it('dedupes by fingerprint when no id is present', () => {
    const tasks = [
      { task_name: 'Paint bedroom', task_status: 'Open', start_date: '2026-01-01', end_date: '2026-01-05' },
      { task_name: 'Paint bedroom', task_status: 'Open', start_date: '2026-01-01', end_date: '2026-01-05' },
      { task_name: 'Paint kitchen', task_status: 'Open', start_date: '2026-01-02', end_date: '2026-01-06' }
    ];
    const result = dedupeProjectTasks(tasks);
    expect(result).toHaveLength(2);
    expect(result[0].task_name).toBe('Paint bedroom');
    expect(result[1].task_name).toBe('Paint kitchen');
  });

  it('handles empty and null input', () => {
    expect(dedupeProjectTasks([])).toEqual([]);
    expect(dedupeProjectTasks(null as any)).toEqual([]);
  });

  it('preserves order when merging tasks from multiple tasklists sequentially', () => {
    const tasklistA = [
      { id: '10', name: 'A-first', status: 'Open' },
      { id: '11', name: 'A-second', status: 'Open' }
    ];
    const tasklistB = [
      { id: '20', name: 'B-first', status: 'Open' },
      { id: '21', name: 'B-second', status: 'Open' }
    ];
    const tasklistC = [
      { id: '30', name: 'C-first', status: 'Open' },
      { id: '10', name: 'A-first duplicate', status: 'Closed' }
    ];
    // Simulate sequential tasklist fanout: A, then B, then C
    const merged = dedupeProjectTasks([...tasklistA, ...tasklistB, ...tasklistC]);
    expect(merged.map((t: any) => t.id)).toEqual(['10', '11', '20', '21', '30']);
    // First-seen wins for id '10'
    expect(merged[0].name).toBe('A-first');
  });
});

describe('Task record detection', () => {
  it('recognizes records with task_name', () => {
    expect(looksLikeProjectTaskRecord({ task_name: 'Do thing' })).toBe(true);
  });

  it('recognizes records with name + status', () => {
    expect(looksLikeProjectTaskRecord({ name: 'Do thing', status: 'Open' })).toBe(true);
  });

  it('recognizes records with task_id', () => {
    expect(looksLikeProjectTaskRecord({ task_id: '123' })).toBe(true);
  });

  it('recognizes records with percent_complete', () => {
    expect(looksLikeProjectTaskRecord({ percent_complete: 50 })).toBe(true);
  });

  it('rejects empty objects', () => {
    expect(looksLikeProjectTaskRecord({})).toBe(false);
  });

  it('rejects primitives and null', () => {
    expect(looksLikeProjectTaskRecord(null)).toBe(false);
    expect(looksLikeProjectTaskRecord('hello')).toBe(false);
    expect(looksLikeProjectTaskRecord(42)).toBe(false);
  });

  it('rejects objects with no task-like keys', () => {
    expect(looksLikeProjectTaskRecord({ foo: 'bar', baz: 123 })).toBe(false);
  });
});

describe('Zero-task-count skip behavior', () => {
  it('returns 0 when project reports zero open and zero closed tasks', () => {
    const project = { tasks: { open_count: 0, closed_count: 0 } };
    expect(getTaskCountHint(project)).toBe(0);
  });

  it('returns sum of open + closed when both are present', () => {
    const project = { tasks: { open_count: 5, closed_count: 3 } };
    expect(getTaskCountHint(project)).toBe(8);
  });

  it('returns direct task_count when present', () => {
    const project = { task_count: 12 };
    expect(getTaskCountHint(project)).toBe(12);
  });

  it('returns null when no task count info is available', () => {
    expect(getTaskCountHint({})).toBeNull();
    expect(getTaskCountHint({ name: 'My Project' })).toBeNull();
  });

  it('parses string counts correctly', () => {
    const project = { tasks: { open_count: '7', closed_count: '2' } };
    expect(getTaskCountHint(project)).toBe(9);
  });

  it('returns null for negative or non-numeric strings', () => {
    expect(getTaskCountHint({ task_count: -1 })).toBeNull();
    expect(getTaskCountHint({ task_count: 'abc' })).toBeNull();
  });

  it('returns total_count from tasks object when available', () => {
    const project = { tasks: { total_count: 15 } };
    expect(getTaskCountHint(project)).toBe(15);
  });
});

describe('Dedup key generation', () => {
  it('prefers id-based keys', () => {
    const key = getProjectTaskDedupKey({ id: '999', name: 'Something', status: 'Open' });
    expect(key).toBe('id:999');
  });

  it('falls back to task_id', () => {
    const key = getProjectTaskDedupKey({ task_id: '888' });
    expect(key).toBe('id:888');
  });

  it('uses fingerprint when no id present', () => {
    const key = getProjectTaskDedupKey({
      task_name: 'Install cabinets',
      task_status: 'Open',
      start_date: '2026-03-01',
      end_date: '2026-03-05'
    });
    expect(key).toBe('meta:Install cabinets|Open|2026-03-01|2026-03-05');
  });

  it('falls back to JSON for unrecognizable tasks', () => {
    const key = getProjectTaskDedupKey({ foo: 'bar' });
    expect(key).toMatch(/^json:/);
  });
});
