export function taskIssueFor(repo: string, issue: string) {
  return repo && /^#?\d{1,8}$/.test(issue) ? repo + "#" + issue.replace(/^#/, "") : issue;
}
