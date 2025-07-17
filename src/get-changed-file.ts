import { existsSync } from 'fs';
import { execSync } from 'child_process';
import parseDiff, { File as DiffFile } from 'parse-diff';

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as Webhooks from '@octokit/webhooks';
import picomatch from 'picomatch';

export async function getChangedFiles(): Promise<Map<string, Set<number>>> {
  const pattern = core.getInput('files', {
    required: false,
  });
  const globs = pattern.length ? pattern.split(',') : ['**.php'];
  const isMatch = picomatch(globs);
  console.log('Filter patterns:', globs, isMatch('src/test.php'));
  const payload = github.context
    .payload as Webhooks.EventPayloads.WebhookPayloadPullRequest;

  const result = new Map<string, Set<number>>();
  try {
    const diffText = execSync(
      `git diff --unified=0 ${payload.pull_request.base.sha}..`,
      {
        encoding: 'utf-8',
      }
    );

    const files: DiffFile[] = parseDiff(diffText);

    for (const file of files) {
      if (file.deleted || !isMatch(file.to!) || !existsSync(file.to!)) continue;
      const changed = new Set<number>();
      for (const hunk of file.chunks) {
        for (const line of hunk.changes) {
          if (line.type === 'add') {
            changed.add(line.ln);
          }
          if (line.type === 'normal') {
            changed.add(line.ln2);
          }
        }
      }
      result.set(file.to!, changed);
    }
  } catch (err) {
    console.error(err);
  }
  return result;
}
