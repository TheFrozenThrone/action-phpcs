import * as path from 'path';
import * as core from '@actions/core';
import { getChangedFiles } from './get-changed-file';
import { runOnCompleteFiles } from './run-on-files';
import { runOnDiff } from './run-on-diff';

async function run(): Promise<void> {
  try {
    const files = await getChangedFiles();
    core.info(JSON.stringify(Array.from(files.keys()), null, 2));
    if (!files.size) {
      core.warning('No files to check, exiting...');
      return;
    }

    /**
     * Adding problem matcher to annotate files without token
     * @see {@link https://github.com/actions/setup-node/blob/a47b2f66c61e623b503818d97a63ce0fe087f700/src/setup-node.ts#L36}
     */
    const matchersPath = path.join(__dirname, '..', '.github');
    console.log(
      `##[add-matcher]${path.join(matchersPath, 'phpcs-matcher.json')}`
    );

    const scope = core.getInput('scope', { required: true });
    if (scope === 'files') {
      runOnCompleteFiles(files);
    } else {
      await runOnDiff(files, scope);
    }
  } catch (error) {
    core.setFailed(error);
  }
}

void run();
