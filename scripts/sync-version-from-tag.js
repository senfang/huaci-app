const { execSync } = require('child_process');

const ref = process.env.GITHUB_REF || '';
const match = ref.match(/^refs\/tags\/v(.+)$/);
if (!match) {
  console.log('Not a version tag, skipping');
  process.exit(0);
}

const version = match[1];
console.log(`Syncing package version to ${version}`);
execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, {
  stdio: 'inherit',
});
