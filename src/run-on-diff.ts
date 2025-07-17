import { lint } from 'php-codesniffer';
import { execFileSync } from 'child_process';
import { blame } from 'git-blame-json';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';

interface PHPCSMessage {
  line: number;
  column: number;
  type: 'ERROR' | 'WARNING';
  message: string;
  source: string;
}

interface LinterMessage {
  message: string;
  source: string;
  severity: number;
  fixable: boolean;
  type: 'ERROR' | 'WARNING';
  line: number;
  column: number;
}

interface LintResultFiles {
  errors: number;
  warnings: number;
  messages: LinterMessage[];
}

export async function runOnDiff(
  files: Map<string, Set<number>>,
  scope: string
): Promise<void> {
  try {
    const options: Record<string, string> = {};
    const standard = core.getInput('standard');
    if (standard) options.standard = standard;

    const fileList = Array.from(files.keys());

    const lintResults = await lint(
      fileList,
      core.getInput('phpcs_path', { required: true }),
      options
    );

    const dontFailOnWarning =
      core.getInput('fail_on_warnings') == 'false' ||
      core.getInput('fail_on_warnings') === 'off';
    if (!lintResults.totals.errors) {
      if (dontFailOnWarning) return;
      if (!lintResults.totals.warnings) return;
    }

    let authorEmail = null;

    const isScopeBlame = scope === 'blame';
    if (isScopeBlame) {
      // blame files and output relevant errors
      // const payload = github.context
      //   .payload as Webhooks.EventPayloads.WebhookPayloadPullRequest;
      // get email of author of first commit in PR
      authorEmail = execFileSync(
        'git',
        ['--no-pager', 'log', '--format=%ae', `${github.context.sha}^!`],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 }
      ).trim();
      console.log('PR author email: %s', authorEmail);
    }

    let failed = false;

    console.log('<?xml version="1.0" encoding="UTF-8"?>');
    console.log('<checkstyle version="3.13.2">');
    const errors = new Map<string, PHPCSMessage[]>();
    for (const [file, results] of Object.entries(lintResults.files)) {
      let errorsInFile: PHPCSMessage[] = [];
      const relativeFilePath = path.relative(process.cwd(), file);
      switch (scope) {
        case 'blame':
          errorsInFile = await filterByBlame(results, file, authorEmail!);
          break;
        case 'diff':
          errorsInFile = await filterByDiff(
            results,
            files.get(relativeFilePath)!
          );
          break;
      }

      if (errorsInFile.length) {
        errors.set(relativeFilePath, errorsInFile);
      }
    }

    for (const [file, messages] of errors.entries()) {
      console.log(`<file name="${file}">`);
      for (const message of messages) {
        console.log(
          ' <error line="%d" column="%d" severity="%s" message="%s" source="%s"/>',
          message.line,
          message.column,
          message.type.toLowerCase(),
          message.message,
          message.source
        );

        if (message.type === 'WARNING' && !dontFailOnWarning) failed = true;
        else if (message.type === 'ERROR') failed = true;
      }
      console.log('</file>');
    }

    console.log('</checkstyle>');
    if (failed) core.setFailed(`PHPCS on ${scope} failed`);
  } catch (err) {
    core.debug(err);
    core.setFailed(err);
  }
}

async function filterByBlame(
  results: LintResultFiles,
  file: string,
  author: string
): Promise<PHPCSMessage[]> {
  const blameMap = await blame(file);
  const errorsInFile: PHPCSMessage[] = [];
  for (const message of results.messages) {
    if (blameMap.get(message.line)?.authorMail === author) {
      errorsInFile.push({
        line: message.line,
        column: message.column,
        type: message.type,
        source: message.source,
        message: message.message,
      });
    }
  }

  return errorsInFile;
}

async function filterByDiff(
  results: LintResultFiles,
  fileDiffLines: Set<number>
): Promise<PHPCSMessage[]> {
  const errorsInFile: PHPCSMessage[] = [];
  for (const message of results.messages) {
    if (fileDiffLines.has(message.line)) {
      errorsInFile.push({
        line: message.line,
        column: message.column,
        type: message.type,
        source: message.source,
        message: message.message,
      });
    }
  }

  return errorsInFile;
}
