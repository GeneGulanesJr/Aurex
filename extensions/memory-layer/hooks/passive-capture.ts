import { AUTO_DECISION_COOLDOWN, CHECKPOINT_INTERVAL, state } from '../state';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mem } from '../host/memory-client';
import path from 'node:path';

interface PassiveCaptureDeps {
  state: typeof state;
  mem: typeof mem;
}

const DECISION_PATTERNS: Array<{ regex: RegExp; type: string; label: string }> = [
  {
    regex:
      /\b(I['']ll use|let's use|we should use|going with|switching to|using .* instead of)\b.*\b(because|since|reason|to avoid|for better)\b/i,
    type: 'decision',
    label: 'Design decision',
  },
  {
    regex: /\b(approach|strategy|architecture|pattern|design):\s.*\b(implement|chose|selected|decided)\b/i,
    type: 'decision',
    label: 'Architecture choice',
  },
  {
    regex: /\b(root cause|the bug was|issue is that|fixed by|workaround is to)\b/i,
    type: 'bugfix',
    label: 'Bug fix',
  },
  {
    regex: /\b(I discovered that|turns out the reason|found that .* because|note that .* limitation)\b/i,
    type: 'discovery',
    label: 'Discovery',
  },
  {
    regex: /\b(cannot .* because|constraint is|requirement is that|limitation:)\b/i,
    type: 'architecture',
    label: 'Constraint identified',
  },
];

function extractMessageText(msg: any): string {
  if (!msg) {
    return '';
  }
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text || '')
      .join(' ');
  }
  return '';
}

export function registerPassiveCapture(pi: ExtensionAPI, deps: PassiveCaptureDeps) {
  pi.on('tool_result', async (event, _ctx) => {
    if (event.toolName === 'edit' || event.toolName === 'write') {
      const input = event.input as { path?: string };
      if (!input?.path || !deps.state.currentProject) {
        return;
      }

      if (input.path.includes('memory-store.js') || input.path.includes('memory-layer')) {
        return;
      }

      deps.state.editedFiles.add(input.path);
    }
  });

  pi.on('message_end', async (event, _ctx) => {
    if (event.message?.role !== 'assistant') {
      return;
    }
    const text = extractMessageText(event.message);
    if (!text || text.length < 50) {
      return;
    }

    if (text.length < 100) {
      return;
    }

    if (Date.now() - deps.state.lastAutoDecisionSave < AUTO_DECISION_COOLDOWN) {
      return;
    }

    if (text.includes('memory-save') || text.includes('memory-search') || text.includes('memory-get')) {
      return;
    }

    for (const pattern of DECISION_PATTERNS) {
      if (pattern.regex.test(text)) {
        deps.state.lastAutoDecisionSave = Date.now();

        const firstLine = text.split('\n')[0].slice(0, 120);
        const title = `${pattern.label}: ${firstLine.slice(0, 80)}`;

        // oxlint-disable-next-line no-await-in-loop
        await deps.mem('save', {
          title,
          type: pattern.type,
          project: deps.state.currentProject || 'unknown',
          scope: 'project',
          content: [
            `**What**: Auto-detected ${pattern.label.toLowerCase()}`,
            `**Where**: Session ${deps.state.sessionId || 'unknown'}`,
            `**Learned**: ${text.slice(0, 300)}`,
          ].join('\n'),
        });
        break;
      }
    }
  });

  pi.on('turn_end', async (_event, _ctx) => {
    deps.state.turnCount++;

    if (deps.state.pendingRecallFeedback.size > 0) {
      const entries = [...deps.state.pendingRecallFeedback.entries()].map(([memoryId, meta]) => ({
        memoryId,
        sessionId: meta.sessionId,
        query: meta.query,
        wasUseful: false,
      }));
      await deps.mem('log-negative-recall', {
        entries: JSON.stringify(entries),
      });
      deps.state.pendingRecallFeedback.clear();
    }

    if (deps.state.turnCount % CHECKPOINT_INTERVAL !== 0 || deps.state.turnCount === 0) {
      return;
    }
    if (!deps.state.currentProject) {
      return;
    }

    const summaryFiles = [...deps.state.editedFiles]
      .slice(0, 10)
      .map((f) => `- ${path.basename(f)}`)
      .join('\n');

    await deps.mem('save', {
      title: `Progress checkpoint (turn ${deps.state.turnCount})`,
      type: 'progress',
      project: deps.state.currentProject,
      scope: 'project',
      force: 'true',
      content: [
        `**What**: Auto-checkpoint at turn ${deps.state.turnCount}`,
        `**Where**: Session ${deps.state.sessionId}`,
        `**Learned**: ${deps.state.memoriesSavedThisSession} explicit memories saved, ${deps.state.editedFiles.size} files edited`,
        summaryFiles ? `Files touched:\n${summaryFiles}` : '',
      ].join('\n'),
    });
  });
}
