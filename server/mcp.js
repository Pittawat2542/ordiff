import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { reviewPlanSchema } from './schema.js';

const base = new URL(process.env.ORDIFF_URL || 'http://127.0.0.1:5173');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('ORDIFF_URL must point to the local Ordiff server.');
async function request(endpoint, body = {}) {
  let response;
  try { response = await fetch(new URL(endpoint, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('Ordiff is not reachable. Open Ordiff (or run npm run dev), then open a repository in the app.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ordiff could not complete the request.');
  return data.workspace;
}
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
function tool(handler) { return async input => { try { return result(await handler(input)); } catch (error) { return { content: [{ type: 'text', text: error.message }], isError: true }; } }; }

serveStdio(() => {
  const server = new McpServer({ name: 'ordiff', version: '0.2.0' });
  server.registerTool('get_review_context', {
    title: 'Read the current review diff',
    description: 'Read the local repository selected by the human in Ordiff. Refreshes Git first. Returns the exact diff version and hunk IDs. Request includeDiff to read code, optionally limited to sectionIds. Use those IDs to propose a behavior-based reading order. This tool does not mark anything reviewed.',
    inputSchema: z.object({ includeDiff: z.boolean().default(false), sectionIds: z.array(z.string()).max(100).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, tool(async ({ includeDiff, sectionIds }) => {
    const snapshot = await request('/api/context');
    const selected = sectionIds ? snapshot.sections.filter(section => sectionIds.includes(section.id)) : snapshot.sections;
    if (sectionIds?.some(id => !selected.some(section => section.id === id))) throw new Error('A requested section is no longer in this diff. Read the current context again.');
    const data = { repo: snapshot.repo, version: snapshot.version, planStatus: snapshot.planStatus, groups: snapshot.groups, sections: selected.map(section => ({ id: section.id, path: section.path, role: section.role, hunk: section.symbol, binary: Boolean(section.binary), ...(includeDiff ? { lines: section.lines } : {}) })) };
    if (Buffer.byteLength(JSON.stringify(data)) > 2 * 1024 * 1024) throw new Error('This diff is too large for one result. Read the section metadata, then request code for a smaller set of sectionIds.');
    return data;
  }));
  server.registerTool('submit_review_plan', {
    title: 'Propose a behavior-based review path',
    description: 'Send ordered behavior groups and grounded step explanations to the open Ordiff app. The version must match the current Git diff. Uncovered hunks stay visible as unassigned. A hunk may appear in more than one behavior. Does not edit Git files, stage, commit, approve, or mark code reviewed.',
    inputSchema: reviewPlanSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, tool(async plan => {
    const snapshot = await request('/api/review-plan', plan);
    const covered = new Set(snapshot.groups.flatMap(group => group.sections));
    return { version: snapshot.version, behaviors: snapshot.groups.length, coveredSections: covered.size, unassignedSections: snapshot.sections.length - covered.size, message: 'The review path is now visible in Ordiff.' };
  }));
  return server;
});
