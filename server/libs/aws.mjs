/**
 * AWS STS — the real per-user "Connect AWS" mechanism. A user connects by giving Nimbus a
 * cross-account IAM Role ARN (+ External ID) in THEIR account that trusts Nimbus. Per
 * request we call `sts assume-role` (using Nimbus's own base identity — the host's ~/.aws
 * here, a dedicated Nimbus principal in prod) to mint SHORT-LIVED credentials for that
 * role, and inject them into the user's AWS MCP. Tokens expire (~1h); nothing long-lived
 * is stored. This is what makes each user's MCP act in their own account only.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)

/** Resolve the `aws` CLI to an absolute path (spawned PATH may be minimal). */
function resolveAws() {
  for (const c of ['/opt/homebrew/bin/aws', '/usr/local/bin/aws', '/usr/bin/aws']) if (existsSync(c)) return c
  return 'aws'
}
const AWS = resolveAws()

/**
 * Assume a customer's cross-account role → temporary credential env for the MCP.
 * Throws if the role can't be assumed (bad ARN / missing trust / no base creds).
 */
export async function assumeRole({ roleArn, externalId, region = 'us-east-1', sessionName = 'nimbus' }) {
  const args = [
    'sts', 'assume-role',
    '--role-arn', roleArn,
    '--role-session-name', sessionName.replace(/[^\w+=,.@-]/g, '-').slice(0, 64),
    '--duration-seconds', '3600',
    '--region', region,
    '--output', 'json',
  ]
  if (externalId) args.push('--external-id', externalId)
  const { stdout } = await execFileAsync(AWS, args, { env: process.env, timeout: 20000 })
  const c = JSON.parse(stdout).Credentials
  return {
    AWS_REGION: region,
    AWS_ACCESS_KEY_ID: c.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: c.SecretAccessKey,
    AWS_SESSION_TOKEN: c.SessionToken,
  }
}
