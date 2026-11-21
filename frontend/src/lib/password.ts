export function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("At least 8 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push("Upper and lower case letters");
  if (!/\d/.test(pw)) issues.push("A number");
  return issues;
}
